# lzlr.py — LZLR container codec (Shin-engine Switch builds: SHARED/UI *.tlz/.ddz/.biz, CROSS *.tex).
#
# Layout (decoder reversed from ExeFS main .text, found via the "RLZL" .ro string xref; magic test is byte-wise 'LZLR'):
#   0x00 'LZLR' | 0x04 u32 decoded size (bytes, multiple of 4) | 0x08 u32 offset of the literal-word stream
#   0x0C ..     control bitstream: u32 LE words read MSB-first
#   [lit_off..] literal stream: raw u32 words, consumed in order
# Unit is a 32-bit word. Number code N(): k = count of 1-bits before a 0-bit, then k+1 value bits (MSB first);
#   N = (2^(k+1) - 1) + value  (so N >= 1).
# Loop until output >= decoded size:
#   flag bit 0: literal run   -> copy N() words from the literal stream
#   flag bit 1: match group   -> repeat N() times: length = N(); dist = 10 bits (1..1023); copy length words from out[-dist]
#
#   python lzlr.py test <file...>         decode, re-encode, report byte-identical / decodes-back
#   python lzlr.py dump <in> <out>        write decoded bytes
#   python lzlr.py pack <raw> <out>       encode raw bytes into an LZLR container
import struct
import sys

import numpy as np

MAGIC = b'LZLR'


def _bits(words_bytes):
    """b'0'/b'1' string of a u32-LE word stream, each word MSB first."""
    a = np.frombuffer(words_bytes, '<u4').astype('>u4')
    return (np.unpackbits(a.view(np.uint8)) + 48).tobytes()


def decompress(b, tokens=None):
    assert b[:4] == MAGIC, b[:4]
    size, lit = struct.unpack_from('<iI', b, 4)
    bits = _bits(b[12:lit - (lit - 12) % 4])
    p = 0

    def num():
        nonlocal p
        z = bits.find(b'0', p)
        k = z - p
        v = int(bits[z + 1:z + 2 + k], 2)
        p = z + 2 + k
        return (1 << (k + 1)) - 1 + v

    out, q = bytearray(), lit
    while len(out) < size:
        f = bits[p]
        p += 1
        if f == 48:
            n = num() * 4
            out += b[q:q + n]
            q += n
            if tokens is not None:
                tokens.append(('L', n // 4))
        else:
            for _ in range(num()):
                ln = num()
                d = int(bits[p:p + 10], 2)
                p += 10
                if not 0 < d * 4 <= len(out):
                    raise ValueError(f'bad dist {d} at out={len(out)}')
                src, n = len(out) - d * 4, ln * 4
                if d >= ln:
                    out += out[src:src + n]
                else:
                    chunk = out[src:]
                    out += (chunk * (n // len(chunk) + 1))[:n]
                if tokens is not None:
                    tokens.append(('M', ln, d))
    if len(out) != size or q != len(b):
        raise ValueError(f'size {len(out)}/{size}, literal end {q}/{len(b)}')
    return bytes(out), p


class _BW:
    def __init__(self):
        self.parts = []

    def num(self, n):
        n += 1  # N = 2^(k+1)-1+v  <=>  n+1 = 2^(k+1)+v, binary of n+1 is '1'+(k+1 bits)
        s = bin(n)[3:]
        self.parts.append('1' * (len(s) - 1) + '0' + s)

    def put(self, s):
        self.parts.append(s)


def compress(data, max_dist=1023):
    """Matches the game's encoder byte-for-byte: greedy longest match over u32 words, dist 2..max_dist,
    min length 1, ties -> farthest; consecutive literals form one run, consecutive matches one group."""
    assert len(data) % 4 == 0
    a = np.frombuffer(data, '<u4')
    n = len(a)
    order = np.argsort(a, kind='stable')
    rank = np.empty(n, np.int64)
    rank[order] = np.arange(n)
    order, rank, w = order.tolist(), rank.tolist(), a.tolist()
    bw, lits, i = _BW(), bytearray(), 0
    group, run = [], 0

    def mlen(c, i):
        # words matching from c and i (c < i, overlap allowed: source is already-decoded output)
        lo, step = 0, 16
        while True:
            hi = min(lo + step, n - i)
            if data[(c + lo) * 4:(c + hi) * 4] != data[(i + lo) * 4:(i + hi) * 4]:
                break
            lo = hi
            if lo == n - i:
                return lo
            step *= 2
        while hi - lo > 1:
            m = (lo + hi) // 2
            if data[(c + lo) * 4:(c + m) * 4] == data[(i + lo) * 4:(i + m) * 4]:
                lo = m
            else:
                hi = m
        return lo

    def flush_run():
        nonlocal run
        if run:
            bw.put('0')
            bw.num(run)
            run = 0

    def flush_group():
        if group:
            bw.put('1')
            bw.num(len(group))
            for ln, d in group:
                bw.num(ln)
                bw.put(format(d, '010b'))
            group.clear()

    while i < n:
        best_l, best_d, v, r = 0, 0, w[i], rank[i] - 1
        while r >= 0:
            c = order[r]
            r -= 1
            if w[c] != v or i - c > max_dist:
                break
            if i - c < 2:
                continue
            ln = mlen(c, i)
            if ln >= best_l:
                best_l, best_d = ln, i - c
        if best_l:
            flush_run()
            group.append((best_l, best_d))
            i += best_l
        else:
            flush_group()
            lits += data[i * 4:i * 4 + 4]
            run += 1
            i += 1
    flush_run()
    flush_group()
    s = ''.join(bw.parts)
    s += '0' * (-len(s) % 32)
    words = int(s, 2).to_bytes(len(s) // 8, 'big') if s else b''
    words = np.frombuffer(words, '>u4').astype('<u4').tobytes()
    return MAGIC + struct.pack('<iI', len(data), 12 + len(words)) + words + bytes(lits)


def main():
    cmd = sys.argv[1]
    if cmd == 'dump':
        open(sys.argv[3], 'wb').write(decompress(open(sys.argv[2], 'rb').read())[0])
    elif cmd == 'pack':
        open(sys.argv[3], 'wb').write(compress(open(sys.argv[2], 'rb').read()))
    elif cmd == 'test':
        bad = 0
        for f in sys.argv[2:]:
            b = open(f, 'rb').read()
            raw, _ = decompress(b)
            c = compress(raw)
            same = c == b
            back = decompress(c)[0] == raw
            bad += not back
            print(f'{f}\tcomp={len(b)}\traw={len(raw)}\tre={len(c)}\tidentical={same}\tdecodes_back={back}')
        sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
