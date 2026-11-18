"""unity_font.py - Korean glyphs for a Unity dynamic Font (m_FontData = embedded CID-keyed OTF/CFF).

  python -I unity_font.py inventory -p <_work/TID>            -> 50_test/artifacts/font_<tag>/FONT_INVENTORY.tsv (+ refs)
  python -I unity_font.py merge -p P --font NAME --ko ROLE=PATH[=SHA256] [--ko ...] [--ratio 0.95]
        -> 90_tools/work/font_<tag>/<NAME>_<sha8>_ko_<tag>.otf (+ _orig.otf, merge_meta.json, added_glyphs.tsv)
  python -I unity_font.py fontcheck -p P     original-glyph preservation + new-glyph transform + render probe
  python -I unity_font.py build|verify -p P [--base DIR] [--out DIR]   only m_FontData of the target Font objects changes;
        source = <base>/romfs/<rel> when present (e.g. the text-injected overlay) else romfs_original;
        a --base without romfs/ is refused; output = <out>/romfs/<rel> (an --out ending in romfs is not nested)
  python -I unity_font.py noop -p P          rewrite target files unchanged in memory, all objects raw-exact
  python -I unity_font.py coverage -p P      FONT_COVERAGE.tsv (all Hangul + every char used in target_ko / bulk out)
  python -I unity_font.py selftest
Method: Hangul is appended to the original CID-keyed CFF as new CIDs in the FontDict of a reference kanji; original
glyphs, cmap, hmtx/vmtx and face metrics stay exact. One common scale/offset per glyph source (no per-glyph scaling):
Hangul bbox height = ratio x reference-kanji bbox height. The first --ko source that has a non-empty outline wins per
code point. --font (Unity Font m_Name) and the sources are stored in merge_meta.json for later commands (an older
merge_meta.json without "font" falls back to --font, else to the NAME of the single merged <NAME>_<sha8>_ko_<tag>.otf).
Not for TMP SDF atlases (see ENGINE.md: atlas contract) or TrueType (glyf) bases.
"""
import argparse
import collections
import hashlib
import io
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script dir
from ucommon import JP, base_root, load_env, overlay_root  # noqa: E402

SKIP_DIRS = {'movie', 'sound', 'TSV'}
ASCII_ONLY = re.compile(r'[\x00-\x7f]*')
MB_SCAN = ('Data/data.unity3d', 'Data/StreamingAssets/model', 'Data/StreamingAssets/pc', 'Data/StreamingAssets/contents',
           'Data/Resources')
REF_KANJI, REF_HANGUL = '国語東京会', '한국어가나다라갈레'
BLANK_OK = {0x3164}  # HANGUL FILLER is blank by design
PROBE_LINES = ['「안녕하세요!」 今日はいい天気ですね。', '퍼즐을 클리어했습니다! 보상 ×3 (100%) ～♪',
               'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ ㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ 똠방각하 펲시콜라 쀍뷁',
               '가나다라마바사아자차카타파하 ABC abc 0123 あいう アイウ 漢字']
TOKEN = re.compile(r'\\[nrt]|<[^<>]*>|\{\d+(?::[^}]*)?\}|%[sdf]')


def sha(b):
    return hashlib.sha256(b).hexdigest()


class P:
    def __init__(self, a):
        self.a, self.prj = a, Path(a.p)
        self.rom = self.prj / '10_extract' / 'romfs_original'
        self.art = self.prj / '50_test' / 'artifacts' / f'font_{a.tag}'
        self.work = self.prj / '90_tools' / 'work' / f'font_{a.tag}'
        # build root: files go to <out>/romfs/<rel>; an --out that already ends in romfs is not nested again
        self.out = overlay_root(a.out).parent if a.out else self.prj / '40_build' / f'font_{a.tag}'
        base_root(a.base)

    def meta(self):
        m = json.loads((self.work / 'merge_meta.json').read_text(encoding='utf-8'))
        if not m.get('font'):  # older metas: --font, else the NAME of the one <NAME>_<sha8>_ko_<tag>.otf in work/
            tail = f'_{m["orig_sha256"][:8]}_ko_{self.a.tag}.otf'
            hits = sorted(f.name[:-len(tail)] for f in self.work.glob('*' + tail))
            if not self.a.font and len(hits) != 1:
                sys.exit(f'merge_meta.json has no "font" key (older meta) and {len(hits)} merged fonts *{tail} in '
                         f'{self.work}: pass --font <Unity Font m_Name>')
            m['font'] = self.a.font or hits[0]
            print(f'note: merge_meta.json has no "font" key (older meta); using font={m["font"]!r} '
                  f'({"--font" if self.a.font else "merged file name"})', file=sys.stderr)
        return m

    def font(self):
        return self.a.font or self.meta()['font']


def unity_files(rom):
    out = []
    for dp, dn, fn in os.walk(rom / 'Data'):
        rel_dp = Path(dp).relative_to(rom).as_posix()
        dn[:] = sorted(d for d in dn if not (rel_dp == 'Data/StreamingAssets' and d in SKIP_DIRS) and d != 'Managed')
        out += [f'{rel_dp}/{f}' for f in sorted(fn)
                if not f.endswith(('.manifest', '.json', '.config', '.dat')) and f != 'rawsettings']
    return out


def script_name(o):
    try:
        return o.parse_monobehaviour_head().m_Script.deref_parse_as_object().m_ClassName
    except Exception:
        return '?'


def font_pptrs(t, path=''):
    """Yield (field_path, pptr) for every PPtr whose key path mentions font."""
    if isinstance(t, dict):
        for k, v in t.items():
            p = f'{path}.{k}' if path else k
            if isinstance(v, dict) and set(v) == {'m_FileID', 'm_PathID'}:
                if 'font' in p.lower():
                    yield p, v
            elif isinstance(v, (dict, list)):
                yield from font_pptrs(v, p)
    elif isinstance(t, list):
        for i, v in enumerate(t):
            if isinstance(v, (dict, list)):
                yield from font_pptrs(v, f'{path}.{i}')


def resolve(o, pp):
    if pp['m_PathID'] == 0:
        return 'null'
    if pp['m_FileID'] == 0:
        return f'{o.assets_file.name}:{pp["m_PathID"]}'
    try:
        ext = o.assets_file.externals[pp['m_FileID'] - 1].path
    except Exception:
        ext = f'ext{pp["m_FileID"]}'
    return f'{ext.split("/")[-1]}:{pp["m_PathID"]}'


def head40(s):
    return s[:40].replace('\t', ' ').replace('\n', '\\n').replace('\r', '\\r')


def inventory(p):
    p.art.mkdir(parents=True, exist_ok=True)
    fonts, refs, objs_out = [], collections.Counter(), []
    files = unity_files(p.rom)
    for n, rel in enumerate(files):
        try:
            objs = list(load_env(p.rom / rel, rel, p.rom).objects)
        except Exception:
            continue
        for o in objs:
            tn = o.type.name
            if tn == 'Font':
                d = o.read_typetree()
                fd = bytes(d.get('m_FontData') or b'')
                fonts.append([rel, o.assets_file.name, o.path_id, d['m_Name'], len(fd), sha(fd)[:16] if fd else '-',
                              fd[:4].hex(), ';'.join(d.get('m_FontNames') or []),
                              ';'.join(resolve(o, x) for x in d.get('m_FallbackFonts') or []), d.get('m_FontSize'),
                              d.get('m_FontRenderingMode'), d.get('m_Ascent'), d.get('m_Descent'),
                              d.get('m_LineSpacing'), len(d.get('m_CharacterRects') or [])])
            elif tn == 'TextMesh' or (tn == 'MonoBehaviour' and rel.startswith(MB_SCAN)):
                try:
                    t = o.read_typetree()
                except Exception:
                    continue
                hits = [('m_Font', t['m_Font'])] if tn == 'TextMesh' else list(font_pptrs(t))
                sn = 'TextMesh' if tn == 'TextMesh' else (script_name(o) if hits else '')
                txt = t.get('m_Text') if isinstance(t.get('m_Text'), str) else ''
                for fp, pp in hits:
                    tg = resolve(o, pp)
                    refs[(rel, sn, fp, tg)] += 1
                    objs_out.append([rel, o.assets_file.name, o.path_id, sn, fp, tg, int(bool(JP.search(txt))),
                                     int(bool(ASCII_ONLY.fullmatch(txt))), head40(txt)])
        if n % 200 == 0:
            print(f'{n}/{len(files)} fonts={len(fonts)} refs={sum(refs.values())}', flush=True)
    tsv = {'FONT_INVENTORY.tsv': ('kind\tfile\tassets_file\tpath_id\tname\tdata_len\tdata_sha16\tmagic\tfont_names\t'
                                  'fallbacks\tfont_size\trender_mode\tascent\tdescent\tline_spacing\tchar_rects',
                                  [['font'] + r for r in fonts]),
           'FONT_REFERENCES.tsv': ('file\treferrer\tfield\ttarget\tcount', [list(k) + [c] for k, c in sorted(refs.items())]),
           'FONT_REF_OBJECTS.tsv': ('file\tassets_file\tpath_id\treferrer\tfield\ttarget\tm_Text_has_jp\t'
                                    'm_Text_ascii_only\tm_Text_head', objs_out)}
    for name, (hdr, rows) in tsv.items():
        (p.art / name).write_text(hdr + '\n' + ''.join('\t'.join(map(str, r)) + '\n' for r in rows), encoding='utf-8')
    tgt = collections.Counter()
    for (_, _, _, tg), c in refs.items():
        tgt[tg] += c
    print('fonts', len(fonts), [r[3] for r in fonts], '| reference targets', tgt.most_common(10))


# ---------------- merge ----------------
def target_objects(p):
    """[(rel, assets_file, path_id)] of every Font named --font; all copies must share one font program."""
    hdr, *rows = (p.art / 'FONT_INVENTORY.tsv').read_text(encoding='utf-8').split('\n')
    rows = [dict(zip(hdr.split('\t'), ln.split('\t'))) for ln in rows if ln]
    rows = [r for r in rows if r['name'] == p.font()]
    assert rows and len({r['data_sha16'] for r in rows}) == 1, 'target font missing or copies differ'
    return [(r['file'], r['assets_file'], int(r['path_id'])) for r in rows]


def orig_font_bytes(p):
    from ucommon import UnityPy
    tg = target_objects(p)
    rel = min({t[0] for t in tg}, key=lambda r: (p.rom / r).stat().st_size)
    for o in UnityPy.load(str(p.rom / rel)).objects:
        if o.type.name == 'Font' and o.path_id in {t[2] for t in tg if t[0] == rel}:
            return bytes(o.read_typetree()['m_FontData'])
    raise SystemExit('target font not found')


def bounds_of(gs, g, tr=None):
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.pens.transformPen import TransformPen
    bp = BoundsPen(gs)
    gs[g].draw(TransformPen(bp, tr) if tr else bp)
    return bp.bounds


def common_transform(kb, hb, ratio):
    """One (scale, dy) from reference bboxes: Hangul height = ratio x kanji height, vertical centres aligned."""
    kh = sum(b[3] - b[1] for b in kb) / len(kb)
    kc = sum(b[3] + b[1] for b in kb) / len(kb) / 2
    hh = sum(b[3] - b[1] for b in hb) / len(hb)
    hc = sum(b[3] + b[1] for b in hb) / len(hb) / 2
    s = round(ratio * kh / hh, 4)
    return s, round(kc - s * hc), {'kanji_h': kh, 'kanji_c': kc, 'hangul_h': hh, 'hangul_c': hc}


def add_plan(base_cps, srcs, want_extra):
    """{cp: source index} for Hangul syllables + compat jamo + want_extra not in the base; srcs = [(cmap, has_outline)]."""
    want = set(range(0xAC00, 0xD7A4)) | set(range(0x3131, 0x318F)) | set(want_extra)
    plan, unresolved = {}, []
    for c in sorted(want - set(base_cps)):
        for i, (cm, has) in enumerate(srcs):
            if c in cm and (c in BLANK_OK or has(cm[c])):
                plan[c] = i
                break
        else:
            unresolved.append(c)
    return plan, unresolved


def parse_ko(specs):
    out = []
    for s in specs:
        role, path, *h = s.split('=')
        out.append((role, Path(path), h[0].lower() if h else None))
    return out


def merge(p):
    import unicodedata
    from fontTools.pens.t2CharStringPen import T2CharStringPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.ttLib import TTFont
    srcs = parse_ko(p.a.ko)
    assert srcs, '--ko required'
    srcs = [(r, f, h or sha(f.read_bytes())) for r, f, h in srcs]
    for _, f, h in srcs:
        assert sha(f.read_bytes()) == h, f'source font hash mismatch {f}'
    ob = orig_font_bytes(p)
    base = TTFont(io.BytesIO(ob))
    assert 'CFF ' in base, 'base font is not CFF'
    kos = [TTFont(str(f)) for _, f, _ in srcs]
    bcm, bgs = base.getBestCmap(), base.getGlyphSet()
    kb = [bounds_of(bgs, bcm[ord(c)]) for c in REF_KANJI]
    trs, refs = [], []
    for k in kos:
        s, dy, ref = common_transform(kb, [bounds_of(k.getGlyphSet(), k.getBestCmap()[ord(c)]) for c in REF_HANGUL],
                                      p.a.ratio)
        trs.append((s, 0, 0, s, 0, dy))
        refs.append({'scale': s, 'dy': dy, **ref})
    gsets = [(k.getBestCmap(), k.getGlyphSet()) for k in kos]
    extra = {c for c in gsets[0][0] if unicodedata.category(chr(c)) not in ('Cc', 'Cf', 'Zs', 'Zl', 'Zp', 'Co', 'Cn')}
    plan, unresolved = add_plan(bcm, [(cm, lambda g, gs=gs: bounds_of(gs, g) is not None) for cm, gs in gsets], extra)
    adds = sorted(plan)
    cff = base['CFF '].cff
    td = cff.topDictIndex[0]
    css = td.CharStrings
    order = list(base.getGlyphOrder())
    n0 = len(order)
    fd_idx = td.FDSelect.gidArray[order.index(bcm[ord(REF_KANJI[0])])]
    priv = td.FDArray[fd_idx].Private
    head = base['head']
    vorg = base['VORG'].defaultVertOriginY if 'VORG' in base else 880
    next_cid = max(int(g[3:]) for g in order if g.startswith('cid')) + 1
    new_names = []
    for cp in adds:
        si = plan[cp]
        kcm, kgs = gsets[si]
        tr, g = trs[si], kcm[cp]
        w = round(kgs[g].width * tr[0])
        pen = T2CharStringPen(w, None)
        kgs[g].draw(TransformPen(pen, tr))
        name = f'cid{next_cid:05d}'
        next_cid += 1
        css.charStringsIndex.append(pen.getCharString(private=priv, globalSubrs=cff.GlobalSubrs))
        css.charStrings[name] = len(css.charStringsIndex) - 1
        td.charset.append(name)
        td.FDSelect.append(fd_idx)
        b = bounds_of(kgs, g, tr)
        if b:
            assert head.xMin <= b[0] and b[2] <= head.xMax and head.yMin <= b[1] and b[3] <= head.yMax, (hex(cp), b)
        base['hmtx'].metrics[name] = (w, round(b[0]) if b else 0)
        if 'vmtx' in base:
            base['vmtx'].metrics[name] = (1000, vorg - round(b[3]) if b else 0)
        for st in base['cmap'].tables:
            if st.isUnicode() and st.format in (4, 12):
                st.cmap[cp] = name
        new_names.append((cp, name, g, si))
    assert next_cid <= 65535
    if len(base.getGlyphOrder()) != len(td.charset):
        base.setGlyphOrder(list(td.charset))
    assert len(base.getGlyphOrder()) == n0 + len(adds)
    base.recalcBBoxes = base.recalcTimestamp = False
    buf = io.BytesIO()
    base.save(buf)
    nb = buf.getvalue()
    p.work.mkdir(parents=True, exist_ok=True)
    font, tag = p.font(), p.a.tag
    (p.work / f'{font}_{sha(ob)[:8]}_ko_{tag}.otf').write_bytes(nb)
    (p.work / f'{font}_{sha(ob)[:8]}_orig.otf').write_bytes(ob)
    (p.work / 'added_glyphs.tsv').write_text('codepoint\tcid_name\tsource\tsource_glyph\n' + ''.join(
        f'U+{cp:04X}\t{name}\t{srcs[si][0]}\t{g}\n' for cp, name, g, si in new_names), encoding='utf-8')
    meta = {'font': font, 'orig_sha256': sha(ob), 'orig_len': len(ob), 'merged_sha256': sha(nb), 'merged_len': len(nb),
            'ratio': p.a.ratio, 'sources': [{'role': r, 'path': str(f), 'sha256': h, **refs[i],
                                             'glyphs': sum(1 for x in new_names if x[3] == i)}
                                            for i, (r, f, h) in enumerate(srcs)],
            'unresolved': [f'U+{c:04X}' for c in unresolved], 'fd_index': fd_idx, 'added': len(adds),
            'glyphs_before': n0, 'glyphs_after': n0 + len(adds),
            'added_hangul': sum(0xAC00 <= c <= 0xD7A3 for c in adds), 'added_jamo': sum(0x3131 <= c <= 0x318E for c in adds)}
    (p.work / 'merge_meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf-8')
    print('merge', {k: v for k, v in meta.items() if k != 'unresolved'}, 'unresolved', len(unresolved))


def merged(p):
    m = p.meta()
    f = p.work / f'{m["font"]}_{m["orig_sha256"][:8]}_ko_{p.a.tag}.otf'
    o = p.work / f'{m["font"]}_{m["orig_sha256"][:8]}_orig.otf'
    nb, ob = f.read_bytes(), o.read_bytes()
    assert sha(nb) == m['merged_sha256'] and sha(ob) == m['orig_sha256']
    return f, nb, ob, m


# ---------------- fontcheck ----------------
def fontcheck(p):
    from fontTools.ttLib import TTFont
    f, nb, ob, m = merged(p)
    o, n = TTFont(io.BytesIO(ob)), TTFont(str(f))  # independent parse of the saved file
    res = {}
    oo = o.getGlyphOrder()
    res['glyph_order_prefix_exact'] = n.getGlyphOrder()[:len(oo)] == oo
    ocs, ncs = o['CFF '].cff.topDictIndex[0], n['CFF '].cff.topDictIndex[0]
    res['orig_charstring_bytecode_diff'] = sum(ocs.CharStrings[g].bytecode != ncs.CharStrings[g].bytecode for g in oo)
    res['orig_fdselect_diff'] = sum(ocs.FDSelect.gidArray[i] != ncs.FDSelect.gidArray[i] for i in range(len(oo)))
    res['fdarray_len_equal'] = len(ocs.FDArray) == len(ncs.FDArray)
    res['global_subrs_equal'] = [x.bytecode for x in o['CFF '].cff.GlobalSubrs] == \
        [x.bytecode for x in n['CFF '].cff.GlobalSubrs]
    for tag in ('hmtx', 'vmtx'):
        if tag in o:
            res[f'orig_{tag}_diff'] = sum(o[tag].metrics[g] != n[tag].metrics[g] for g in oo)
    cm_diff = 0
    for so in o['cmap'].tables:
        sn = n['cmap'].getcmap(so.platformID, so.platEncID)
        cm_diff += sum(sn.cmap.get(c) != g for c, g in so.cmap.items())
        if not so.isUnicode():
            cm_diff += len(set(sn.cmap) - set(so.cmap))
    res['orig_cmap_mapping_diff'] = cm_diff
    raw = {tag: o.reader[tag] == n.reader[tag] for tag in sorted(o.reader.keys())
           if tag not in ('CFF ', 'cmap', 'hmtx', 'vmtx', 'maxp', 'hhea', 'vhea', 'head')}
    res['untouched_tables_raw_exact'] = all(raw.values())
    res['head_field_diff'] = [k for k in vars(o['head']) if k not in ('checkSumAdjustment', 'tableTag')
                              and getattr(o['head'], k) != getattr(n['head'], k)]
    res['hhea_field_diff'] = [k for k in vars(o['hhea']) if k not in ('numberOfHMetrics', 'tableTag')
                              and getattr(o['hhea'], k) != getattr(n['hhea'], k)]
    if 'vhea' in o:
        res['vhea_field_diff'] = [k for k in vars(o['vhea']) if k not in ('numberOfLongVerMetrics', 'tableTag', 'reserved4')
                                  and getattr(o['vhea'], k) != getattr(n['vhea'], k)]
    role_src = {}
    for s in m['sources']:
        assert sha(Path(s['path']).read_bytes()) == s['sha256']
        k = TTFont(s['path'])
        role_src[s['role']] = (k.getGlyphSet(), k.getBestCmap(), (s['scale'], 0, 0, s['scale'], 0, s['dy']))
    assign = {int(ln.split('\t')[0][2:], 16): ln.split('\t')[2] for ln in
              (p.work / 'added_glyphs.tsv').read_text(encoding='utf-8').split('\n')[1:] if ln}
    ngs, ncm = n.getGlyphSet(), n.getBestCmap()
    added = [c for c in ncm if c not in o.getBestCmap()]
    geo_bad, adv_bad = [], []
    for c in added:
        if c not in assign:
            continue
        kgs, kcm, tr = role_src[assign[c]]
        a, b = bounds_of(kgs, kcm[c], tr), bounds_of(ngs, ncm[c])
        if (a is None) != (b is None) or (a and max(abs(x - y) for x, y in zip(a, b)) > 2):
            geo_bad.append(f'U+{c:04X}')
        if n['hmtx'][ncm[c]][0] != round(kgs[kcm[c]].width * tr[0]):
            adv_bad.append(f'U+{c:04X}')
    res['added_not_in_plan'] = [f'U+{c:04X}' for c in added if c not in assign][:20]
    res['hangul_11172_mapped'] = sum(c in ncm for c in range(0xAC00, 0xD7A4))
    res['compat_jamo_94_mapped'] = sum(c in ncm for c in range(0x3131, 0x318F))
    res['added_geometry_out_of_tol'] = geo_bad[:20]
    res['added_advance_mismatch'] = adv_bad[:20]
    res['render_probe'] = render_probe(p, f, added)
    res['PASS'] = bool(res['glyph_order_prefix_exact'] and not res['orig_charstring_bytecode_diff']
                       and not res['orig_fdselect_diff'] and res['fdarray_len_equal'] and res['global_subrs_equal']
                       and not res.get('orig_hmtx_diff') and not res.get('orig_vmtx_diff') and not cm_diff
                       and res['untouched_tables_raw_exact'] and not res['head_field_diff'] and not res['hhea_field_diff']
                       and not res.get('vhea_field_diff') and not geo_bad and not adv_bad
                       and res['render_probe']['empty'] == 0 and res['render_probe']['notdef'] == 0
                       and res['hangul_11172_mapped'] == 11172 and res['compat_jamo_94_mapped'] == 94
                       and not res['added_not_in_plan'])
    p.art.mkdir(parents=True, exist_ok=True)
    (p.art / 'fontcheck.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(res, ensure_ascii=False)[:2000])
    return res['PASS']


def render_probe(p, path, cps):
    import freetype
    from PIL import Image, ImageDraw, ImageFont
    face = freetype.Face(str(path))
    face.set_pixel_sizes(0, 32)
    empty, notdef = [], []
    for c in cps:
        if chr(c).isspace() or c in BLANK_OK:
            continue
        if face.get_char_index(c) == 0:
            notdef.append(f'U+{c:04X}')
            continue
        face.load_char(chr(c), freetype.FT_LOAD_RENDER)
        bm = face.glyph.bitmap
        if bm.rows == 0 or not any(bm.buffer):
            empty.append(f'U+{c:04X}')
    p.art.mkdir(parents=True, exist_ok=True)
    for px in (16, 24, 40):
        fnt, h = ImageFont.truetype(str(path), px), int(px * 1.6)
        img = Image.new('L', (px * 30, h * len(PROBE_LINES) + 8), 255)
        d = ImageDraw.Draw(img)
        for i, ln in enumerate(PROBE_LINES):
            d.text((4, 4 + i * h), ln, font=fnt, fill=0)
        img.save(p.art / f'font_probe_{px}px.png')
    return {'checked': len(cps), 'empty': len(empty), 'notdef': len(notdef), 'examples': (empty + notdef)[:10]}


# ---------------- build / verify / noop (Unity containers) ----------------
def target_files(p):
    per = collections.defaultdict(set)
    for rel, an, pid in target_objects(p):
        per[rel].add((an, pid))
    return per


def patch_env(env, keys, font_bytes, orig):
    """Replace m_FontData of the given Font objects (font_bytes None = no-op rewrite)."""
    n = 0
    for o in env.objects:
        if o.type.name == 'Font' and (o.assets_file.name, o.path_id) in keys:
            t = o.read_typetree()
            if font_bytes is not None:
                assert sha(bytes(t['m_FontData'])) == sha(orig), 'unexpected source font program'
                t['m_FontData'] = list(font_bytes) if isinstance(t['m_FontData'], list) else font_bytes
            o.save_typetree(t)
            n += 1
    assert n == len(keys), (n, keys)


def src_of(p, rel):
    if p.a.base and (Path(p.a.base) / 'romfs' / rel).exists():
        return Path(p.a.base) / 'romfs' / rel
    return p.rom / rel


def raw_map(env):
    return {(o.assets_file.name, o.path_id): o.get_raw_data() for o in env.objects}


def check_container(rel, src, data, keys, expect_font):
    from ucommon import UnityPy
    env_o, env_n = UnityPy.load(str(src)), UnityPy.load(data)
    a, b = raw_map(env_o), raw_map(env_n)
    bad = [f'{rel}: object set differs'] if set(a) != set(b) else []
    bad += [f'{rel}: non-target object raw changed {k}' for k in a if k not in keys and a[k] != b.get(k)]
    no = {(o.assets_file.name, o.path_id): o for o in env_n.objects}
    oo = {(o.assets_file.name, o.path_id): o for o in env_o.objects}
    for k in keys:
        tn, to = no[k].read_typetree(), oo[k].read_typetree()
        if bytes(tn['m_FontData']) != expect_font:
            bad.append(f'{rel}: {k} m_FontData != expected')
        other = [f for f in to if f != 'm_FontData' and to[f] != tn[f]]
        if other:
            bad.append(f'{rel}: {k} other Font fields changed {other}')
    if [[e.path for e in sf.externals] for sf in env_o.assets] != [[e.path for e in sf.externals] for sf in env_n.assets]:
        bad.append(f'{rel}: externals changed')
    return bad, len(a)


def build(p):
    from ucommon import UnityPy, w_atomic
    f, nb, ob, m = merged(p)
    rep = []
    for rel, keys in sorted(target_files(p).items()):
        src = src_of(p, rel)
        env = UnityPy.load(str(src))
        patch_env(env, keys, nb, ob)
        data = env.file.save(packer='original')
        w_atomic(p.out / 'romfs' / rel, data)
        rep.append(f'{rel}\tsrc={src}\tfonts={len(keys)}\tsha256={sha(data)}\tbytes={len(data)}')
        print('build', rep[-1], flush=True)
    w_atomic(p.out / 'FONT_BUILD_MANIFEST.tsv', f'# merged font {f.name} sha256={m["merged_sha256"]}\n' + '\n'.join(rep) + '\n')


def verify(p, noop=False):
    from ucommon import UnityPy
    f, nb, ob, m = merged(p)
    bad, nobj = [], 0
    for rel, keys in sorted(target_files(p).items()):
        if noop:
            env = UnityPy.load(str(p.rom / rel))
            patch_env(env, keys, None, ob)
            data = env.file.save(packer='original')
            b, n = check_container(rel, p.rom / rel, data, keys, ob)
            if raw_map(UnityPy.load(str(p.rom / rel))) != raw_map(UnityPy.load(data)):
                b.append(f'{rel}: target Font raw changed by typetree no-op')
        else:
            b, n = check_container(rel, src_of(p, rel), (p.out / 'romfs' / rel).read_bytes(), keys, nb)
        bad += b
        nobj += n
    msg = f'font {"noop" if noop else "verify"} files={len(target_files(p))} objects={nobj} bad={len(bad)}'
    p.art.mkdir(parents=True, exist_ok=True)
    (p.art / f'font_{"noop" if noop else "verify"}.txt').write_text(msg + '\n' + ''.join(x + '\n' for x in bad),
                                                                    encoding='utf-8')
    print(msg, *bad[:10], sep='\n')
    return not bad


# ---------------- coverage ----------------
def used_text(txt):
    """Characters of current Korean text: bulk/supplement part outputs + filled target_ko of both manifests."""
    chars, srcs = collections.Counter(), collections.Counter()

    def feed(s, tag):
        chars.update(ord(ch) for ch in TOKEN.sub('', s))
        srcs[tag] += 1
    for d in (txt / 'batches' / 'bulk' / 'out', txt / 'supplement' / 'out'):
        for f in sorted(d.glob('*.tsv')) if d.exists() else ():
            for ln in f.read_text(encoding='utf-8').split('\n'):
                if '\t' in ln:
                    feed(ln.split('\t', 1)[1], d.parent.name + '/out')
    for mf in (txt / 'translation_manifest.tsv', txt / 'supplement' / 'SUPP_MANIFEST.tsv'):
        if mf.exists():
            lines = mf.read_text(encoding='utf-8').split('\n')
            ti = lines[0].split('\t').index('target_ko')
            for ln in lines[1:]:
                c = ln.split('\t')
                if len(c) > ti and c[ti]:
                    feed(c[ti], mf.name)
    return chars, srcs


def coverage_rows(chars, ocm, ncm):
    rows = []
    for c in sorted(set(chars) | set(range(0xAC00, 0xD7A4)) | set(range(0x3131, 0x318F))):
        if c in (0x0A, 0x0D, 0x09):
            continue
        st = 'orig' if c in ocm else ('added' if c in ncm else ('space' if chr(c).isspace() else 'MISSING'))
        rows.append((c, st, chars.get(c, 0)))
    return rows


def coverage(p):
    from fontTools.ttLib import TTFont
    f, nb, ob, m = merged(p)
    ncm, ocm = TTFont(str(f)).getBestCmap(), TTFont(io.BytesIO(ob)).getBestCmap()
    chars, srcs = used_text(p.prj / '30_translation' / 'text')
    rows = coverage_rows(chars, ocm, ncm)
    miss = [(c, n) for c, st, n in rows if st == 'MISSING' and n]
    summ = {'all_hangul_covered': sum(c in ncm for c in range(0xAC00, 0xD7A4)),
            'compat_jamo_covered': sum(c in ncm for c in range(0x3131, 0x318F)), 'used_codepoints': len(chars),
            'used_missing': len(miss), 'used_missing_list': ' '.join(f'U+{c:04X}({chr(c)})x{n}' for c, n in miss[:60]),
            'text_sources_lines': dict(srcs)}
    p.art.mkdir(parents=True, exist_ok=True)
    (p.art / 'FONT_COVERAGE.tsv').write_text('codepoint\tchar\tstatus\tused_count\n' + ''.join(
        f'U+{c:04X}\t{"" if chr(c).isspace() else chr(c)}\t{st}\t{n}\n' for c, st, n in rows), encoding='utf-8')
    (p.art / 'coverage_summary.json').write_text(json.dumps(summ, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(summ, ensure_ascii=False))
    return not miss


def selftest():
    t = {'m_Font': {'m_FileID': 0, 'm_PathID': 5}, 'm_Script': {'m_FileID': 1, 'm_PathID': 2},
         'sub': {'fontAsset': {'m_FileID': 1, 'm_PathID': 9}, 'list': [{'m_fontAsset': {'m_FileID': 0, 'm_PathID': 0}}]}}
    assert [x for x, _ in font_pptrs(t)] == ['m_Font', 'sub.fontAsset', 'sub.list.0.m_fontAsset']
    s, dy, _ = common_transform([(0, -100, 1000, 900)] * 2, [(0, 0, 500, 500)], 0.95)
    assert s == 1.9 and dy == round(400 - 1.9 * 250)
    base = {0x41: 'A', 0xAC00: 'x'}
    plan, un = add_plan(base, [({0xAC01: 'g1', 0xAC02: 'e'}, lambda g: g != 'e'),
                               ({0xAC02: 'h', 0x3164: 'f'}, lambda g: True)], {0x41, 0x2460})
    assert plan[0xAC01] == 0 and plan[0xAC02] == 1 and plan[0x3164] == 1 and 0xAC00 not in plan and 0x41 not in plan
    assert 0x2460 in un and len(plan) + len(un) == 11172 + 94 - 1 + 1
    assert parse_ko(['primary=C:/f.otf=AB']) == [('primary', Path('C:/f.otf'), 'ab')]
    rows = coverage_rows({0xAC00: 3, 0x3042: 1, 0x20: 5, 0xFF5E: 2}, {0x3042, 0x20}, {0x3042, 0x20, 0xAC00})
    st = {c: s for c, s, _ in rows}
    assert st[0xAC00] == 'added' and st[0x3042] == 'orig' and st[0xFF5E] == 'MISSING' and st[0xAC01] == 'MISSING'
    assert TOKEN.sub('', '가\\n<color=red>나</color>{0}%d') == '가나'
    import contextlib
    import tempfile
    with tempfile.TemporaryDirectory() as d:  # older merge_meta.json without "font"; --base without romfs/
        ns = argparse.Namespace(p=d, tag='r1', out=None, base=None, font=None)
        q = P(ns)
        q.work.mkdir(parents=True)
        (q.work / 'merge_meta.json').write_text(json.dumps({'orig_sha256': 'ab' * 32}), encoding='utf-8')
        (q.work / f'Old_Font_{"ab" * 4}_ko_r1.otf').write_bytes(b'')
        with contextlib.redirect_stderr(io.StringIO()):
            assert q.meta()['font'] == q.font() == 'Old_Font'
            ns.font = 'Given'
            assert q.meta()['font'] == 'Given'
        (q.work / f'Two_{"ab" * 4}_ko_r1.otf').write_bytes(b'')
        ns.font = None
        for bad in (lambda: q.meta(), lambda: P(argparse.Namespace(p=d, tag='r1', out=None, base=d, font=None))):
            try:
                bad()
                raise AssertionError('accepted')
            except SystemExit as e:
                assert 'font' in str(e) or 'no romfs/' in str(e), e
    print('unity_font selftest OK')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['inventory', 'merge', 'fontcheck', 'build', 'verify', 'noop', 'coverage', 'selftest'])
    ap.add_argument('-p')
    ap.add_argument('--font', help='Unity Font m_Name to extend (default: from merge_meta.json)')
    ap.add_argument('--ko', action='append', default=[], help='ROLE=PATH[=SHA256] glyph source, in priority order')
    ap.add_argument('--ratio', type=float, default=0.95, help='Hangul bbox height / reference kanji bbox height')
    ap.add_argument('--tag', default='r1')
    ap.add_argument('--base')
    ap.add_argument('--out')
    a = ap.parse_args()
    if a.cmd == 'selftest':
        return selftest()
    p = P(a)
    fn = {'inventory': inventory, 'merge': merge, 'fontcheck': fontcheck, 'build': build, 'verify': verify,
          'noop': lambda q: verify(q, noop=True), 'coverage': coverage}[a.cmd]
    r = fn(p)
    return 0 if r in (None, True) else 1


if __name__ == '__main__':
    sys.exit(main())
