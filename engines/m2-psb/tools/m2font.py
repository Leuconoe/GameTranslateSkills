#!/usr/bin/env python3
"""m2font.py - Korean glyphs for M2 Switch fonts: PSB v4 A8 atlases (textfont*.psb.m) + raw TTF (*.ttf.m).

  python -I m2font.py build  -r ROMFS [-k KEYFILE] --ko-font KO.ttf --manifest TSV [--manifest TSV ...] --out DIR
         -> DIR/romfs/font_info.psb.m + font_body.bin, DIR/FONT_BUILD_PARAMS.json (refuses an existing DIR)
  python -I m2font.py verify -r ROMFS [-k KEYFILE] --ko-font KO.ttf --manifest TSV [...] --out DIR
         -> independent re-decode of DIR/romfs: originals unchanged, v4 checksum, 32-aligned chunks, names trie,
            pixel round trip, overlaps, clipping, coverage of every visible target_ko char -> DIR/FONT_VERIFY.json,
            DIR/FONT_COVERAGE.tsv (exit 1 on any issue)
  python -I m2font.py check -r ROMFS [-k KEYFILE]   original atlases re-serialize byte-for-byte
  python -I m2font.py selftest                      synthetic atlas serializer / packing (no title data)

Atlas: original glyphs/pages untouched; new glyphs (KS X 1001 2350 + jamo + visible chars missing) go to ONE appended
A8 page, same metric model as the original (rect = full advance x ink rows; d = height + a; b = d - k; w == width).
One size per font: the KO face is matched to REF kanji ink height, then stepped down only until no new glyph clips.
TTF: scripts/fonts/ttf_append.py with one affine fitted on REF kanji (height + vertical centre).
Charset: target_ko of the manifests, both break forms ('\\\\n', '\\n') and format tokens removed.
"""
import argparse
import collections
import csv
import hashlib
import io
import json
import re
import struct
import sys
import tempfile
import zlib
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(1, str(Path(__file__).resolve().parents[3] / 'scripts' / 'fonts'))
import m2arc  # noqa: E402
import psb  # noqa: E402

REF = '東京語日本田中大学'  # kanji present in the original faces: common scale/baseline reference
TOKEN = re.compile(r'\\\\n|\\n|%%C|%C|%%|%[-+ 0-9.]*[A-Za-z]|\$\{[^}]*\}')
JAMO_PSB = [chr(c) for c in range(0x3131, 0x3164)]
JAMO_TTF = [chr(c) for c in range(0x3131, 0x318F)]
PAD = 1  # transparent border around each new rect (original atlases keep a 2px gap)


def sha(b):
    return hashlib.sha256(b).hexdigest()


def is_hangul(c):
    return 0xAC00 <= ord(c) <= 0xD7A3 or 0x3131 <= ord(c) <= 0x318E


def ks2350():
    return [bytes([h, lo]).decode('euc-kr') for h in range(0xB0, 0xC9) for lo in range(0xA1, 0xFF)]


def visible_counts(manifests):
    cnt = collections.Counter()
    csv.field_size_limit(1 << 30)
    for m in manifests:
        with open(m, encoding='utf-8-sig', newline='') as f:
            for r in csv.DictReader(f, delimiter='\t', quoting=csv.QUOTE_NONE):
                cnt.update(c for c in TOKEN.sub('', r.get('target_ko') or '') if c.isprintable())
    return cnt


def fonts(A):
    """{keyname: (kind, raw)} kind = 'atlas' | 'ttf'"""
    out = {}
    for it in A.items:
        raw = A.raw(it)
        if it[1].endswith('.ttf.m'):
            out[it[1]] = ('ttf', raw)
        elif raw[:4] == b'PSB\0' and {'code', 'source'} <= set(psb.PSB(raw).root()):
            out[it[1]] = ('atlas', raw)
    return out


# ---------------- PSB font serializer (original layout: empty ext arrays before chunks, chunk_data 32-aligned)
def dump_font(root, chunks, orig_names=None):
    o = psb.dump(root, chunks, 4, [], orig_names)
    q = psb.PSB(o)
    out = bytearray(o[:q.h['chunk_offsets']])
    eo = len(out)
    out += psb._arr([])
    el = len(out)
    out += psb._arr([])
    ed = co = len(out)
    offs, n = [], 0
    for c in chunks:
        offs.append(n)
        n += len(c)
    out += psb._arr(offs)
    cl = len(out)
    out += psb._arr([len(c) for c in chunks])
    out += b'\0' * (-len(out) % 32)
    cd = len(out)
    out += b''.join(chunks)
    h = dict(q.h, chunk_offsets=co, chunk_lengths=cl, chunk_data=cd)
    struct.pack_into('<8I', out, 8, *[h[k] for k in psb.HDR_FIELDS])
    struct.pack_into('<3I', out, 0x2C, eo, el, ed)
    struct.pack_into('<I', out, 0x28, psb.cks(out, 4))
    return bytes(out)


def trie_forward_ok(p):
    """number of names whose forward lookup (root -> charset[pos]+byte, parent check) misses nameIndexes[i]"""
    charset, pos = p._array(p.h['names'])
    nd, pos = p._array(pos)
    idx, _ = p._array(pos)
    bad = 0
    for i, n in enumerate(p.names):
        cur = 0
        for c in psb._enc(n) + b'\0':
            nxt = charset[cur] + c
            if nxt >= len(nd) or nd[nxt] != cur:
                bad += 1
                break
            cur = nxt
        else:
            bad += cur != idx[i]
    return bad


def pages_of(p):
    return [np.frombuffer(p.chunks[s['pixel']], np.uint8).reshape(s['height'], s['width']) for s in p.root()['source']]


def pack(shapes, W):
    """shelf packing of (h, w) shapes; widen the page (x2) until its power-of-two height <= width -> (xy, W, H)"""
    while True:
        xy, x, y, rowh = [], PAD, PAD, 0
        for gh, gw in shapes:
            if x + gw + PAD > W:
                x, y, rowh = PAD, y + rowh + 2 * PAD, 0
            xy.append((x, y))
            x += gw + 2 * PAD
            rowh = max(rowh, gh)
        H = 1
        while H < y + rowh + PAD:
            H *= 2
        if H <= W:
            return xy, W, H
        W *= 2


# ---------------- glyph rendering (shared by build and verify => deterministic pixel round trip)
class AtlasStyle:
    def __init__(self, p, ko_font, chars=()):
        code = p.root()['code']
        self.ko = str(ko_font)
        self.H = code['あ']['height']
        self.k = int(float(code['あ']['d']) - code['あ']['b'])
        pages = pages_of(p)
        tops, bots = [], []
        for c in REF:
            g = code[c]
            a = pages[g['id']][int(g['y']):int(g['y']) + g['h'], int(g['x']):int(g['x']) + int(g['w'])]
            rows = np.where(a.max(1) >= 128)[0]
            tops.append(-g['a'] + rows[0])
            bots.append(-g['a'] + rows[-1] + 1)
        t_at, h_at = float(np.mean(tops)), float(np.mean(bots) - np.mean(tops))
        self.size = self.size_ref = round(100.0 * h_at / self._ko_ref(100.0)[1], 4)
        while True:
            nt, _ = self._ko_ref(self.size)
            self.baseline = int(round(t_at - nt))
            self.font = ImageFont.truetype(self.ko, self.size)
            if not chars or self.size <= 0.8 * self.H or sum(self.render(c)[2] for c in chars) == 0:
                break
            self.size = round(self.size - 0.05, 4)
        self.types = {}  # field types copied from the original table (x int when 1, F32 otherwise, ...)
        for g in code.values():
            for f, v in g.items():
                self.types.setdefault((f, float(v)), type(v))
                self.types.setdefault(f, type(v))

    def _ko_ref(self, size):
        f = ImageFont.truetype(self.ko, size)
        n = int(size) + 4
        tt, hh = [], []
        for c in REF:
            im = Image.new('L', (3 * n, 3 * n))
            ImageDraw.Draw(im).text((n, 2 * n), c, font=f, fill=255, anchor='ls')
            rows = np.where(np.asarray(im).max(1) >= 128)[0]
            tt.append(rows[0] - 2 * n)
            hh.append(rows[-1] + 1 - rows[0])
        return float(np.mean(tt)), float(np.mean(hh))

    def render(self, ch):
        """-> (bitmap h x w, metrics, clipped_px)"""
        H = self.H
        adv = self.font.getlength(ch)
        w = H if is_hangul(ch) else max(1, int(round(adv)))
        im = Image.new('L', (3 * H, 3 * H))
        ImageDraw.Draw(im).text((H + int(round((w - adv) / 2)), H + self.baseline), ch, font=self.font, fill=255, anchor='ls')
        a = np.asarray(im)
        clipped = int((a[:, :H] > 0).sum() + (a[:, H + w:] > 0).sum())
        cell = a[:, H:H + w]
        rows = np.where(cell.max(1) > 0)[0]
        r0, r1 = (int(rows[0]), int(rows[-1]) + 1) if len(rows) else (H, H + 1)
        m = {'a': H - r0, 'h': r1 - r0, 'height': H, 'w': w, 'width': w}
        m['d'] = H + m['a']
        m['b'] = m['d'] - self.k
        return np.ascontiguousarray(cell[r0:r1]), m, clipped

    def typed(self, f, v):
        t = self.types.get((f, float(v)), self.types[f])
        return psb.F32(float(v)) if t is psb.F32 else t(v)


def plan_atlas(raw, cnt):
    p = psb.PSB(raw)
    code = p.root()['code']
    return p, sorted(c for c in set(ks2350()) | set(JAMO_PSB) | set(cnt) if c not in code and not c.isspace())


def build_atlas(raw, cnt, ko_font):
    p, add = plan_atlas(raw, cnt)
    root = p.root()
    st = AtlasStyle(p, ko_font, add)
    rendered = [(ch, *st.render(ch)) for ch in add]
    xy, W, Hp = pack([bmp.shape for _, bmp, _, _ in rendered], root['source'][0]['width'])
    page = np.zeros((Hp, W), np.uint8)
    pid = len(root['source'])
    for (ch, bmp, m, _), (gx, gy) in zip(rendered, xy):
        page[gy:gy + bmp.shape[0], gx:gx + bmp.shape[1]] = bmp
        g = {k: st.typed(k, v) for k, v in m.items()}
        g['x'], g['y'], g['id'] = st.typed('x', gx), st.typed('y', gy), st.typed('id', pid)
        root['code'][ch] = {k: g[k] for k in ('a', 'b', 'd', 'h', 'height', 'id', 'w', 'width', 'x', 'y')}
    s0 = root['source'][0]
    root['source'].append({'height': Hp, 'pixel': psb.Res(len(p.chunks)), 'truncated_height': Hp,
                           'truncated_width': W, 'type': s0['type'], 'width': W})
    ws = [int(float(g['width'])) for g in root['code'].values()]
    root['minWidth'], root['maxWidth'] = min(min(ws), root['minWidth']), max(max(ws), root['maxWidth'])
    return dump_font(root, list(p.chunks) + [page.tobytes()]), {
        'H': st.H, 'k': st.k, 'ko_size_px': st.size, 'kanji_match_size_px': st.size_ref, 'baseline_px': st.baseline,
        'added': len(add), 'page_index': pid, 'page_wh': [W, Hp], 'clipped_px_total': sum(r[3] for r in rendered)}


def ttf_chars(cnt):
    return sorted({chr(c) for c in range(0xAC00, 0xD7A4)} | set(JAMO_TTF) | {c for c in cnt if not c.isspace()})


def build_ttf(raw, cnt, ko_font):
    import ttf_append as T
    from fontTools.pens.boundsPen import BoundsPen
    ref, don = T.font(raw), T.font(Path(ko_font).read_bytes())

    def ys(f):
        gs, cm, b = f.getGlyphSet(), f.getBestCmap(), []
        for c in REF:
            bp = BoundsPen(gs)
            gs[cm[ord(c)]].draw(bp)
            b.append(bp.bounds)
        return np.mean([x[1] for x in b]), np.mean([x[3] for x in b])
    (hy0, hy1), (ny0, ny1) = ys(ref), ys(don)
    sc = (hy1 - hy0) / (ny1 - ny0)
    dy = (hy0 + hy1) / 2 - sc * (ny0 + ny1) / 2
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / 'orig.ttf').write_bytes(raw)
        meta = T.build(Path(d) / 'orig.ttf', ko_font, Path(d) / 'new.ttf', ttf_chars(cnt),
                       sc / (ref['head'].unitsPerEm / don['head'].unitsPerEm), float(dy))
        return (Path(d) / 'new.ttf').read_bytes(), {k: meta[k] for k in ('scale', 'dy_units', 'vertical_origin', 'added',
                                                                       'glyphs_before', 'glyphs_after', 'dropped_tables')}


# ---------------- commands
def build(a, key):
    out = Path(a.out)
    if out.exists():
        sys.exit(f'refuse: {out} exists')
    A, cnt = m2arc.Archive(a.romfs, 'font', key), visible_counts(a.manifest)
    new, params = {}, {}
    for k, (kind, raw) in fonts(A).items():
        new[k], params[k] = (build_atlas if kind == 'atlas' else build_ttf)(raw, cnt, a.ko_font)
        print(k, json.dumps(params[k], ensure_ascii=False))
    A.write(out / 'romfs', new)
    (out / 'FONT_BUILD_PARAMS.json').write_text(json.dumps(
        {'ko_font': str(a.ko_font), 'ko_font_sha256': sha(Path(a.ko_font).read_bytes()),
         'manifest_sha256': {m: sha(Path(m).read_bytes()) for m in a.manifest}, 'fonts': params,
         'raw_sha256': {k: sha(v) for k, v in new.items()}}, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'build fonts={len(new)} -> {out / "romfs"}')


def verify_atlas(k, r0, r1, cnt, ko_font, issues, cover):
    p0, p1 = psb.PSB(r0), psb.PSB(r1)
    t0, t1 = p0.root(), p1.root()
    c0, c1 = t0['code'], t1['code']
    if [c for c in c0 if not psb.same_tree(c0[c], c1.get(c))]:
        issues.append(f'{k}: original glyph entries changed')
    if trie_forward_ok(p1) or r1[:8] != r0[:8] or not p1.checksum_ok() or p1.h['chunk_data'] % 32:
        issues.append(f'{k}: names trie / header / v4 checksum / chunk alignment')
    n0 = len(t0['source'])
    if not psb.same_tree(t0['source'], t1['source'][:n0]) or list(p0.chunks) != list(p1.chunks[:len(p0.chunks)]):
        issues.append(f'{k}: original pages/sources changed')
    for f in ('id', 'label', 'maxHeight', 'minHeight', 'spec', 'version'):
        if f in t0 and not psb.same_tree(t0[f], t1[f]):
            issues.append(f'{k}: header field {f} changed')
    pages, new = pages_of(p1), [c for c in c1 if c not in c0]
    _, add = plan_atlas(r0, cnt)
    if sorted(new) != add:
        issues.append(f'{k}: added set differs from plan')
    st = AtlasStyle(p0, ko_font, add)
    rects, rt_bad, blank = [], 0, 0
    for c in new:
        g = c1[c]
        x, y, w, h = int(float(g['x'])), int(float(g['y'])), int(float(g['w'])), int(g['h'])
        pg = pages[g['id']]
        if g['id'] != n0 or x < PAD or y < PAD or x + w + PAD > pg.shape[1] or y + h + PAD > pg.shape[0]:
            issues.append(f'{k}: {c!r} bad page/rect')
        bmp, m, clipped = st.render(c)
        crop = pg[y:y + h, x:x + w]
        rt_bad += crop.shape != bmp.shape or not np.array_equal(crop, bmp) or any(float(g[f]) != v for f, v in m.items())
        blank += crop.max() == 0 or crop[0].max() == 0 or crop[-1].max() == 0
        if clipped:
            issues.append(f'{k}: {c!r} clipped {clipped}px')
        if float(g['d']) != g['height'] + g['a'] or float(g['d']) - g['b'] != st.k or float(g['w']) != float(g['width']):
            issues.append(f'{k}: {c!r} metric invariant')
        rects.append((x, y, w, h))
    rects.sort(key=lambda r: (r[1], r[0]))
    ov = sum(a_[1] == b_[1] and a_[0] + a_[2] + 2 * PAD > b_[0] for a_, b_ in zip(rects, rects[1:]))
    ys = sorted({r[1] for r in rects})
    ov += sum(max(r[1] + r[3] for r in rects if r[1] == ya) + 2 * PAD > yb for ya, yb in zip(ys, ys[1:]))
    if rt_bad or blank or ov:
        issues.append(f'{k}: pixel_roundtrip_bad={rt_bad} blank_or_loose={blank} overlaps={ov}')
    for c in cnt:
        g = c1.get(c)
        cover[c][k] = g is not None
        if g is None and not c.isspace():
            issues.append(f'{k}: missing U+{ord(c):04X}')
        elif g is not None and not c.isspace():
            x, y, w, h = int(float(g['x'])), int(float(g['y'])), int(float(g['w'])), int(g['h'])
            if pages[g['id']][y:y + h, x:x + w].max() == 0:
                issues.append(f'{k}: blank glyph U+{ord(c):04X}')
    return {'orig_glyphs': len(c0), 'new_glyphs': len(new), 'pixel_roundtrip_bad': rt_bad, 'overlaps': ov,
            'blank_or_loose': blank, 'raw_sha256': sha(r1)}


def verify(a, key):
    import ttf_append as T
    out = Path(a.out)
    F0, F1 = fonts(m2arc.Archive(a.romfs, 'font', key)), fonts(m2arc.Archive(out / 'romfs', 'font', key))
    assert list(F0) == list(F1), (list(F0), list(F1))
    cnt = visible_counts(a.manifest)
    issues, summary, cover = [], {}, {c: {} for c in cnt}
    for k, (kind, r0) in F0.items():
        r1 = F1[k][1]
        if kind == 'atlas':
            summary[k] = verify_atlas(k, r0, r1, cnt, a.ko_font, issues, cover)
            continue
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / 'o.ttf').write_bytes(r0)
            (Path(d) / 'n.ttf').write_bytes(r1)
            iss, summary[k] = T.verify(Path(d) / 'o.ttf', Path(d) / 'n.ttf', ttf_chars(cnt))
        issues += [f'{k}: {x}' for x in iss]
        cm = T.font(r1).getBestCmap()
        for c in cnt:
            cover[c][k] = ord(c) in cm
    lines = ['codepoint\tcharacter\tcount\t' + '\t'.join(F0) + '\tstatus']
    for c in sorted(cnt):
        ok = all(cover[c].get(k) for k in F0) or c.isspace()
        lines.append(f'U+{ord(c):04X}\t{c}\t{cnt[c]}\t' + '\t'.join('yes' if cover[c].get(k) else 'NO' for k in F0)
                     + f'\t{"verified" if ok else "missing"}')
    (out / 'FONT_COVERAGE.tsv').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    res = {'visible_codepoints': len(cnt), 'visible_hangul': sum(map(is_hangul, cnt)), 'fonts': summary, 'issues': issues}
    (out / 'FONT_VERIFY.json').write_text(json.dumps(res, ensure_ascii=False, indent=1, default=int), encoding='utf-8')
    print(f'verify fonts={len(F0)} visible={len(cnt)} issues={len(issues)} {issues[:5]}')
    return 1 if issues else 0


def check(a, key):
    bad = 0
    for k, (kind, raw) in fonts(m2arc.Archive(a.romfs, 'font', key)).items():
        if kind == 'atlas':
            p = psb.PSB(raw)
            ok = dump_font(p.root(), p.chunks, p.names_section()) == raw and not trie_forward_ok(psb.PSB(dump_font(p.root(), p.chunks)))
            bad += not ok
            print(f'{k}: serializer byte-identical + rebuilt trie forward lookup ok={ok}')
    return 1 if bad else 0


def selftest():
    page = bytes(range(32))
    g = {'a': 3, 'b': 1, 'd': psb.F32(19.0), 'h': 4, 'height': 16, 'id': 0, 'w': psb.F32(8.0), 'width': 8, 'x': 0, 'y': 0}
    root = {'code': {'あ': g, 'A': dict(g, x=psb.F32(8.5))}, 'id': 'font', 'label': 't', 'maxHeight': 16, 'minHeight': 16,
            'maxWidth': 8, 'minWidth': 8, 'spec': 'nx', 'version': psb.F32(1.0),
            'source': [{'height': 4, 'pixel': psb.Res(0), 'truncated_height': 4, 'truncated_width': 8, 'type': 'A8', 'width': 8}]}
    b = dump_font(root, [page])
    p = psb.PSB(b)
    assert p.version == 4 and p.checksum_ok() and p.h['chunk_data'] % 32 == 0 and p.chunks == [page]
    assert dump_font(p.root(), p.chunks, p.names_section()) == b and trie_forward_ok(p) == 0
    assert psb.same_tree(p.root(), psb.PSB(dump_font(p.root(), p.chunks)).root())
    assert pages_of(p)[0].shape == (4, 8) and pages_of(p)[0][1, 0] == 8
    shapes = [(5, 7), (9, 3), (4, 12), (6, 6)] * 20
    xy, W, H = pack(shapes, 32)
    assert W & (W - 1) == 0 and H & (H - 1) == 0 and H <= W
    occ = np.zeros((H, W), int)
    for (h, w), (x, y) in zip(shapes, xy):
        occ[y - PAD:y + h + PAD, x - PAD:x + w + PAD] += 1
    assert occ.max() == 1 and occ.shape == (H, W)  # padded rects disjoint and inside the page
    with tempfile.TemporaryDirectory() as d:
        m = Path(d) / 'm.tsv'
        m.write_text('id\tja\ttarget_ko\nq1\ta\t%C가\\\\n나${x}\nq2\tb\t다\\n·\n', encoding='utf-8')
        assert set(visible_counts([m])) == {'가', '나', '다', '·'}
    assert len(ks2350()) == 2350 and ks2350()[0] == '가' and ks2350()[-1] == '힝'
    print('selftest ok')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('cmd', choices=('build', 'verify', 'check', 'selftest'))
    ap.add_argument('-r', '--romfs')
    ap.add_argument('-k', '--key-file')
    ap.add_argument('--ko-font')
    ap.add_argument('--manifest', action='append', default=[])
    ap.add_argument('--out')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    if a.cmd == 'selftest':
        return selftest()
    key = m2arc.load_key(a.key_file, a.romfs)
    return {'build': build, 'verify': verify, 'check': check}[a.cmd](a, key)


if __name__ == '__main__':
    sys.exit(main())
