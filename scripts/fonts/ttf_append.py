#!/usr/bin/env python3
"""ttf_append.py - append donor glyphs (e.g. Hangul) to an original TrueType font; original glyphs stay byte-exact.

  python -I ttf_append.py build  --orig ORIG.ttf --donor KO.ttf|.otf --out NEW.ttf [charset] [--scale F] [--dy UNITS]
  python -I ttf_append.py verify --orig ORIG.ttf --out NEW.ttf [charset]
  python -I ttf_append.py selftest

charset (union): --chars FILE (every char of a UTF-8 text file; control chars ignored)
                 | --manifest TSV [--column target_ko] | --all-hangul (U+AC00-D7A3 + compat jamo U+3131-318E).
                 build skips chars the original already maps; verify checks every char is mapped and non-blank.
Transform: ONE affine for every new glyph: s = orig_upem / donor_upem * --scale, y += --dy (original units);
  advance = round(donor advance * s), outline centred on the rounding remainder. CFF donors go through cu2qu.
Preserved: glyf bytes, hmtx/vmtx and cmap entries of every original glyph; every other table raw-identical.
Changed: glyf/loca/hmtx/vmtx/cmap/post (names appended) + bounds-only fields of head/hhea/vhea/maxp.
Dropped (per-glyph tables that would turn invalid): hdmx, LTSH, DSIG. Original must be static TrueType (glyf).
build refuses to overwrite, writes NEW.ttf + NEW.ttf.json (params) and runs verify (exit 1 on any issue).
Libraries: fontTools + Pillow from GT_PYLIB (default E:\\NSW\\_tools\\python).
"""
import argparse
import csv
import hashlib
import io
import json
import os
import struct
import sys
import tempfile
import unicodedata
from pathlib import Path

sys.path.insert(0, os.environ.get('GT_PYLIB', r'E:\NSW\_tools\python'))
try:
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.pens.cu2quPen import Cu2QuPen
    from fontTools.pens.recordingPen import DecomposingRecordingPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    from fontTools.ttLib import TTFont
    from fontTools.ttLib.tables.DefaultTable import DefaultTable
    from PIL import ImageFont
    MISSING = None
except ImportError as e:
    MISSING = e

HANGUL = [chr(c) for c in range(0xAC00, 0xD7A4)] + [chr(c) for c in range(0x3131, 0x318F)]
BLANK_OK = '\u3164'  # HANGUL FILLER is blank by design (whitespace is also allowed blank)
CHANGED = {'glyf', 'loca', 'hmtx', 'vmtx', 'cmap', 'post', 'head', 'hhea', 'vhea', 'maxp'}
DROPPED = ('hdmx', 'LTSH', 'DSIG')
BOUND_FIELDS = {'head': {'checkSumAdjustment', 'indexToLocFormat', 'xMin', 'yMin', 'xMax', 'yMax'},
                'hhea': {'numberOfHMetrics', 'advanceWidthMax', 'minLeftSideBearing', 'minRightSideBearing', 'xMaxExtent'},
                'vhea': {'numberOfVMetrics', 'advanceHeightMax', 'minTopSideBearing', 'minBottomSideBearing', 'yMaxExtent'},
                'maxp': {'numGlyphs', 'maxPoints', 'maxContours'}}


def sha(b):
    return hashlib.sha256(b).hexdigest()


def font(path_or_bytes):
    """TTFont from bytes (no open file handle; first face of a TTC)."""
    b = path_or_bytes if isinstance(path_or_bytes, bytes) else Path(path_or_bytes).read_bytes()
    return TTFont(io.BytesIO(b), fontNumber=0)


# ---------- charset (shared with glyph_render.py)
def add_charset_args(p):
    p.add_argument('--chars', help='UTF-8 text file; every char is wanted')
    p.add_argument('--manifest', help='TSV manifest; chars of --column are wanted')
    p.add_argument('--column', default='target_ko')
    p.add_argument('--all-hangul', action='store_true', help='U+AC00-D7A3 + compat jamo U+3131-318E')


def charset_of(a):
    s = set(HANGUL) if a.all_hangul else set()
    if a.chars:
        s |= set(Path(a.chars).read_text(encoding='utf-8-sig'))
    if a.manifest:
        csv.field_size_limit(1 << 30)
        with open(a.manifest, encoding='utf-8-sig', newline='') as f:
            rd = csv.DictReader(f, delimiter='\t', quoting=csv.QUOTE_NONE)
            if a.column not in (rd.fieldnames or ()):
                raise SystemExit(f'manifest has no column {a.column!r}')
            for r in rd:
                s |= set(r[a.column] or '')
    s = sorted(c for c in s if unicodedata.category(c)[0] != 'C')
    if not s:
        raise SystemExit('empty charset: give --chars, --manifest or --all-hangul')
    return s


# ---------- build
def build(orig, donor, out, chars, scale=1.0, dy=0.0):
    out = Path(out)
    if out.exists() or Path(f'{out}.json').exists():
        raise SystemExit(f'refuse to overwrite {out}')
    raw, draw_ = Path(orig).read_bytes(), Path(donor).read_bytes()
    ref, src, don = font(raw), font(raw), font(draw_)
    if 'glyf' not in src or 'fvar' in src:
        raise SystemExit('original must be a static TrueType (glyf) font')
    for t in ('glyf', 'hmtx', 'vmtx', 'cmap', 'maxp', 'head', 'hhea', 'vhea'):
        if t in src:
            src[t]  # decompile against the original glyph order before it grows
    upem = src['head'].unitsPerEm
    s = upem / don['head'].unitsPerEm * scale
    cm0 = src.getBestCmap()
    add = [c for c in chars if ord(c) not in cm0]
    if not add:
        raise SystemExit('nothing to add: the original already maps the whole charset')
    dcm, dgs = don.getBestCmap(), don.getGlyphSet()
    missing = [c for c in add if ord(c) not in dcm]
    if missing:
        raise SystemExit(f'donor lacks {len(missing)} chars, e.g. {missing[:10]}')

    old = src.getGlyphOrder()
    n0, taken, names = len(old), set(old), []
    for c in add:
        nm = f'uni{ord(c):04X}' if ord(c) < 0x10000 else f'u{ord(c):05X}'
        while nm in taken:
            nm += '.ko'
        taken.add(nm)
        names.append(nm)
    order = old + names
    post = src.reader['post']
    src.setGlyphOrder(order)
    glyf = src['glyf']
    glyf.glyphOrder = order

    vorg = None
    if 'vmtx' in src:  # vertical origin of a reference full-width original glyph, else the ascender
        rcm, rgs = ref.getBestCmap(), ref.getGlyphSet()
        r = next((rcm[ord(c)] for c in '国あ' if ord(c) in rcm), None)
        if r:
            bp = BoundsPen(rgs); rgs[r].draw(bp)
        vorg = ref['vmtx'][r][1] + bp.bounds[3] if r and bp.bounds else ref['hhea'].ascent
    cubic = 'glyf' not in don
    for c, nm in zip(add, names):
        gn = dcm[ord(c)]
        adv_d = don['hmtx'][gn][0]
        adv = round(adv_d * s)
        rec = DecomposingRecordingPen(dgs); dgs[gn].draw(rec)
        tp = TTGlyphPen(None)
        rec.replay(TransformPen(Cu2QuPen(tp, max_err=1.0, reverse_direction=True) if cubic else tp,
                                (s, 0, 0, s, (adv - adv_d * s) / 2, dy)))
        g = tp.glyph()
        if g.numberOfContours:
            g.recalcBounds(glyf)
        glyf.glyphs[nm] = g
        src['hmtx'].metrics[nm] = (adv, g.xMin if g.numberOfContours else 0)
        if vorg is not None:
            src['vmtx'].metrics[nm] = (upem, vorg - g.yMax if g.numberOfContours else 0)
    for t in src['cmap'].tables:
        if t.isUnicode() and t.format in (4, 12):
            t.cmap.update({ord(c): nm for c, nm in zip(add, names) if t.format == 12 or ord(c) < 0x10000})

    # post: keep the original bytes; v2 appends name indices + Pascal strings for the new glyphs
    ver = struct.unpack_from('>I', post)[0]
    if ver == 0x00020000:
        assert struct.unpack_from('>H', post, 32)[0] == n0
        strs, i, k = post[34 + 2 * n0:], 0, 0
        while i < len(strs):
            i, k = i + 1 + strs[i], k + 1
        post = (post[:32] + struct.pack('>H', len(order)) + post[34:34 + 2 * n0]
                + b''.join(struct.pack('>H', 258 + k + j) for j in range(len(names)))
                + strs + b''.join(bytes([len(nm)]) + nm.encode('ascii') for nm in names))
    elif ver != 0x00030000:
        raise SystemExit(f'unsupported post version {ver:#x}')
    pt = DefaultTable('post'); pt.data = post
    src['post'] = pt
    dropped = [t for t in DROPPED if t in src]
    for t in dropped:
        del src[t]

    # recalcBBoxes=False keeps every original glyf record byte-exact; widen global bounds from the new glyphs only
    hm = src['hmtx'].metrics
    pairs = [(nm, glyf.glyphs[nm]) for nm in names if glyf.glyphs[nm].numberOfContours > 0]
    mp, hd, hh = src['maxp'], src['head'], src['hhea']
    hh.advanceWidthMax = max(hh.advanceWidthMax, max(hm[nm][0] for nm in names))
    if pairs:
        new = [g for _, g in pairs]
        mp.maxPoints = max(mp.maxPoints, max(len(g.coordinates) for g in new))
        mp.maxContours = max(mp.maxContours, max(g.numberOfContours for g in new))
        hd.xMin, hd.yMin = min(hd.xMin, min(g.xMin for g in new)), min(hd.yMin, min(g.yMin for g in new))
        hd.xMax, hd.yMax = max(hd.xMax, max(g.xMax for g in new)), max(hd.yMax, max(g.yMax for g in new))
        hh.minLeftSideBearing = min(hh.minLeftSideBearing, min(g.xMin for g in new))
        hh.minRightSideBearing = min(hh.minRightSideBearing, min(hm[nm][0] - g.xMax for nm, g in pairs))
        hh.xMaxExtent = max(hh.xMaxExtent, max(g.xMax for g in new))
        if vorg is not None and 'vhea' in src:
            vh = src['vhea']
            vh.advanceHeightMax = max(vh.advanceHeightMax, upem)
            vh.minTopSideBearing = min(vh.minTopSideBearing, min(vorg - g.yMax for g in new))
            vh.minBottomSideBearing = min(vh.minBottomSideBearing, min(upem - (vorg - g.yMin) for g in new))
            vh.yMaxExtent = max(vh.yMaxExtent, max(vorg - g.yMin for g in new))
    src.recalcBBoxes = False
    src.recalcTimestamp = False
    bio = io.BytesIO(); src.save(bio)
    nb = bio.getvalue()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(nb)
    meta = {'orig': str(orig), 'orig_sha256': sha(raw), 'donor': str(donor), 'donor_sha256': sha(draw_),
            'out_sha256': sha(nb), 'orig_upem': upem, 'donor_upem': don['head'].unitsPerEm, 'scale_param': scale,
            'scale': round(s, 6), 'dy_units': dy, 'vertical_origin': vorg, 'cubic_donor': cubic, 'added': len(add),
            'glyphs_before': n0, 'glyphs_after': len(order), 'dropped_tables': dropped,
            'added_codepoints': ''.join(add)}
    Path(f'{out}.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf-8')
    return meta


# ---------- verify
def verify(orig, out, chars):
    r0, r1 = Path(orig).read_bytes(), Path(out).read_bytes()
    f0, f1 = font(r0), font(r1)
    issues = []
    o0, o1 = f0.getGlyphOrder(), f1.getGlyphOrder()
    n0 = len(o0)
    if len(o1) < n0:
        return [f'glyph count shrank {n0} -> {len(o1)}'], {}
    l0, l1, g0, g1 = f0['loca'], f1['loca'], f0.reader['glyf'], f1.reader['glyf']
    gbad = sum(g0[l0[i]:l0[i + 1]].rstrip(b'\0') != g1[l1[i]:l1[i + 1]].rstrip(b'\0') for i in range(n0))
    mbad = sum(f0[t][o0[i]] != f1[t][o1[i]] for t in ('hmtx', 'vmtx') if t in f0 for i in range(n0))
    gid0, gid1 = f0.getReverseGlyphMap(), f1.getReverseGlyphMap()
    cbad = 0
    for t0 in f0['cmap'].tables:
        t1 = f1['cmap'].getcmap(t0.platformID, t0.platEncID)
        cbad += sum(t1 is None or gid1.get(t1.cmap.get(cp)) != gid0[nm] for cp, nm in t0.cmap.items())
    if gbad or mbad or cbad:
        issues.append(f'original glyphs changed: glyf={gbad} metrics={mbad} cmap={cbad}')
    tbad = [t for t in f0.reader.keys() if t not in CHANGED and t not in DROPPED
            and (t not in f1.reader or f0.reader[t] != f1.reader[t])]
    tbad += sorted(set(f1.reader.keys()) - set(f0.reader.keys()))
    for t, skip in BOUND_FIELDS.items():
        if t in f0:
            a = {k: v for k, v in vars(f0[t]).items() if k not in skip}
            b = {k: v for k, v in vars(f1[t]).items() if k not in skip}
            tbad += [f'{t}.{k}' for k in a if a[k] != b.get(k)]
    p0, p1 = f0.reader['post'], f1.reader['post']
    if p0[:32] != p1[:32] or (struct.unpack_from('>I', p0)[0] == 0x00020000 and (
            p1[34:34 + 2 * n0] != p0[34:34 + 2 * n0] or not p1[34 + 2 * len(o1):].startswith(p0[34 + 2 * n0:]))):
        tbad.append('post')
    if tbad:
        issues.append(f'tables/fields changed: {tbad}')
    gl, hd, mp, hm = f1['glyf'], f1['head'], f1['maxp'], f1['hmtx']
    for nm in o1[n0:]:
        g = gl[nm]
        if g.numberOfContours and not (hd.xMin <= g.xMin and hd.yMin <= g.yMin and g.xMax <= hd.xMax and g.yMax <= hd.yMax
                                       and len(g.coordinates) <= mp.maxPoints and g.numberOfContours <= mp.maxContours
                                       and hm[nm][0] <= f1['hhea'].advanceWidthMax):
            issues.append(f'global bounds do not cover new glyph {nm}')
            break
    cm1 = f1.getBestCmap()
    pil = ImageFont.truetype(io.BytesIO(r1), 32)
    unmapped = [c for c in chars if ord(c) not in cm1]
    blank = [c for c in chars if ord(c) in cm1 and not (c.isspace() or c in BLANK_OK)
             and (lambda b: b[2] <= b[0] or b[3] <= b[1])(pil.getbbox(c))]
    if unmapped or blank:
        issues.append(f'charset: unmapped={len(unmapped)} {unmapped[:10]} blank={len(blank)} {blank[:10]}')
    summary = {'glyphs_before': n0, 'glyphs_after': len(o1), 'glyf_bad': gbad, 'metrics_bad': mbad, 'cmap_bad': cbad,
               'charset': len(chars), 'unmapped': len(unmapped), 'blank': len(blank), 'out_sha256': sha(r1)}
    return issues, summary


# ---------- selftest (system fonts only; no title data)
def selftest():
    import logging
    from fontTools import subset
    from fontTools.fontBuilder import FontBuilder
    logging.getLogger('fontTools.subset').setLevel(logging.ERROR)
    from fontTools.pens.t2CharStringPen import T2CharStringPen
    arial, malgun = Path(r'C:\Windows\Fonts\arial.ttf'), Path(r'C:\Windows\Fonts\malgun.ttf')
    if not (arial.exists() and malgun.exists()):
        print(f'selftest SKIPPED: system fonts missing ({arial}, {malgun})')
        return
    with tempfile.TemporaryDirectory(prefix='ttf_append_', ignore_cleanup_errors=True) as d:
        d = Path(d)
        # synthetic hinted original: arial subset (post v2 names kept)
        o = subset.Options(); o.glyph_names = True; o.notdef_outline = True
        f = font(arial); ss = subset.Subsetter(o); ss.populate(text='ABC abc 012.'); ss.subset(f)
        f['post'].formatType, f['post'].mapping, f['post'].extraNames = 2.0, {}, []  # subsetter emits v3; v2 exercises the name-append path
        orig = d / 'orig.ttf'; f.save(orig)
        assert 'hdmx' in f  # exercises the dropped per-glyph table path
        # tiny CFF donor (upem 1000, cubic outline) -> exercises upem scaling + cu2qu
        def cs(draw, w):
            p = T2CharStringPen(w, None); draw(p); return p.getCharString()

        def shape(p):
            p.moveTo((100, 0)); p.lineTo((100, 700)); p.curveTo((300, 800), (500, 800), (600, 700))
            p.lineTo((600, 0)); p.closePath()
        fb = FontBuilder(1000, isTTF=False)
        fb.setupGlyphOrder(['.notdef', 'ga'])
        fb.setupCharacterMap({0xAC00: 'ga'})
        fb.setupCFF('Donor', {'FullName': 'Donor'}, {'.notdef': cs(lambda p: None, 500), 'ga': cs(shape, 900)}, {})
        fb.setupHorizontalMetrics({'.notdef': (500, 0), 'ga': (900, 100)})
        fb.setupHorizontalHeader(ascent=800, descent=-200)
        fb.setupNameTable({'familyName': 'Donor', 'styleName': 'Regular'})
        fb.setupOS2(); fb.setupPost()
        cff = d / 'donor.otf'; fb.save(cff)

        out1 = d / 'cff.ttf'
        m = build(orig, cff, out1, ['A', '가'])
        assert m['added'] == 1 and m['scale'] == round(2048 / 1000, 6) and m['cubic_donor'], m
        f1 = font(out1.read_bytes())
        g = f1['glyf']['uniAC00']
        assert f1['hmtx']['uniAC00'][0] == round(900 * 2.048) and g.numberOfContours == 1
        assert all(not fl & 0x80 for fl in g.flags), 'cubic flag in output'  # cu2qu produced quadratic curves
        assert abs(g.xMin - 100 * 2.048) <= 1 and g.yMax > 700 * 2.048 * 0.95, (g.xMin, g.yMax)
        assert f1.getGlyphOrder()[-1] == 'uniAC00' and f1['post'].formatType == 2.0  # name appended to post v2
        iss, _ = verify(orig, out1, ['A', '가'])
        assert not iss, iss

        # TTF donor via manifest charset, scale/baseline params
        man = d / 'm.tsv'
        man.write_text('id\tsource\ttarget_ko\n1\tx\t가한글 A\n2\ty\t테스트.\n', encoding='utf-8')
        cs_ = charset_of(argparse.Namespace(chars=None, manifest=str(man), column='target_ko', all_hangul=False))
        out2 = d / 'malgun.ttf'
        m = build(orig, malgun, out2, cs_, scale=0.9, dy=20)
        assert m['added'] == 6 and m['added_codepoints'] == '가글스테트한', m
        f1, dk = font(out2.read_bytes()), font(malgun)
        for c in '가한':
            assert f1['hmtx'][f1.getBestCmap()[ord(c)]][0] == round(dk['hmtx'][dk.getBestCmap()[ord(c)]][0] * m['scale'])
        iss, summ = verify(orig, out2, cs_)
        assert not iss and summ['glyf_bad'] == 0 and summ['glyphs_after'] == summ['glyphs_before'] + 6, (iss, summ)
        try:
            build(orig, malgun, out2, cs_)
            raise AssertionError('overwrite not refused')
        except SystemExit:
            pass

        # verify must catch a tampered original glyph
        b = bytearray(out2.read_bytes())
        ft = font(bytes(b))
        b[ft.reader.tables['glyf'].offset + ft['loca'][1] + 2] ^= 0xFF
        bad = d / 'tampered.ttf'; bad.write_bytes(b)
        iss, _ = verify(orig, bad, cs_)
        assert iss and 'glyf=1' in iss[0], iss
    print('selftest ok')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    b = sub.add_parser('build')
    b.add_argument('--orig', required=True); b.add_argument('--donor', required=True); b.add_argument('--out', required=True)
    b.add_argument('--scale', type=float, default=1.0, help='extra factor on the upem ratio')
    b.add_argument('--dy', type=float, default=0.0, help='baseline shift in original font units')
    v = sub.add_parser('verify')
    v.add_argument('--orig', required=True); v.add_argument('--out', required=True)
    for p in (b, v):
        add_charset_args(p)
    sub.add_parser('selftest')
    a = ap.parse_args()
    if MISSING:
        if a.cmd == 'selftest':
            print(f'selftest SKIPPED: {MISSING} (set GT_PYLIB to a dir with fontTools + Pillow)')
            return
        raise SystemExit(f'missing library: {MISSING} (set GT_PYLIB)')
    if a.cmd == 'selftest':
        return selftest()
    chars = charset_of(a)
    if a.cmd == 'build':
        m = build(a.orig, a.donor, a.out, chars, a.scale, a.dy)
        print(json.dumps({k: v for k, v in m.items() if k != "added_codepoints"}))
    iss, summ = verify(a.orig, a.out, chars)
    print(json.dumps(summ))
    for i in iss:
        print('ISSUE', i)
    print('verify', 'FAIL' if iss else 'PASS')
    sys.exit(1 if iss else 0)


if __name__ == '__main__':
    main()
