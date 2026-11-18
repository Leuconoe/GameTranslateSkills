#!/usr/bin/env python3
"""m2arc.py - M2 Switch archive (<arch>_info.psb.m + <arch>_body.bin) and MDF access (GameTranslateSkills shared tool).

  python -I m2arc.py list -r ROMFS [-k KEYFILE] -o INVENTORY.tsv      every entry of every archive pair in ROMFS
  python -I m2arc.py dump -r ROMFS [-k KEYFILE] -o DIR ARCH[,ARCH]    DIR/<arch>/<keyname> decoded (patch overrides applied)
  python -I m2arc.py findkey NSO_MAIN SAMPLE.m KEYFILE_OUT            scan ExeFS main strings for the MDF key (needs lz4);
                                                                      writes the key to KEYFILE_OUT, prints only length
  python -I m2arc.py selftest

MDF: b'mdf\\0' + u32 raw_size + zlib(raw); bytes after the 8-byte header are XORed with KEY_LEN bytes (cycled) of an
MT19937 stream seeded by init_by_array(md5(game_key + keyname) as 4 LE u32).
Entry keyname: basename of the info name, plus expire_suffix_list[0] unless it already ends in '.m'
(e.g. scenario 'ca01_01.txt' -> 'ca01_01.txt.scn.m'; patch 'scenario/x.scn.m' -> 'x.scn.m'; patch 'image/ev01' -> 'ev01.psb.m').
Patch archive entries '<arch>/<name>' override the base <arch> entry with the same keyname.
Key: never printed or stored in the repo. load_key(): explicit path > env M2_KEY_FILE > <project>/90_tools/environment/m2_key.txt
(project = ROMFS.parents[1], ROMFS = <project>/10_extract/romfs_original).
Rebuild: body entries rewritten in original offset order; changed entries re-packed (raw entries stay raw); file_info
offsets/lengths updated; no keys added (adding keys to patch_info hangs boot - ENGINE.md rule 5).
"""
import argparse
import functools
import hashlib
import os
import re
import struct
import sys
import tempfile
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import psb  # noqa: E402

KEY_LEN = 131
ARCHS = ('config', 'font', 'image', 'motion', 'patch', 'scenario', 'script', 'sound', 'voice')


# ---------------- MT19937 / MDF
def _mt_words(init_key, n):
    mt = [0] * 624
    mt[0] = 19650218
    for i in range(1, 624):
        mt[i] = (1812433253 * (mt[i - 1] ^ (mt[i - 1] >> 30)) + i) & 0xFFFFFFFF
    i, j = 1, 0
    for _ in range(max(624, len(init_key))):
        mt[i] = ((mt[i] ^ ((mt[i - 1] ^ (mt[i - 1] >> 30)) * 1664525)) + init_key[j] + j) & 0xFFFFFFFF
        i, j = i + 1, j + 1
        if i >= 624:
            mt[0], i = mt[623], 1
        if j >= len(init_key):
            j = 0
    for _ in range(623):
        mt[i] = ((mt[i] ^ ((mt[i - 1] ^ (mt[i - 1] >> 30)) * 1566083941)) - i) & 0xFFFFFFFF
        i += 1
        if i >= 624:
            mt[0], i = mt[623], 1
    mt[0] = 0x80000000
    out, idx = [], 624
    while len(out) < n:
        if idx >= 624:
            for k in range(624):
                y = (mt[k] & 0x80000000) | (mt[(k + 1) % 624] & 0x7FFFFFFF)
                mt[k] = mt[(k + 397) % 624] ^ (y >> 1) ^ (0x9908B0DF if y & 1 else 0)
            idx = 0
        y = mt[idx]
        idx += 1
        y ^= y >> 11
        y ^= (y << 7) & 0x9D2C5680
        y ^= (y << 15) & 0xEFC60000
        out.append(y ^ (y >> 18))
    return out


@functools.lru_cache(maxsize=4096)
def keystream(seed: str, n=KEY_LEN) -> bytes:
    words = _mt_words(list(struct.unpack('<4I', hashlib.md5(seed.encode('utf-8')).digest())), (n + 3) // 4)
    return struct.pack(f'<{len(words)}I', *words)[:n]


def _xor(data, ks):
    if not data:
        return b''
    rep = (ks * (len(data) // len(ks) + 1))[:len(data)]
    return (int.from_bytes(data, 'little') ^ int.from_bytes(rep, 'little')).to_bytes(len(data), 'little')


def mdf_decode(blob, seed, key_len=KEY_LEN):
    """seed = game_key + keyname"""
    if blob[:4] != b'mdf\0':
        raise ValueError('not mdf')
    raw = zlib.decompress(_xor(blob[8:], keystream(seed, key_len)))
    if len(raw) != struct.unpack_from('<I', blob, 4)[0]:
        raise ValueError('mdf size mismatch')
    return raw


def mdf_encode(raw, seed, level=9, key_len=KEY_LEN):
    return b'mdf\0' + struct.pack('<I', len(raw)) + _xor(zlib.compress(raw, level), keystream(seed, key_len))


def load_key(path=None, romfs=None):
    p = path or os.environ.get('M2_KEY_FILE') or (Path(romfs).resolve().parents[1] / '90_tools' / 'environment' / 'm2_key.txt')
    if not Path(p).is_file():
        sys.exit('M2 key not found: pass -k KEYFILE, set M2_KEY_FILE, or create <project>/90_tools/environment/m2_key.txt')
    return Path(p).read_text(encoding='utf-8').strip()


# ---------------- archives
class Archive:
    def __init__(self, root, arch, key):
        self.root, self.arch, self.key = Path(root), arch, key
        name = f'{arch}_info.psb.m'
        self.info_psb = psb.PSB(mdf_decode((self.root / name).read_bytes(), key + name))
        self.info = self.info_psb.root()
        self.suf = self.info['expire_suffix_list'][0] if self.info.get('expire_suffix_list') else ''
        self.items = [(n, self.keyname(n), o, l) for n, (o, l) in self.info['file_info'].items()]
        self.by_key = {it[1]: it for it in self.items}

    def keyname(self, name):
        b = name.rsplit('/', 1)[-1]
        return b if b.endswith('.m') else b + self.suf

    def stored(self, item, fh=None):
        if fh is None:
            with open(self.root / f'{self.arch}_body.bin', 'rb') as f:
                return self.stored(item, f)
        fh.seek(item[2])
        return fh.read(item[3])

    def raw(self, item, fh=None):
        d = self.stored(item, fh)
        return mdf_decode(d, self.key + item[1]) if d[:4] == b'mdf\0' else d

    def write(self, out_dir, new_raw):
        """new_raw {keyname: decoded bytes} -> out_dir/<arch>_body.bin + _info.psb.m; returns written file names"""
        assert set(new_raw) <= set(self.by_key), f'{self.arch}: new keys {sorted(set(new_raw) - set(self.by_key))[:5]}'
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        body, info = f'{self.arch}_body.bin', f'{self.arch}_info.psb.m'
        fi, pos = self.info['file_info'], 0
        with open(self.root / body, 'rb') as src, open(out_dir / body, 'wb') as dst:
            for n, k, o, l in sorted(self.items, key=lambda it: it[2]):
                data = self.stored((n, k, o, l), src)
                if k in new_raw:
                    data = mdf_encode(new_raw[k], self.key + k) if data[:4] == b'mdf\0' else new_raw[k]
                dst.write(data)
                fi[n][0], fi[n][1] = pos, len(data)
                pos += len(data)
        p = self.info_psb
        (out_dir / info).write_bytes(mdf_encode(psb.dump(self.info, p.chunks, p.version, p.ext_chunks, p.names_section()),
                                                self.key + info))
        return [body, info]


def effective(root, arch, key):
    """{keyname: (Archive, item)} for arch, patch-archive overrides applied"""
    a = Archive(root, arch, key)
    eff = {it[1]: (a, it) for it in a.items}
    if arch != 'patch' and (Path(root) / 'patch_info.psb.m').exists():
        p = Archive(root, 'patch', key)
        eff.update({it[1]: (p, it) for it in p.items if it[0].split('/')[0] == arch})
    return eff


# ---------------- key discovery
def nso_segments(b):
    import lz4.block
    assert b[:4] == b'NSO0'
    flags = struct.unpack_from('<I', b, 0xC)[0]
    out = []
    for i in range(3):
        foff, _moff, size = struct.unpack_from('<3I', b, 0x10 + i * 0x10)
        csize = struct.unpack_from('<I', b, 0x60 + i * 4)[0]
        seg = b[foff:foff + csize]
        out.append(lz4.block.decompress(seg, uncompressed_size=size) if flags & (1 << i) else seg)
    return out


def findkey(nso, sample):
    buf, name = Path(sample).read_bytes(), Path(sample).name
    cands = {m.group().decode() for seg in nso_segments(Path(nso).read_bytes())
             for m in re.finditer(rb'(?<=\0)[\x21-\x7e]{6,40}(?=\0)', seg)}
    for c in sorted(cands):
        for nm in (name, name[:-2]):
            try:
                mdf_decode(buf, c + nm)
                return c
            except Exception:
                continue
    return None


# ---------------- selftest (synthetic archives, no title data)
def selftest():
    assert _mt_words([0x123, 0x234, 0x345, 0x456], 2) == [1067595299, 955945823]  # mt19937ar.c reference output
    raw = b'PSB\0' + bytes(range(256)) * 3
    assert mdf_decode(mdf_encode(raw, 'kx.psb.m'), 'kx.psb.m') == raw
    try:
        mdf_decode(mdf_encode(raw, 'kx.psb.m'), 'other.psb.m')
        raise AssertionError('wrong key decoded')
    except zlib.error:
        pass
    key = 'synthetic-key'
    with tempfile.TemporaryDirectory() as d:
        rom, out = Path(d) / 'romfs', Path(d) / 'out'
        rom.mkdir()

        def make(arch, suf, ents):
            body, fi = bytearray(), {}
            for n, (data, packed) in ents.items():
                kn = (n.rsplit('/', 1)[-1] if n.rsplit('/', 1)[-1].endswith('.m') else n.rsplit('/', 1)[-1] + suf)
                blob = mdf_encode(data, key + kn) if packed else data
                fi[n] = [len(body), len(blob)]
                body += blob
            (rom / f'{arch}_body.bin').write_bytes(bytes(body))
            info = psb.dump({'expire_suffix_list': [suf], 'file_info': fi, 'id': 'archive'})
            (rom / f'{arch}_info.psb.m').write_bytes(mdf_encode(info, key + f'{arch}_info.psb.m'))
        make('scenario', '.scn.m', {'b.txt': (b'B' * 50, True), 'a.txt': (b'A' * 10, True), 'p.png': (b'PNG', False),
                                    'lic.txt.m': (b'L', True)})
        make('patch', '.psb.m', {'scenario/a.txt.scn.m': (b'PA', True), 'image/ev01': (b'I', True)})
        a = Archive(rom, 'scenario', key)
        want = {'b.txt.scn.m': b'B' * 50, 'a.txt.scn.m': b'A' * 10, 'p.png.scn.m': b'PNG', 'lic.txt.m': b'L'}
        assert {k: a.raw(it) for k, it in a.by_key.items()} == want
        assert Archive(rom, 'patch', key).raw(Archive(rom, 'patch', key).by_key['ev01.psb.m']) == b'I'
        eff = effective(rom, 'scenario', key)
        assert eff['a.txt.scn.m'][0].arch == 'patch' and eff['b.txt.scn.m'][0].arch == 'scenario'
        assert a.write(out, {'a.txt.scn.m': b'X' * 999, 'p.png.scn.m': b'PNG2'}) == ['scenario_body.bin', 'scenario_info.psb.m']
        b = Archive(out, 'scenario', key)
        want.update({'a.txt.scn.m': b'X' * 999, 'p.png.scn.m': b'PNG2'})
        assert {k: b.raw(it) for k, it in b.by_key.items()} == want
        bb, ab = b.by_key['b.txt.scn.m'], a.by_key['b.txt.scn.m']
        assert b.stored(bb) == a.stored(ab) and bb[2] == 0  # untouched entry: same stored bytes, offset order kept
        assert b.stored(b.by_key['p.png.scn.m']) == b'PNG2'  # raw entry stays raw
        try:
            a.write(Path(d) / 'out2', {'new.scn.m': b''})
            raise AssertionError('new key accepted')
        except AssertionError as e:
            assert 'new keys' in str(e)
        kf = Path(d) / 'k.txt'
        kf.write_text(key + '\n', encoding='utf-8')
        assert load_key(kf) == key
    print('selftest ok')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('cmd')
    ap.add_argument('args', nargs='*')
    ap.add_argument('-r', '--romfs')
    ap.add_argument('-k', '--key-file')
    ap.add_argument('-o', '--out')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    if a.cmd == 'selftest':
        return selftest()
    if a.cmd == 'findkey':
        nso, sample, out = a.args
        k = findkey(nso, sample)
        if not k:
            sys.exit('NOT FOUND')
        Path(out).write_text(k, encoding='utf-8')  # private local key file, never printed
        return print(f'FOUND key_len={len(k)} -> {out}')
    key, rom, out = load_key(a.key_file, a.romfs), Path(a.romfs), Path(a.out)
    if a.cmd == 'list':
        n, lines = 0, ['archive\tentry\tkeyname\toffset\tlength\n']
        for arch in ARCHS:
            if (rom / f'{arch}_info.psb.m').exists():
                for e, k, o, l in Archive(rom, arch, key).items:
                    lines.append(f'{arch}\t{e}\t{k}\t{o}\t{l}\n')
                    n += 1
        out.write_text(''.join(lines), encoding='utf-8')
        print(f'{n} entries -> {out}')
    elif a.cmd == 'dump':
        for arch in a.args[0].split(','):
            eff, d = effective(rom, arch, key), out / arch
            d.mkdir(parents=True, exist_ok=True)
            rows = ['keyname\tsource\tsize\tsha256\n']
            for k, (ar, it) in sorted(eff.items()):
                raw = ar.raw(it)
                (d / k).write_bytes(raw)
                rows.append(f'{k}\t{ar.arch}\t{len(raw)}\t{hashlib.sha256(raw).hexdigest()}\n')
            (out / f'{arch}_DUMP.tsv').write_text(''.join(rows), encoding='utf-8')
            print(f'{arch}: {len(eff)} entries -> {d}')
    else:
        sys.exit(f'unknown command {a.cmd}')


if __name__ == '__main__':
    main()
