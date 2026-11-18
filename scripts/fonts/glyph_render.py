#!/usr/bin/env python3
"""glyph_render.py - neutral bitmap glyph set: ONE font size and ONE baseline for every generated char.

  python -I glyph_render.py render --font F.ttf --out PREFIX [charset] (--size PX | --ref-px H [--ref-chars あ])
                                   [--cell-w W] [--cell-h H] [--baseline B] [--pad 1] [--cols 64] [--mode L|RGBA]
  python -I glyph_render.py selftest

charset: same options as ttf_append.py (--chars FILE | --manifest TSV [--column target_ko] | --all-hangul).
Scale: --size is the FreeType pixel size. --ref-px H picks the size whose mean ink height (alpha>=128) of --ref-chars
  equals H (measure the same chars in the original atlas). Derived once for the whole set, never per character
  (per-character scaling gives visibly inconsistent in-game sizes).
Baseline: --baseline, else fitted to the set's max ascent/descent (+pad), centred when --cell-h is larger.
Tile: every char gets a cell_w x cell_h tile; pen origin at (origin_x, baseline), origin_x centres the advance.
Output (refuses to overwrite): PREFIX.png grid atlas (row-major, --cols tiles per row; L = alpha, RGBA = white+alpha),
  PREFIX.json global params, PREFIX.tsv per glyph:
  char cp index x y origin_x advance ink_x0 ink_y0 ink_x1 ink_y1 clipped
  (x,y = tile position in the atlas; ink box = alpha>0, tile-relative, end-exclusive, empty for blank;
   clipped = ink pixels lost outside the tile).
Engine serializers (M2 textfont psb, Unity TMP SDF, Shin FNT) live in engines/<engine>/tools and consume these files.
"""
import argparse
import hashlib
import io
import json
import math
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ttf_append as TA  # noqa: E402  (GT_PYLIB path + shared charset options)

COLS = 'char cp index x y origin_x advance ink_x0 ink_y0 ink_x1 ink_y1 clipped'.split()


def load(raw, size):
    from PIL import ImageFont
    return ImageFont.truetype(io.BytesIO(raw), size, layout_engine=ImageFont.Layout.BASIC)


def ink_height(raw, chars, size):
    """mean ink height (alpha>=128) of chars at size"""
    from PIL import Image, ImageDraw
    f, n, hs = load(raw, size), int(size) * 3 + 8, []
    for c in chars:
        im = Image.new('L', (n, n))
        ImageDraw.Draw(im).text((n // 3, 2 * n // 3), c, font=f, fill=255, anchor='ls')
        b = im.point(lambda v: 255 if v >= 128 else 0).getbbox()
        hs.append(b[3] - b[1] if b else 0)
    return sum(hs) / len(hs)


def ink(im):
    return sum(im.histogram()[1:])


def render(font, chars, out, size=None, ref_px=None, ref_chars='あ', cell_w=None, cell_h=None, baseline=None,
           pad=1, cols=64, mode='L'):
    from PIL import Image, ImageDraw
    paths = [Path(f'{out}.{e}') for e in ('png', 'tsv', 'json')]
    if any(p.exists() for p in paths):
        raise SystemExit(f'refuse to overwrite {out}.*')
    raw = Path(font).read_bytes()
    cm = TA.font(raw).getBestCmap()
    missing = [c for c in list(chars) + list(ref_chars if size is None else '') if ord(c) not in cm]
    if missing:
        raise SystemExit(f'font lacks {len(missing)} chars, e.g. {missing[:10]}')
    if size is None:
        size = round(100 * ref_px / ink_height(raw, ref_chars, 100), 4)
    f = load(raw, size)
    box = {c: f.getbbox(c, anchor='ls') for c in chars}
    adv = {c: f.getlength(c) for c in chars}
    asc = max(0, -min(b[1] for b in box.values()))
    desc = max(0, max(b[3] for b in box.values()))
    if cell_w is None:  # symmetric margin covers ink overhanging the centred advance on either side
        cell_w = math.ceil(max(adv[c] + 2 * max(0, -box[c][0], box[c][2] - adv[c]) for c in chars)) + 2 * pad
    if cell_h is None:
        cell_h = asc + desc + 2 * pad
    if baseline is None:
        baseline = pad + asc + (cell_h - 2 * pad - asc - desc) // 2
    rows = -(-len(chars) // cols)
    atlas = Image.new('L', (cols * cell_w, rows * cell_h))
    m = cell_w + cell_h  # canvas margin so overflow is counted, not lost
    lines, clipped_total = ['\t'.join(COLS)], 0
    for i, c in enumerate(chars):
        ox = round((cell_w - adv[c]) / 2)
        im = Image.new('L', (cell_w + 2 * m, cell_h + 2 * m))
        ImageDraw.Draw(im).text((m + ox, m + baseline), c, font=f, fill=255, anchor='ls')
        tile = im.crop((m, m, m + cell_w, m + cell_h))
        clipped = ink(im) - ink(tile)
        clipped_total += clipped
        x, y = i % cols * cell_w, i // cols * cell_h
        atlas.paste(tile, (x, y))
        b = tile.getbbox() or ('',) * 4
        lines.append('\t'.join(map(str, (c if c.isprintable() and not c.isspace() else '', f'U+{ord(c):04X}', i, x, y,
                                         ox, round(adv[c], 4), *b, clipped))))
    meta = {'font': str(font), 'font_sha256': hashlib.sha256(raw).hexdigest(), 'size_px': size,
            'ref': {'chars': ref_chars, 'target_px': ref_px, 'measured_px': round(ink_height(raw, ref_chars, size), 3)}
            if ref_px is not None else None,
            'baseline': baseline, 'ascent': asc, 'descent': desc, 'cell_w': cell_w, 'cell_h': cell_h, 'pad': pad,
            'cols': cols, 'rows': rows, 'mode': mode, 'count': len(chars), 'clipped_px_total': clipped_total}
    if mode == 'RGBA':
        white = Image.new('L', atlas.size, 255)
        atlas = Image.merge('RGBA', (white, white, white, atlas))
    paths[0].parent.mkdir(parents=True, exist_ok=True)
    atlas.save(paths[0])
    paths[1].write_text('\n'.join(lines) + '\n', encoding='utf-8', newline='\n')
    paths[2].write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf-8')
    return meta


def read_tsv(p):
    hdr, *rows = Path(p).read_text(encoding='utf-8').rstrip('\n').split('\n')
    return [dict(zip(hdr.split('\t'), r.split('\t'))) for r in rows]


# ---------- selftest (system font only; no title data)
def selftest():
    from PIL import Image, ImageDraw
    malgun = Path(r'C:\Windows\Fonts\malgun.ttf')
    if not malgun.exists():
        print(f'selftest SKIPPED: {malgun} missing')
        return
    chars = list('가한.gA ')
    with tempfile.TemporaryDirectory(prefix='glyph_render_', ignore_cleanup_errors=True) as d:
        d = Path(d)
        m = render(malgun, chars, d / 'set', ref_px=24, ref_chars='가', cols=4)
        assert abs(m['ref']['measured_px'] - 24) <= 1 and m['clipped_px_total'] == 0, m
        rows, atlas = read_tsv(d / 'set.tsv'), Image.open(d / 'set.png')
        assert len(rows) == len(chars) == m['count'] and atlas.size == (4 * m['cell_w'], 2 * m['cell_h'])
        r = {chr(int(x['cp'][2:], 16)): x for x in rows}
        for x in rows:  # metrics file == atlas pixels
            t = atlas.crop((int(x['x']), int(x['y']), int(x['x']) + m['cell_w'], int(x['y']) + m['cell_h']))
            assert (t.getbbox() or ('',) * 4) == tuple(int(v) if v else '' for v in (x['ink_x0'], x['ink_y0'], x['ink_x1'], x['ink_y1'])), x
        assert r[' ']['ink_x0'] == '' and float(r[' ']['advance']) > 0
        # one common scale + baseline: each cell's ink sits where a standalone render at the same size puts it
        f = load(malgun.read_bytes(), m['size_px'])
        for c in '가한g.':
            im = Image.new('L', (200, 200)); ImageDraw.Draw(im).text((50, 100), c, font=f, fill=255, anchor='ls')
            b = im.getbbox()
            assert (int(r[c]['ink_y0']) - m['baseline'], int(r[c]['ink_y1']) - m['baseline']) == (b[1] - 100, b[3] - 100), c
        h = {c: int(r[c]['ink_y1']) - int(r[c]['ink_y0']) for c in '가.'}
        assert h['.'] < 0.3 * h['가'], h  # no per-char normalisation
        assert int(r['g']['ink_y1']) > max(m['baseline'], int(r['가']['ink_y1']))  # descender below the shared baseline
        # glyph pixels independent of the rest of the set
        m1 = render(malgun, ['가'], d / 'one', size=m['size_px'], cell_w=m['cell_w'], cell_h=m['cell_h'],
                    baseline=m['baseline'], cols=1)
        t0 = atlas.crop((int(r['가']['x']), int(r['가']['y']), int(r['가']['x']) + m['cell_w'], int(r['가']['y']) + m['cell_h']))
        assert Image.open(d / 'one.png').tobytes() == t0.tobytes() and m1['clipped_px_total'] == 0
        # RGBA mode keeps the same alpha; missing glyphs and overwrites fail closed
        render(malgun, chars, d / 'rgba', size=m['size_px'], mode='RGBA', cols=4)
        assert Image.open(d / 'rgba.png').getchannel('A').tobytes() == atlas.tobytes()
        for bad in (lambda: render(malgun, ['\U0001F600'], d / 'x', size=20), lambda: render(malgun, chars, d / 'set', size=20)):
            try:
                bad()
                raise AssertionError('not refused')
            except SystemExit:
                pass
    print('selftest ok')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('render')
    p.add_argument('--font', required=True); p.add_argument('--out', required=True)
    TA.add_charset_args(p)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument('--size', type=float); g.add_argument('--ref-px', type=float)
    p.add_argument('--ref-chars', default='あ')
    for k in ('--cell-w', '--cell-h', '--baseline'):
        p.add_argument(k, type=int)
    p.add_argument('--pad', type=int, default=1); p.add_argument('--cols', type=int, default=64)
    p.add_argument('--mode', choices=('L', 'RGBA'), default='L')
    sub.add_parser('selftest')
    a = ap.parse_args()
    if TA.MISSING:
        if a.cmd == 'selftest':
            print(f'selftest SKIPPED: {TA.MISSING} (set GT_PYLIB to a dir with fontTools + Pillow)')
            return
        raise SystemExit(f'missing library: {TA.MISSING} (set GT_PYLIB)')
    if a.cmd == 'selftest':
        return selftest()
    m = render(a.font, TA.charset_of(a), a.out, a.size, a.ref_px, a.ref_chars, a.cell_w, a.cell_h, a.baseline,
               a.pad, a.cols, a.mode)
    print(json.dumps(m))


if __name__ == '__main__':
    main()
