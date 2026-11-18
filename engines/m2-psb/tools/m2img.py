#!/usr/bin/env python3
"""m2img.py - M2 Switch (spec nx) PSB texture codec: export / compose / import (GameTranslateSkills shared tool).

  python -I m2img.py export  -r ROMFS [-k KEYFILE] --arch ARCH --out DIR [KEYNAME ...]
         -> DIR/<arch>/<keyname>/t<NN>.png + textures.tsv (path, res, type, size, icons); patch overrides applied
  python -I m2img.py compose -r ROMFS [-k KEYFILE] --arch ARCH --out DIR KEYNAME ...
         -> DIR/<arch>__compose/<keyname>[__<label>].png (image-spec PSB: imageList[].texture[] tiles pasted)
  python -I m2img.py import  -r ROMFS [-k KEYFILE] --arch ARCH --png-dir DIR --out OUTDIR
         -> OUTDIR/<arch>_body.bin + _info.psb.m with every DIR/<keyname>/t<NN>.png written into that entry of
            ARCH (the archive to rebuild: 'patch' for patch-overridden entries, else the base archive). Same size only.
  python -I m2img.py selftest

Textures: uncompressed linear pixel resources (no swizzle): RGBA8 stored B,G,R,A / A8L8 (L, A) / L8 / A8.
Import replaces a resource's bytes in place (same length), so PSB layout, offsets and header checksum stay valid.
Never add keys to patch_info (ENGINE.md rule 5): import only rewrites entries that already exist in ARCH.
"""
import argparse
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import m2arc  # noqa: E402
import psb  # noqa: E402

BPP = {'RGBA8': 4, 'A8L8': 2, 'L8': 1, 'A8': 1}


def textures(root):
    """yield (path, tex_dict) for every node holding a pixel resource"""
    def walk(v, path):
        if isinstance(v, dict):
            if isinstance(v.get('pixel'), psb.Res) and 'type' in v:
                yield path, v
            for k, x in v.items():
                yield from walk(x, path + (k,))
        elif isinstance(v, list) and not isinstance(v, psb.IntArray):
            for i, x in enumerate(v):
                yield from walk(x, path + (i,))
    yield from walk(root, ())


def chunk_spans(p):
    """absolute (offset, length) of every chunk in the PSB bytes"""
    co, _ = p._array(p.h['chunk_offsets'])
    cl, _ = p._array(p.h['chunk_lengths'])
    return [(p.h['chunk_data'] + o, n) for o, n in zip(co, cl)]


def decode(tex, data):
    w, h, t = tex['width'], tex['height'], tex['type']
    a = np.frombuffer(data, np.uint8)
    assert len(a) == w * h * BPP[t], (t, w, h, len(a))
    if t == 'RGBA8':
        a = a.reshape(h, w, 4)[..., [2, 1, 0, 3]]
    elif t == 'A8L8':
        a = a.reshape(h, w, 2)
        a = np.dstack([a[..., 0], a[..., 0], a[..., 0], a[..., 1]])
    elif t == 'L8':
        a = a.reshape(h, w)
        a = np.dstack([a, a, a, np.full_like(a, 255)])
    else:
        a = a.reshape(h, w)
        a = np.dstack([np.full_like(a, 255)] * 3 + [a])
    return Image.fromarray(np.ascontiguousarray(a), 'RGBA')


def encode(tex, img):
    w, h, t = tex['width'], tex['height'], tex['type']
    a = np.asarray(img.convert('RGBA'), np.uint8)
    assert a.shape[:2] == (h, w), (a.shape, w, h)
    if t == 'RGBA8':
        return np.ascontiguousarray(a[..., [2, 1, 0, 3]]).tobytes()
    if t == 'A8L8':
        return np.ascontiguousarray(np.dstack([a[..., 0], a[..., 3]])).tobytes()
    return np.ascontiguousarray(a[..., 0] if t == 'L8' else a[..., 3]).tobytes()


def tex_list(raw):
    p = psb.PSB(raw)
    r, spans = p.root(), chunk_spans(p)
    return r, [(k, path, tex, int(tex['pixel']), raw[spans[int(tex['pixel'])][0]:sum(spans[int(tex['pixel'])])])
               for k, (path, tex) in enumerate(textures(r))]


def replace_res(raw, repl):
    """repl {res_index: bytes}; same-length in-place replacement"""
    spans, buf = chunk_spans(psb.PSB(raw)), bytearray(raw)
    for i, data in repl.items():
        o, n = spans[i]
        assert len(data) == n, (i, len(data), n)
        buf[o:o + n] = data
    return bytes(buf)


def icons_of(r, path):
    parent = r
    for x in path[:-1]:
        parent = parent[x]
    return parent.get('icon') if isinstance(parent, dict) else None


def export(eff, arch, out, keys):
    for key in keys or sorted(eff):
        A, it = eff[key]
        raw = A.raw(it)
        if raw[:4] != b'PSB\0':
            continue
        r, tl = tex_list(raw)
        d = Path(out) / arch / key
        d.mkdir(parents=True, exist_ok=True)
        rows = ['tex\tpath\tres\ttype\tw\th\ttrunc_w\ttrunc_h\tsource\ticon\tleft\ttop\tiw\tih\toriginX\toriginY']
        for k, path, tex, ri, data in tl:
            decode(tex, data).save(d / f't{k:02d}.png')
            base = [str(k), '/'.join(map(str, path)), str(ri), tex['type'], str(tex['width']), str(tex['height']),
                    str(tex.get('truncated_width', '')), str(tex.get('truncated_height', '')), A.arch]
            for name, v in (icons_of(r, path) or {'': None}).items():
                rows.append('\t'.join(base + ([str(name), str(int(v['left'])), str(int(v['top'])), str(v['width']),
                                               str(v['height']), str(v.get('originX', '')), str(v.get('originY', ''))]
                                              if v else [''] * 7)))
        (d / 'textures.tsv').write_text('\n'.join(rows) + '\n', encoding='utf-8')
        print(f'{arch}/{key} [{A.arch}]: {len(tl)} textures')


def compose(eff, arch, out, keys):
    d = Path(out) / f'{arch}__compose'
    d.mkdir(parents=True, exist_ok=True)
    for key in keys:
        A, it = eff[key]
        raw = A.raw(it)
        p = psb.PSB(raw)
        spans, ims = chunk_spans(p), p.root().get('imageList', [])
        for im in ims:
            canvas = Image.new('RGBA', (im['width'], im['height']))
            for t in im['texture']:
                tex = t['image']
                o, n = spans[int(tex['pixel'])]
                canvas.paste(decode(tex, raw[o:o + n]).crop((0, 0, int(t['width']), int(t['height']))),
                             (int(t['left']), int(t['top'])))
            canvas.save(d / (f'{key}.png' if len(ims) == 1 else f'{key}__{im["label"]}.png'))


def import_pngs(A, png_dir):
    """{keyname: patched raw} for every <png_dir>/<keyname>/t<NN>.png that differs from the entry"""
    new = {}
    for d in sorted(Path(png_dir).iterdir()):
        if not d.is_dir():
            continue
        assert d.name in A.by_key, f'{d.name}: not an entry of {A.arch} (no new keys)'
        raw = A.raw(A.by_key[d.name])
        _, tl = tex_list(raw)
        repl = {}
        for k, _path, tex, ri, data in tl:
            f = d / f't{k:02d}.png'
            if f.exists():
                b = encode(tex, Image.open(f))
                if b != data:
                    repl[ri] = b
        if repl:
            new[d.name] = replace_res(raw, repl)
    return new


def selftest():
    rng = np.random.default_rng(1)
    texs = [('RGBA8', 4, 3), ('A8L8', 2, 5), ('L8', 3, 3), ('A8', 5, 2)]
    chunks = [rng.integers(0, 256, w * h * BPP[t], np.uint8).tobytes() for t, w, h in texs]
    layers = [{'icon': {'i0': {'left': 1, 'top': 0, 'width': 2, 'height': 2}},
               'texture': {'pixel': psb.Res(i), 'type': t, 'width': w, 'height': h}} for i, (t, w, h) in enumerate(texs)]
    raw = psb.dump({'layers': layers, 'spec': 'nx'}, chunks)
    _, tl = tex_list(raw)
    assert [x[2]['type'] for x in tl] == [t for t, _, _ in texs] and [x[4] for x in tl] == chunks
    for k, path, tex, ri, data in tl:
        assert encode(tex, decode(tex, data)) == data, tex['type']
    assert decode(tl[0][2], tl[0][4]).getpixel((0, 0))[:3] == tuple(chunks[0][2::-1])  # BGRA storage
    assert replace_res(raw, {0: chunks[0]}) == raw
    tile = psb.dump({'imageList': [{'label': 'a', 'width': 6, 'height': 3, 'texture': [
        {'left': 0, 'top': 0, 'width': 4, 'height': 3, 'image': {'pixel': psb.Res(0), 'type': 'RGBA8', 'width': 4, 'height': 3}},
        {'left': 4, 'top': 0, 'width': 2, 'height': 3, 'image': {'pixel': psb.Res(1), 'type': 'L8', 'width': 3, 'height': 3}}]}]},
        [chunks[0], chunks[2]])
    key = 'synthetic-key'
    with tempfile.TemporaryDirectory() as d:
        rom = Path(d) / 'romfs'
        rom.mkdir()
        body, fi = bytearray(), {}
        for n, b in (('ev01', raw), ('page', tile)):
            blob = m2arc.mdf_encode(b, key + n + '.psb.m')
            fi[n] = [len(body), len(blob)]
            body += blob
        (rom / 'image_body.bin').write_bytes(bytes(body))
        info = psb.dump({'expire_suffix_list': ['.psb.m'], 'file_info': fi})
        (rom / 'image_info.psb.m').write_bytes(m2arc.mdf_encode(info, key + 'image_info.psb.m'))
        eff = m2arc.effective(rom, 'image', key)
        export(eff, 'image', Path(d) / 'x', [])
        assert (Path(d) / 'x' / 'image' / 'ev01.psb.m' / 't03.png').exists()
        compose(eff, 'image', Path(d) / 'x', ['page.psb.m'])
        c = Image.open(Path(d) / 'x' / 'image__compose' / 'page.psb.m.png')
        assert c.size == (6, 3) and c.getpixel((4, 0)) == (chunks[2][0],) * 3 + (255,)
        A = m2arc.Archive(rom, 'image', key)
        assert import_pngs(A, Path(d) / 'x' / 'image') == {}  # unchanged PNGs -> nothing to write
        f = Path(d) / 'x' / 'image' / 'ev01.psb.m' / 't02.png'
        im = Image.open(f).convert('RGBA')
        im.putpixel((0, 0), (7, 7, 7, 255))
        im.save(f)
        new = import_pngs(A, Path(d) / 'x' / 'image')
        A.write(Path(d) / 'o', new)
        B = m2arc.Archive(Path(d) / 'o', 'image', key)
        _, tl2 = tex_list(B.raw(B.by_key['ev01.psb.m']))
        assert tl2[2][4][0] == 7 and tl2[2][4][1:] == chunks[2][1:] and [x[4] for x in tl2[:2]] == chunks[:2]
        assert B.raw(B.by_key['page.psb.m']) == tile
    print('selftest ok')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('cmd', choices=('export', 'compose', 'import', 'selftest'))
    ap.add_argument('keys', nargs='*')
    ap.add_argument('-r', '--romfs')
    ap.add_argument('-k', '--key-file')
    ap.add_argument('--arch')
    ap.add_argument('--out')
    ap.add_argument('--png-dir')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    if a.cmd == 'selftest':
        return selftest()
    key = m2arc.load_key(a.key_file, a.romfs)
    if a.cmd == 'import':
        if Path(a.out).exists():
            sys.exit(f'refuse: {a.out} exists')
        A = m2arc.Archive(a.romfs, a.arch, key)
        new = import_pngs(A, a.png_dir)
        files = A.write(a.out, new) if new else []
        return print(f'import entries={len(new)} files={files} -> {a.out}')
    eff = m2arc.effective(a.romfs, a.arch, key)
    (export if a.cmd == 'export' else compose)(eff, a.arch, a.out, a.keys)


if __name__ == '__main__':
    sys.exit(main())
