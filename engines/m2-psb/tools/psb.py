#!/usr/bin/env python3
"""psb.py - M2 (emote) PSB v2-v4 reader + full serializer (GameTranslateSkills shared M2 tool).

  python -I psb.py selftest

Reader keeps encoding-relevant types (F32/F64, IntArray, Res/ExtRes); strings decode as UTF-8 with surrogateescape
(lossless). Serializer rebuilds names trie, entry tree, string table and copies chunks. Contract: rebuild(x) == x for
the scn/config/info PSBs of the M2 Switch titles (texture PSBs are patched in place instead, see m2img.py).
Checksum: v3 = adler32(hdr[0x08:0x28]); v4 continues the same adler32 over the ext fields hdr[0x2C:0x38].
"""
import struct
import sys
import zlib


class Str(str):
    def __new__(cls, text, idx=None):
        o = str.__new__(cls, text)
        o.idx = idx
        return o


class Res(int):
    pass


class ExtRes(int):
    pass


class F32(float):
    pass


class F64(float):
    pass


class IntArray(list):
    pass


HDR_FIELDS = ('hdr_len', 'names', 'strings', 'strings_data', 'chunk_offsets', 'chunk_lengths', 'chunk_data', 'entries')


def _enc(s):
    return s.encode('utf-8', 'surrogateescape')


class PSB:
    def __init__(self, data: bytes):
        assert data[:4] == b'PSB\0', 'not PSB'
        self.data = data
        self.version, self.encrypt = struct.unpack_from('<HH', data, 4)
        assert self.encrypt == 0, 'encrypted PSB header not supported'
        self.h = dict(zip(HDR_FIELDS, struct.unpack_from('<8I', data, 8)))
        self.names = self._names()
        offs, _ = self._array(self.h['strings'])
        self.strings = [self._cstr(self.h['strings_data'] + o) for o in offs]
        co, _ = self._array(self.h['chunk_offsets'])
        cl, _ = self._array(self.h['chunk_lengths'])
        self.chunks = [data[self.h['chunk_data'] + o:self.h['chunk_data'] + o + n] for o, n in zip(co, cl)]
        self.ext_chunks = []
        if self.version >= 4:
            eo, el, ed = struct.unpack_from('<3I', data, 0x2C)
            a, _ = self._array(eo)
            b, _ = self._array(el)
            self.ext_chunks = [data[ed + o:ed + o + n] for o, n in zip(a, b)]

    def _uint(self, pos, n):
        return int.from_bytes(self.data[pos:pos + n], 'little'), pos + n

    def _array(self, pos):
        t = self.data[pos]
        assert 0x0D <= t <= 0x14, f'array type {t:#x} @ {pos:#x}'
        cnt, pos = self._uint(pos + 1, t - 0x0C)
        es = self.data[pos] - 0x0C
        pos += 1
        return [int.from_bytes(self.data[pos + i * es:pos + (i + 1) * es], 'little') for i in range(cnt)], pos + cnt * es

    def _cstr(self, pos):
        return self.data[pos:self.data.index(b'\0', pos)].decode('utf-8', 'surrogateescape')

    def _names(self):
        pos = self.h['names']
        charset, pos = self._array(pos)
        nd, pos = self._array(pos)
        idx, pos = self._array(pos)
        out = []
        for i in idx:
            chars, ch = [], nd[i]
            while ch != 0:
                code = nd[ch]
                chars.append(ch - charset[code])
                ch = code
            out.append(bytes(reversed(chars)).decode('utf-8', 'surrogateescape'))
        return out

    def value(self, pos):
        d, t = self.data, self.data[pos]
        if t == 1:
            return None
        if t in (2, 3):
            return t == 3
        if t == 4:
            return 0
        if 5 <= t <= 0x0C:
            return int.from_bytes(d[pos + 1:pos + t - 3], 'little', signed=True)
        if 0x0D <= t <= 0x14:
            return IntArray(self._array(pos)[0])
        if 0x15 <= t <= 0x18:
            i = int.from_bytes(d[pos + 1:pos + t - 0x13], 'little')
            return Str(self.strings[i], i)
        if 0x19 <= t <= 0x1C:
            return Res(int.from_bytes(d[pos + 1:pos + t - 0x17], 'little'))
        if t == 0x1D:
            return F32(0.0)
        if t == 0x1E:
            return F32(struct.unpack_from('<f', d, pos + 1)[0])
        if t == 0x1F:
            return F64(struct.unpack_from('<d', d, pos + 1)[0])
        if t == 0x20:
            offs, p = self._array(pos + 1)
            return [self.value(p + o) for o in offs]
        if t == 0x21:
            nidx, p = self._array(pos + 1)
            offs, p = self._array(p)
            return {self.names[n]: self.value(p + o) for n, o in zip(nidx, offs)}
        if 0x22 <= t <= 0x25:
            return ExtRes(int.from_bytes(d[pos + 1:pos + t - 0x20], 'little'))
        raise ValueError(f'type {t:#x} @ {pos:#x}')

    def root(self):
        return self.value(self.h['entries'])

    def names_section(self):
        return self.names, self.data[self.h['names']:self.h['entries']] if self.h['names'] < self.h['entries'] else None

    def checksum_ok(self):
        return self.version < 3 or struct.unpack_from('<I', self.data, 0x28)[0] == cks(self.data, self.version)


def cks(buf, version=3):
    a = zlib.adler32(bytes(buf[0x08:0x28]))
    return (zlib.adler32(bytes(buf[0x2C:0x38]), a) if version >= 4 else a) & 0xFFFFFFFF


# ---------------- serializer
def _w(n):
    return max(1, (n.bit_length() + 7) // 8)


def _arr(vals):
    cnt = len(vals)
    cw = _w(cnt)
    ew = _w(max(vals)) if vals else 1
    return bytes([0x0C + cw]) + cnt.to_bytes(cw, 'little') + bytes([0x0C + ew]) + b''.join(v.to_bytes(ew, 'little') for v in vals)


def _collect(v, names, strings):
    if isinstance(v, dict):
        for k, x in v.items():
            names.add(k)
            _collect(x, names, strings)
    elif isinstance(v, IntArray):
        return
    elif isinstance(v, list):
        for x in v:
            _collect(x, names, strings)
    elif isinstance(v, str):
        strings.add(v)


def _names_section(names):
    """double-array trie in the M2 layout (charset/namesData/nameIndexes)"""
    root = {}
    for k in (_enc(n) + b'\0' for n in names):
        cur = root
        for c in k:
            cur = cur.setdefault(c, {})
    charset, nd, term_pos, used = [0], [0], {}, {0}
    queue = [(root, 0, b'')]
    while queue:
        node, pos, prefix = queue.pop(0)
        chars = sorted(node)
        if not chars:
            continue
        base = 1
        while any((base + c) in used for c in chars) or base + min(chars) == 0:
            base += 1
        while len(charset) <= pos:
            charset.append(0)
        charset[pos] = base
        for c in chars:
            p = base + c
            used.add(p)
            while len(nd) <= p:
                nd.append(0)
            nd[p] = pos
            if c == 0:
                term_pos[prefix] = p
            else:
                queue.append((node[c], p, prefix + bytes([c])))
    while len(charset) < len(nd):
        charset.append(0)
    return _arr(charset) + _arr(nd) + _arr([term_pos[_enc(n)] for n in names])


class _Writer:
    def __init__(self, name_idx, str_idx):
        self.ni, self.si = name_idx, str_idx

    def val(self, v):
        if v is None:
            return b'\x01'
        if v is True:
            return b'\x03'
        if v is False:
            return b'\x02'
        if isinstance(v, Res):
            return bytes([0x18 + _w(int(v))]) + int(v).to_bytes(_w(int(v)), 'little')
        if isinstance(v, ExtRes):
            return bytes([0x21 + _w(int(v))]) + int(v).to_bytes(_w(int(v)), 'little')
        if isinstance(v, int):
            if v == 0:
                return b'\x04'
            n = 1
            while not -(1 << (8 * n - 1)) <= v < (1 << (8 * n - 1)):
                n += 1
            return bytes([4 + n]) + v.to_bytes(n, 'little', signed=True)
        if isinstance(v, F64):
            return b'\x1f' + struct.pack('<d', v)
        if isinstance(v, float):
            if v == 0.0 and str(v)[0] != '-':
                return b'\x1d'
            return b'\x1e' + struct.pack('<f', v)
        if isinstance(v, str):
            i = self.si[v]
            return bytes([0x14 + _w(i)]) + i.to_bytes(_w(i), 'little')
        if isinstance(v, IntArray):
            return _arr(list(v))
        if isinstance(v, list):
            return b'\x20' + self._pack([self.val(x) for x in v])
        if isinstance(v, dict):
            ks = sorted(v, key=lambda k: self.ni[k])
            return b'\x21' + _arr([self.ni[k] for k in ks]) + self._pack([self.val(v[k]) for k in ks])
        raise TypeError(type(v))

    @staticmethod
    def _pack(items):
        # identical encoded siblings share one copy (matches the M2 compiler's dedup; valid either way)
        offs, blob, seen = [], bytearray(), {}
        for it in items:
            if it not in seen:
                seen[it] = len(blob)
                blob += it
            offs.append(seen[it])
        return _arr(offs) + bytes(blob)


def dump(root, chunks=(), version=3, ext_chunks=(), orig_names=None):
    """orig_names=(names_list, section_bytes): reused verbatim when the key set is unchanged"""
    names, strings = set(), set()
    _collect(root, names, strings)
    names = sorted(names, key=_enc)
    strings = sorted(strings, key=_enc)
    ni = {n: i for i, n in enumerate(names)}
    si = {s: i for i, s in enumerate(strings)}
    hdr_len = 0x2C if version < 4 else 0x38
    out = bytearray(hdr_len)
    h = {'hdr_len': hdr_len, 'names': hdr_len}
    out += orig_names[1] if orig_names and orig_names[0] == names else _names_section(names)
    h['entries'] = len(out)
    out += _Writer(ni, si).val(root)
    soffs, sblob = [], bytearray()
    for s in strings:
        soffs.append(len(sblob))
        sblob += _enc(s) + b'\0'
    h['strings'] = len(out)
    out += _arr(soffs)
    h['strings_data'] = len(out)
    out += sblob
    coffs, n = [], 0
    for c in chunks:
        coffs.append(n)
        n += len(c)
    h['chunk_offsets'] = len(out)
    out += _arr(coffs)
    h['chunk_lengths'] = len(out)
    out += _arr([len(c) for c in chunks])
    h['chunk_data'] = len(out)
    out += b''.join(chunks)
    out[0:8] = b'PSB\0' + struct.pack('<HH', version, 0)
    struct.pack_into('<8I', out, 8, *[h[k] for k in HDR_FIELDS])
    if version >= 4:
        eo = len(out)
        eoffs, n = [], 0
        for c in ext_chunks:
            eoffs.append(n)
            n += len(c)
        out += _arr(eoffs)
        el = len(out)
        out += _arr([len(c) for c in ext_chunks])
        ed = len(out)
        out += b''.join(ext_chunks)
        struct.pack_into('<3I', out, 0x2C, eo, el, ed)
    if version >= 3:
        struct.pack_into('<I', out, 0x28, cks(out, version))
    return bytes(out)


def rebuild(data: bytes, root=None):
    p = PSB(data)
    return dump(p.root() if root is None else root, p.chunks, p.version, p.ext_chunks, p.names_section())


def same_tree(a, b):
    if isinstance(a, dict):
        return isinstance(b, dict) and list(a) == list(b) and all(same_tree(a[k], b[k]) for k in a)
    if isinstance(a, list):
        return isinstance(b, list) and type(a) is type(b) and len(a) == len(b) and all(same_tree(x, y) for x, y in zip(a, b))
    if isinstance(a, float):
        return type(a) is type(b) and struct.pack('<d', a) == struct.pack('<d', b)
    return type(a) is type(b) and a == b


def selftest():
    tree = {'scenes': [{'texts': [['風太郎', [[None, 'あ\\nい', 2]], 300, -70000]], 'title': '第1話'}],
            'flags': [True, False, None, 0], 'f': F32(1.5), 'z': F32(0.0), 'd': F64(-2.25), 'ia': IntArray([1, 513, 70000]),
            'pix': Res(1), 'big': 1 << 40, 'dup': ['x', 'x'], 'bad': 'a\udcff'}
    chunks = [b'\1\2\3', b'\4' * 300]
    for ver in (2, 3, 4):
        b = dump(tree, chunks, ver, [b'e'] if ver >= 4 else ())
        p = PSB(b)
        assert p.root() == tree and p.chunks == chunks and p.checksum_ok(), ver
        assert same_tree(p.root(), PSB(dump(p.root(), chunks, ver)).root()) and type(p.root()['d']) is F64
        assert rebuild(b) == b, f'v{ver} byte identity'
        assert dump(p.root(), p.chunks, ver, p.ext_chunks) == b, 'forced trie rebuild'
        if ver >= 4:
            assert p.ext_chunks == [b'e'] and dump({'x': ExtRes(3)}, (), 4).count(b'\x22\x03') == 1
    t2 = PSB(dump(tree, chunks)).root()
    t2['scenes'][0]['texts'][0][1][0][1] = '가\\n나'
    assert PSB(rebuild(dump(tree, chunks), t2)).root()['scenes'][0]['texts'][0][1][0][1] == '가\\n나'
    print('selftest ok')


if __name__ == '__main__':
    if sys.argv[1:] == ['selftest']:
        selftest()
    else:
        sys.exit(__doc__)
