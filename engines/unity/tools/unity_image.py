"""unity_image.py - typeset / logo-paste Korean labels into Unity Texture2D atlases and splice only the edited blocks.

  python -I -X utf8 unity_image.py <cmd> -p <_work/TID> [--round r1] [--base DIR] [--out DIR] [args]
    list <fk> [regex]          texture ids of one container (fk = alias from the config or a romfs-relative path)
    dump <fk> <regex>          decoded PNGs of matching textures -> 90_tools/work/image_<round>/dump/
    comps <tex_id> [min_h]     annotated alpha-component map of one texture -> 90_tools/work/image_<round>/comps/
    locate                     secondary title: template-match every primary box into this title -> LOCATE_<TID>.tsv
    render                     typeset all status=typeset* rows -> image_translation/typeset_<round>/<TID>/ (+compare/)
    build                      changed-block splice -> <out|40_build/image_<round>>/romfs/<rel> (+IMAGE_BUILD_MANIFEST.tsv);
                               source container = <base>/romfs/<rel> when present (text/font overlay) else romfs_original
    verify                     reload: non-target objects raw-exact, resS bytes outside target ranges exact, raw blocks
                               outside the edit set exact, decoded pixels outside edit blocks exact, headers unchanged
    noop                       codec gate: deswizzle->swizzle and untouched rewrite byte-identical for every target
    halo <cand> <src> <out> [noglow]   imagegen logo candidate -> final (alpha normalised, source soft glow rebuilt)
  python -I unity_image.py selftest

Config `30_translation/image_translation/image_config.json` (all keys optional):
  files: {alias: romfs-relative path}  (a tex_id file key that is not an alias is used as the path itself)
  fonts: {key: ttf path}  (relative paths resolve against $GT_FONTS, default E:\\NSW\\_tools\\_fonts)
  spec: spec TSV (default IMAGE_TEXT_INVENTORY.tsv, relative to image_translation)
  primary_root: _work/TID of the title whose boxes are primary; set on a sibling title that shares the spec.
tex_id = <fk>|<assets_file>|<base name>|<w>x<h>[#n]  (base name = sactx prefix and -hash suffix stripped)
Spec columns: key status mode tex_id box also tex_id_p2 ja ko font fill bands tbox size sx thr align notes
  status typeset (primary box + `also` copies; secondary uses `tex_id_p2` via LOCATE), typeset_p1 (primary only),
  typeset_p2 (secondary only, explicit box); other statuses are inventory only.
  mode sticker|rect|badge|page (erase + typeset `ko`), logo (`ko` = PNG fitted to the box content alpha bbox),
  patch (`ko` = PNG of exactly the box size replacing the box, e.g. an imagegen edit of an opaque crop).
Format, size and m_PlatformBlob are kept: payload is patched in place (deswizzle -> re-encode only blocks holding
edited pixels -> swizzle). No object, key or file is added.
"""
import argparse
import collections
import hashlib
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script dir
from ucommon import UnityPy  # noqa: E402  (sets sys.path for the shared site dir)
import numpy as np  # noqa: E402
import cv2  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

LOC_GATE = 0.90
BLOCK_BYTES = 16  # UnityPy TEXTURE_FORMAT_BLOCK_SIZE_MAP blocks are 16 bytes (ASTC/BC7 4x4.., RGBA32 4x1)
C = {}  # run context: P TID IT WORK OUT TS ART SRC SPEC FILES FONTS primary prim_root round


def setup(p, rnd='r1'):
    p = os.path.abspath(p)
    it = os.path.join(p, '30_translation', 'image_translation')
    cfgp = os.path.join(it, 'image_config.json')
    cfg = json.load(open(cfgp, encoding='utf-8')) if os.path.exists(cfgp) else {}
    fd = os.environ.get('GT_FONTS', r'E:\NSW\_tools\_fonts')
    C.update(P=p, TID=os.path.basename(p), IT=it, round=rnd, SRC=os.path.join(p, '10_extract', 'romfs_original'),
             WORK=os.path.join(p, '90_tools', 'work', 'image_' + rnd), OUT=os.path.join(p, '40_build', 'image_' + rnd),
             TS=os.path.join(it, 'typeset_' + rnd), ART=os.path.join(p, '50_test', 'artifacts', 'image_' + rnd),
             SPEC=os.path.join(it, cfg.get('spec', 'IMAGE_TEXT_INVENTORY.tsv')), FILES=cfg.get('files', {}),
             FONTS={k: os.path.join(fd, v) for k, v in cfg.get('fonts', {}).items()},
             prim_root=cfg.get('primary_root'), primary=not cfg.get('primary_root'))


def sha(b):
    return hashlib.sha256(b).hexdigest()


def base_name(n):
    return re.sub(r'-[0-9a-f]{8}$', '', re.sub(r'^sactx-\d+-\d+x\d+-[^-]+-', '', n))


def tex_id(fk, o, d):
    return f'{fk}|{o.assets_file.name}|{base_name(d.m_Name)}|{d.m_Width}x{d.m_Height}'


def safe(s):
    return re.sub(r'[^0-9A-Za-z_.-]', '_', s)


def rel_of(fk):
    return C['FILES'].get(fk, fk)


def load(fk, base=None, src=None):
    rel = rel_of(fk)
    p = os.path.join(base, 'romfs', rel) if base and os.path.exists(os.path.join(base, 'romfs', rel)) \
        else os.path.join(src or C['SRC'], rel)
    return UnityPy.load(p), p


def textures(env, fk):
    out = {}
    for o in env.objects:
        if o.type.name == 'Texture2D':
            d = o.read()
            k0 = k = tex_id(fk, o, d)
            n = 1
            while k in out:  # duplicate names: numbered in object order
                n += 1
                k = f'{k0}#{n}'
            out[k] = (o, d)
    return out


def decode(d):
    return np.asarray(d.image.convert('RGBA')).copy()


# ---------------- spec ----------------
def specs(path=None):
    rows = []
    with open(path or C['SPEC'], encoding='utf-8') as h:
        hdr = h.readline().rstrip('\n').split('\t')
        for ln in h:
            if ln.strip() and not ln.startswith('#'):
                rows.append(dict(zip(hdr, ln.rstrip('\n').split('\t'))))
    return rows


def lst(s):
    return [t for t in (s or '').split(';') if t and t != '-']


def box_of(s):
    return tuple(int(v) for v in s.split(','))


def located_texs(r, primary):
    """texture ids of this title whose box is found by template matching against the primary box"""
    return lst(r.get('also')) if primary else lst(r.get('tex_id_p2'))


def row_targets(r, loc, primary):
    """[(tex_id, box)] for this title; a located copy below the score gate gets box None (reported as skipped)."""
    st = r['status']
    if st == 'typeset_p2':  # secondary-only row (own art): explicit tex/box, no template locate
        return [] if primary else [(t, box_of(r['box'])) for t in lst(r['tex_id_p2'])]
    if st == 'typeset_p1':
        return [(r['tex_id'], box_of(r['box']))] if primary else []
    out = [(r['tex_id'], box_of(r['box']))] if primary else []
    for t in located_texs(r, primary):
        out.append((t, loc.get(r['key'] + '@' + t)))
    return out


# ---------------- inspection ----------------
def comps(tid, min_h=10):
    fk = tid.split('|')[0]
    env, _ = load(fk)
    o, d = textures(env, fk)[tid]
    a = decode(d)
    m = cv2.dilate((a[:, :, 3] > 24).astype(np.uint8), np.ones((3, 3), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    od = os.path.join(C['WORK'], 'comps')
    os.makedirs(od, exist_ok=True)
    bg = Image.new('RGBA', (a.shape[1], a.shape[0]), (70, 70, 70, 255))
    bg.alpha_composite(Image.fromarray(a))
    S = 2 if a.shape[1] <= 1024 else 1
    bg = bg.resize((bg.width * S, bg.height * S), Image.NEAREST)
    dr = ImageDraw.Draw(bg)
    rows = []
    for i in range(1, n):
        x, y, w, h, _ = st[i]
        if h < min_h or w < 8:
            continue
        rows.append((i, x, y, w, h))
        dr.rectangle([x * S, y * S, (x + w) * S, (y + h) * S], outline=(0, 255, 255, 255))
        dr.text((x * S + 1, y * S), str(i), fill=(255, 255, 0, 255), stroke_width=2, stroke_fill=(0, 0, 0, 255))
    fn = os.path.join(od, safe(tid))
    bg.convert('RGB').save(fn + '.png')
    with open(fn + '.tsv', 'w', encoding='utf-8', newline='\n') as h:
        h.write('id\tx\ty\tw\th\n' + ''.join('\t'.join(map(str, r)) + '\n' for r in rows))
    print(fn + '.png', len(rows))


def dump(fk, rx):
    od = os.path.join(C['WORK'], 'dump')
    os.makedirs(od, exist_ok=True)
    env, _ = load(fk)
    n = 0
    for k, (o, d) in sorted(textures(env, fk).items()):
        if re.search(rx, k):
            Image.fromarray(decode(d)).save(os.path.join(od, safe(k) + '.png'))
            n += 1
    print('dump', fk, n, od)


# ---------------- locate (secondary title) ----------------
def premul(im):
    return np.ascontiguousarray(np.dstack([im[:, :, :3].astype(np.float32) * (im[:, :, 3:4] / 255.0),
                                           im[:, :, 3:4].astype(np.float32)]))


def locate():
    assert not C['primary'], 'locate runs on the secondary title (image_config.json primary_root)'
    p1 = C['prim_root']
    p1src = os.path.join(p1, '10_extract', 'romfs_original')
    cache1, cache2 = {}, {}

    def img(src, tid, cache):
        if tid not in cache:
            fk = tid.split('|')[0]
            cache[tid] = decode(textures(load(fk, src=src)[0], fk)[tid][1])
        return cache[tid]
    out = ['key\tbox\tscore']
    for r in specs():
        if r['status'] != 'typeset':
            continue
        x, y, w, h = box_of(r['box'])
        tpl = premul(img(p1src, r['tex_id'], cache1)[y:y + h, x:x + w])
        for t2 in located_texs(r, False):
            res = cv2.matchTemplate(premul(img(C['SRC'], t2, cache2)), tpl, cv2.TM_CCOEFF_NORMED)
            _, sc, _, (mx, my) = cv2.minMaxLoc(res)
            out.append(f'{r["key"]}@{t2}\t{mx},{my},{w},{h}\t{sc:.4f}')
            print(out[-1], flush=True)
    with open(os.path.join(C['IT'], f'LOCATE_{C["TID"]}.tsv'), 'w', encoding='utf-8', newline='\n') as h:
        h.write('\n'.join(out) + '\n')


def loc_map():
    p = os.path.join(C['IT'], f'LOCATE_{C["TID"]}.tsv')
    m = {}
    if os.path.exists(p):
        for ln in open(p, encoding='utf-8').read().splitlines()[1:]:
            k, b, s = ln.split('\t')
            if float(s) >= LOC_GATE:
                m[k] = box_of(b)
    return m


# ---------------- typesetting ----------------
def hexc(s):
    s = s.lstrip('#')
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def fit_font(path, lines, maxw, maxh, sw, size0):
    for s in range(size0, 5, -1):
        f = ImageFont.truetype(path, s)
        bbs = [f.getbbox(t, stroke_width=sw) for t in lines]
        lw = max(b[2] - b[0] for b in bbs)
        lh = sum(b[3] - b[1] for b in bbs) + (len(lines) - 1) * max(1, s // 8)
        if lw <= maxw and lh <= maxh:
            return f
    return ImageFont.truetype(path, 6)


def draw_text(canvas, box, text, font_path, fill, bands, size0=None, align='center', sx=1.0):
    """render text (\\n = line break) centred in box onto an RGBA ndarray canvas (in place, alpha-over).
    bands = [(colour, width)] outermost first, drawn as nested strokes under the fill."""
    x, y, w, h = box
    lines = text.split('\\n')
    SS = 4
    sw = sum(b[1] for b in bands)
    pad = sw
    f = fit_font(font_path, lines, int((w - 2) * SS / sx), (h - 2) * SS, sw * SS, (size0 or h) * SS)
    asc, desc = f.getmetrics()
    lh = asc + desc
    gap = max(1, f.size // 10)
    tot = lh * len(lines) + gap * (len(lines) - 1)
    L = Image.new('RGBA', (int(w * SS / sx) + 2 * pad * SS, h * SS + 2 * pad * SS), (0, 0, 0, 0))
    dr = ImageDraw.Draw(L)
    cy = (L.height - tot) // 2
    for t in lines:
        bb = f.getbbox(t, stroke_width=sw * SS)
        tw = bb[2] - bb[0]
        cx = (L.width - tw) // 2 - bb[0] if align == 'center' else pad * SS + sw * SS - bb[0]
        rem = sw
        for col, bw_ in bands:
            dr.text((cx, cy), t, font=f, fill=col + (255,), stroke_width=rem * SS, stroke_fill=col + (255,))
            rem -= bw_
        dr.text((cx, cy), t, font=f, fill=fill + (255,))
        cy += lh + gap
    al = np.asarray(L)[:, :, 3]  # vertical ink centring
    ys = np.where(al.max(axis=1) > 0)[0]
    if len(ys):
        L = Image.fromarray(np.roll(np.asarray(L), (L.height - (ys[-1] + ys[0])) // 2, axis=0))
    L = L.resize((max(1, round(L.width / SS * sx)), L.height // SS), Image.LANCZOS)
    tmp = Image.new('RGBA', (canvas.shape[1], canvas.shape[0]), (0, 0, 0, 0))
    tmp.paste(L, (x + (w - L.width) // 2, y - pad))
    canvas[:] = np.asarray(Image.alpha_composite(Image.fromarray(canvas), tmp))


def fit_bands(a, mask):
    """Ring analysis from the lettering edge inwards: consecutive rings of similar colour form one band.
    Returns (fill, [(colour, width), ...] outermost first). The innermost band is the fill."""
    dist = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 3)
    rgb = a[:, :, :3].reshape(-1, 3).astype(int)
    dm = dist.reshape(-1)
    op = a[:, :, 3].reshape(-1) > 160
    rings = []
    for t in range(1, int(dm.max()) + 1):
        ring = (dm > t - 0.5) & (dm <= t + 0.5) & op
        if ring.sum() >= 8:
            rings.append(np.median(rgb[ring], axis=0))
    if not rings:
        return (255, 255, 255), []
    groups = [[rings[0], 1]]
    for c in rings[1:]:
        if np.abs(c - groups[-1][0]).sum() < 70:
            groups[-1][1] += 1
        else:
            groups.append([c, 1])
    fill = tuple(int(v) for v in groups[-1][0])
    bands = [(tuple(int(v) for v in c), w) for c, w in groups[:-1]]
    return fill, (bands if len(groups) > 1 else [])


def parse_bands(s):
    return [] if s == 'none' else [(hexc(c.split(':')[0]), int(c.split(':')[1])) for c in s.split(';')]


def fmt_bands(b):
    return ';'.join('#%02x%02x%02x:%d' % (c + (w,)) for c, w in b) or 'none'


def halo_final(cand_png, src_png, out_png, glow_on=True):
    """imagegen logo candidate -> final: candidate RGB kept; its hard alpha is normalised and the source's
    soft white outer glow is rebuilt around the new lettering (dilate + gaussian, peak alpha = source glow level)."""
    c = np.asarray(Image.open(cand_png).convert('RGBA')).astype(np.float32)
    s = np.asarray(Image.open(src_png).convert('RGBA')).astype(np.float32)
    al = np.clip(c[:, :, 3] * 255.0 / max(1.0, c[:, :, 3].max()), 0, 255)
    core = (al > 128).astype(np.uint8)
    glow = cv2.GaussianBlur(cv2.dilate(core, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))).astype(np.float32),
                            (0, 0), 8)
    gl = s[:, :, 3][(s[:, :, 3] > 0) & (s[:, :, 3] < 255)]
    peak = float(np.percentile(gl, 90)) / 255.0 if gl.size else 0.8
    out = c.copy()
    out[:, :, :3][al < 1] = 255.0
    out[:, :, 3] = np.maximum(al, glow * peak * 255.0) if glow_on else al
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(out_png)


def paste_logo(sub, logo):
    """replace the box content with the logo (RGBA ndarray) fitted to the alpha bbox of the original content."""
    al = sub[:, :, 3] > 8
    ys, xs = np.where(al)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    la = logo[:, :, 3] > 8
    lys, lxs = np.where(la)
    L = Image.fromarray(logo).crop((lxs.min(), lys.min(), lxs.max() + 1, lys.max() + 1))
    L = L.resize((int(x1 - x0), int(y1 - y0)), Image.LANCZOS)
    sub[al] = 0
    sub[y0:y1, x0:x1] = np.asarray(L)
    return int(al.sum())


def apply_row(a, r, box, it, fonts):
    x, y, w, h = box
    mode = r['mode']
    sub = a[y:y + h, x:x + w]
    if mode in ('logo', 'patch'):
        im = np.asarray(Image.open(os.path.join(it, r['ko'])).convert('RGBA'))
        if mode == 'logo':
            return dict(fill='-', bands='-', cleared=paste_logo(sub, im))
        assert im.shape[:2] == sub.shape[:2], ('patch size', r['key'], im.shape, sub.shape)
        n = int((sub != im).any(axis=2).sum())
        sub[:] = im
        return dict(fill='-', bands='-', cleared=n)
    if mode == 'sticker':
        # every alpha component whose bbox lies inside the box is the JA lettering + its effects
        m = (sub[:, :, 3] > 0).astype(np.uint8)
        n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
        mask = np.zeros_like(m, bool)
        for i in range(1, n):
            cx, cy, cw, ch, _ = st[i]
            if cx >= 0 and cy >= 0 and cx + cw <= w and cy + ch <= h:
                mask |= lab == i
        fill, bands = fit_bands(sub, mask)
        sub[mask] = 0
    elif mode == 'rect':  # transparent lettering whose glow touches a neighbour: clear the whole declared rect
        mask = sub[:, :, 3] > 0
        fill, bands = fit_bands(sub, mask)
        sub[mask] = 0
    elif mode in ('badge', 'page'):
        bd = np.concatenate([sub[0], sub[-1], sub[:, 0], sub[:, -1]]).astype(int)
        bgc = np.median(bd, axis=0)
        mask = np.abs(sub.astype(int) - bgc).max(axis=2) > int(r.get('thr') or 48)
        mask = cv2.dilate(mask.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
        fill, bands = fit_bands(sub, mask)
        if mode == 'page' or (np.abs(sub.astype(int) - bgc).max(axis=2) < 24)[~mask].mean() > 0.97:
            sub[mask] = bgc.astype(np.uint8)
        else:
            m8 = mask.astype(np.uint8)
            rgb = cv2.inpaint(np.ascontiguousarray(sub[:, :, :3]), m8, 3, cv2.INPAINT_TELEA)
            al = cv2.inpaint(np.ascontiguousarray(sub[:, :, 3]), m8, 3, cv2.INPAINT_TELEA)
            sub[:, :, :3] = np.where(mask[:, :, None], rgb, sub[:, :, :3])
            sub[:, :, 3] = np.where(mask, al, sub[:, :, 3])
        if mode == 'page':
            bands = []
    else:
        raise SystemExit('bad mode ' + mode)
    if r.get('fill'):
        fill = hexc(r['fill'])
    if r.get('bands'):
        bands = parse_bands(r['bands'])
    tb = box
    if r.get('tbox'):
        dx, dy, dw, dh = box_of(r['tbox'])
        tb = (x + dx, y + dy, dw, dh)
    draw_text(a, tb, r['ko'], fonts[r.get('font') or 'NSR-EB'], fill, bands,
              int(r['size']) if r.get('size') else None, r.get('align') or 'center', float(r.get('sx') or 1.0))
    return dict(fill='#%02x%02x%02x' % fill, bands=fmt_bands(bands), cleared=int(mask.sum()))


def render():
    loc = loc_map()
    per = collections.defaultdict(list)
    skipped = []
    for r in specs():
        if not r['status'].startswith('typeset'):
            continue
        for t, b in row_targets(r, loc, C['primary']):
            if b:
                per[t].append((r, b))
            else:
                skipped.append(r['key'] + '@' + t)
    od = os.path.join(C['TS'], C['TID'])
    os.makedirs(os.path.join(od, 'compare'), exist_ok=True)
    log, envs = [], {}
    for tid, rows in sorted(per.items()):
        fk = tid.split('|')[0]
        if fk not in envs:
            envs[fk] = textures(load(fk)[0], fk)
        o, d = envs[fk][tid]
        orig = decode(d)
        a = orig.copy()
        for r, b in rows:
            log.append(dict(key=r['key'], tex=tid, box=b, ko=r['ko'], **apply_row(a, r, b, C['IT'], C['FONTS'])))
        Image.fromarray(a).save(os.path.join(od, safe(tid) + '.png'))
        Image.fromarray(orig).save(os.path.join(od, safe(tid) + '.orig.png'))
        for r, b in rows:  # compare strip per row: original | edited
            x, y, w, h = b
            x0, y0 = max(0, x - 6), max(0, y - 6)
            x1, y1 = min(a.shape[1], x + w + 6), min(a.shape[0], y + h + 6)
            A, B = Image.fromarray(orig[y0:y1, x0:x1]), Image.fromarray(a[y0:y1, x0:x1])
            S = max(1, min(4, 240 // max(1, y1 - y0)))
            cv = Image.new('RGBA', ((x1 - x0) * 2 * S + 8, (y1 - y0) * S), (80, 80, 80, 255))
            cv.alpha_composite(A.resize((A.width * S, A.height * S)), (0, 0))
            cv.alpha_composite(B.resize((B.width * S, B.height * S)), (A.width * S + 8, 0))
            cv.convert('RGB').save(os.path.join(od, 'compare', safe(r['key'] + '@' + tid) + '.png'))
    with open(os.path.join(od, 'render_log.json'), 'w', encoding='utf-8') as h:
        json.dump(dict(tid=C['TID'], rows=log, skipped=skipped), h, ensure_ascii=False, indent=1)
    print('render', C['TID'], 'textures', len(per), 'rows', len(log), 'skipped', len(skipped), skipped[:20])


# ---------------- codec / splice ----------------
def fmt_info(d):
    from UnityPy.helpers import TextureSwizzler as TS
    from UnityPy.enums import TextureFormat as TF
    fmt = TF(d.m_TextureFormat)
    s_fmt = TF.RGBA32 if fmt == TF.RGB24 else fmt
    bw, bh = TS.TEXTURE_FORMAT_BLOCK_SIZE_MAP[s_fmt]
    blob = bytes(d.m_PlatformBlob or b'')
    sw = TS.is_switch_swizzled(d.object_reader.platform, list(blob))
    gobs = TS.get_switch_gobs_per_block(list(blob)) if sw else 0
    if sw:
        W, H = TS.get_padded_texture_size(d.m_Width, d.m_Height, bw, bh, gobs)
    else:
        W, H = -(-d.m_Width // bw) * bw, -(-d.m_Height // bh) * bh
    return fmt, s_fmt, bw, bh, sw, gobs, W, H


def get_raw(env, o, d):
    sd = d.m_StreamData
    if sd and sd.path:
        name = sd.path.split('/')[-1]
        f = env.file.files[name] if hasattr(env.file, 'files') and name in env.file.files else None
        assert f is not None, ('resS not in container', sd.path)
        return bytes(f.bytes[sd.offset:sd.offset + sd.size]), ('resS', name, sd.offset, sd.size)
    return bytes(d.image_data), ('inline',)


def to_linear(raw, info):
    from UnityPy.helpers import TextureSwizzler as TS
    fmt, s_fmt, bw, bh, sw, gobs, W, H = info
    return bytearray(TS.deswizzle(raw, W, H, bw, bh, gobs)) if sw else bytearray(raw)


def from_linear(lin, info):
    from UnityPy.helpers import TextureSwizzler as TS
    fmt, s_fmt, bw, bh, sw, gobs, W, H = info
    return bytes(TS.swizzle(lin, W, H, bw, bh, gobs)) if sw else bytes(lin)


def encode_crop(rgba, s_fmt):
    from UnityPy.export import Texture2DConverter as TC
    from UnityPy.enums import TextureFormat as TF
    h, w = rgba.shape[:2]
    data = np.ascontiguousarray(rgba).tobytes()
    if s_fmt.name.startswith('ASTC'):
        return TC.compress_astc(data, w, h, s_fmt)
    if s_fmt in (TF.DXT1, TF.DXT5, TF.BC7):
        return TC.compress_etcpak(data, w, h, s_fmt)
    if s_fmt == TF.RGBA32:
        return data
    raise SystemExit(f'unsupported format {s_fmt}')


def splice(lin, orig_img, new_img, info, enc=encode_crop):
    """returns (new linear bytes, changed block list). Images are top-down RGBA of the visible size;
    storage is bottom-up, padded to W x H (padding never counts as an edit)."""
    fmt, s_fmt, bw, bh, sw, gobs, W, H = info
    h, w = orig_img.shape[:2]
    nb = BLOCK_BYTES

    def prep(im):
        return np.pad(im[::-1], ((0, H - h), (0, W - w), (0, 0)), mode='constant')
    A, B = prep(orig_img), prep(new_img)
    nbx, nby = W // bw, H // bh
    ch = (A != B).any(axis=2).reshape(nby, bh, nbx, bw).any(axis=(1, 3))
    ys, xs = np.where(ch)
    if not len(ys):
        return lin, []
    by0, by1, bx0, bx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    data = enc(B[by0 * bh:by1 * bh, bx0 * bw:bx1 * bw], s_fmt)
    cw = bx1 - bx0
    out = bytearray(lin)
    assert len(data) == cw * (by1 - by0) * nb, (len(data), cw, by1 - by0)
    for by, bx in zip(ys, xs):
        src = ((by - by0) * cw + (bx - bx0)) * nb
        dst = (by * nbx + bx) * nb
        out[dst:dst + nb] = data[src:src + nb]
    return out, list(zip(ys.tolist(), xs.tolist()))


def put_raw(env, o, d, where, new_raw):
    from UnityPy.streams import EndianBinaryReader
    if where[0] == 'resS':
        _, name, off, size = where
        assert len(new_raw) == size
        old = env.file.files[name]
        buf = bytearray(old.bytes)
        buf[off:off + size] = new_raw
        nr = EndianBinaryReader(bytes(buf))
        nr.flags = old.flags
        env.file.files[name] = nr
        if hasattr(env.file, 'mark_changed'):
            env.file.mark_changed()
    else:
        t = o.read_typetree()
        t['image data'] = new_raw
        o.save_typetree(t)


def targets():
    """tex_id -> edited png path for this title (from the last render)"""
    od = os.path.join(C['TS'], C['TID'])
    lg = json.load(open(os.path.join(od, 'render_log.json'), encoding='utf-8'))
    return {t: os.path.join(od, safe(t) + '.png') for t in sorted({r['tex'] for r in lg['rows']})}


def build(base=None, out=None):
    out = out or C['OUT']
    tg = targets()
    rep = []
    for fk in sorted({t.split('|')[0] for t in tg}):
        env, srcp = load(fk, base)
        tx = textures(env, fk)
        for tid, png in tg.items():
            if tid.split('|')[0] != fk:
                continue
            o, d = tx[tid]
            info = fmt_info(d)
            raw, where = get_raw(env, o, d)
            new = np.asarray(Image.open(png).convert('RGBA'))
            nlin, ch = splice(to_linear(raw, info), decode(d), new, info)
            nraw = from_linear(nlin, info)
            assert len(nraw) == len(raw)
            put_raw(env, o, d, where, nraw)
            rep.append(f'{tid}\t{where[0]}\tblocks={len(ch)}\traw_sha_old={sha(raw)[:16]}\traw_sha_new={sha(nraw)[:16]}')
            print(rep[-1], flush=True)
        data = env.file.save(packer='original')
        dst = os.path.join(out, 'romfs', rel_of(fk))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst + '.tmp', 'wb') as h:
            h.write(data)
        os.replace(dst + '.tmp', dst)
        rep.append(f'#file {rel_of(fk)}\tsrc={srcp}\tsha256={sha(data)}\tbytes={len(data)}')
        print(rep[-1], flush=True)
    with open(os.path.join(out, 'IMAGE_BUILD_MANIFEST.tsv'), 'w', encoding='utf-8', newline='\n') as h:
        h.write('\n'.join(rep) + '\n')


def raw_objs(env):
    return {(o.assets_file.name, o.path_id): o.get_raw_data() for o in env.objects}


def res_files(env):
    return {k: bytes(v.bytes) for k, v in env.file.files.items() if not hasattr(v, 'objects')}


def verify(base=None, out=None):
    out = out or C['OUT']
    tg = targets()
    bad, stats = [], []
    for fk in sorted({t.split('|')[0] for t in tg}):
        e0, _ = load(fk, base)
        e1 = UnityPy.load(os.path.join(out, 'romfs', rel_of(fk)))
        r0, r1 = raw_objs(e0), raw_objs(e1)
        if set(r0) != set(r1):
            bad.append(f'{fk}: object set differs')
        t0, t1 = textures(e0, fk), textures(e1, fk)
        inline = {(t0[t][0].assets_file.name, t0[t][0].path_id) for t in tg if t.split('|')[0] == fk
                  and get_raw(e0, *t0[t])[1][0] == 'inline'}
        nd = sum(1 for k in r0 if r0[k] != r1.get(k) and k not in inline)
        if nd:
            bad.append(f'{fk}: {nd} non-target objects raw-changed')
        rs0, rs1 = res_files(e0), res_files(e1)
        allowed = collections.defaultdict(list)
        for tid in tg:
            if tid.split('|')[0] == fk:
                w = get_raw(e0, *t0[tid])[1]
                if w[0] == 'resS':
                    allowed[w[1]].append((w[2], w[2] + w[3]))
        for k in rs0:
            a, b = np.frombuffer(rs0[k], np.uint8), np.frombuffer(rs1.get(k, b''), np.uint8)
            if a.size != b.size:
                bad.append(f'{fk}:{k} size changed')
                continue
            m = a != b
            for s, e in allowed.get(k, []):
                m[s:e] = False
            if m.any():
                bad.append(f'{fk}:{k} {int(m.sum())} bytes changed outside target ranges')
        for tid, png in tg.items():
            if tid.split('|')[0] != fk:
                continue
            (o0, d0), (o1, d1) = t0[tid], t1[tid]
            info = fmt_info(d0)
            fmt, s_fmt, bw, bh, sw, gobs, W, H = info
            nb = BLOCK_BYTES
            l0 = np.frombuffer(bytes(to_linear(get_raw(e0, o0, d0)[0], info)), np.uint8).reshape(-1, nb)
            l1 = np.frombuffer(bytes(to_linear(get_raw(e1, o1, d1)[0], info)), np.uint8).reshape(-1, nb)
            chb = (l0 != l1).any(axis=1)
            a0, a1 = decode(d0), decode(d1)
            new = np.asarray(Image.open(png).convert('RGBA'))
            h, w = a0.shape[:2]
            ed = np.zeros((H, W), bool)
            ed[:h, :w] = (a0 != new).any(axis=2)[::-1]
            eb = ed.reshape(H // bh, bh, W // bw, bw).any(axis=(1, 3)).reshape(-1)
            extra = int((chb[:eb.size] & ~eb).sum()) + int(chb[eb.size:].sum())
            em = np.repeat(np.repeat(eb.reshape(H // bh, W // bw), bh, 0), bw, 1)[:h, :w][::-1]
            out_diff = int((a0 != a1).any(axis=2)[~em].sum())
            if extra or out_diff:
                bad.append(f'{tid}: raw blocks changed outside edit set {extra} / decoded pixels changed outside {out_diff}')

            def pm(a):
                return a[:, :, :3].astype(float) * a[:, :, 3:4] / 255.0
            err = np.abs(pm(a1) - pm(new))[em]
            ref = np.abs(pm(a0) - pm(new))[em]
            stats.append(f'{tid}\tedit_blocks={int(eb.sum())}\traw_changed={int(chb.sum())}'
                         f'\tunchanged_edit_blocks={int((eb & ~chb[:eb.size]).sum())}\toutside_diff={out_diff}'
                         f'\tin_premul_mae={err.mean() if err.size else 0:.2f}'
                         f'\t(orig_vs_edit_mae={ref.mean() if ref.size else 0:.2f})')
            if (d0.m_Width, d0.m_Height, d0.m_TextureFormat, bytes(d0.m_PlatformBlob or b'')) != \
                    (d1.m_Width, d1.m_Height, d1.m_TextureFormat, bytes(d1.m_PlatformBlob or b'')):
                bad.append(f'{tid}: header changed')
            Image.fromarray(a1).save(os.path.join(C['TS'], C['TID'], safe(tid) + '.reloaded.png'))
    msg = f'image verify {C["TID"]} round={C["round"]} textures={len(tg)} bad={len(bad)}'
    os.makedirs(C['ART'], exist_ok=True)
    with open(os.path.join(C['ART'], 'image_verify.txt'), 'w', encoding='utf-8', newline='\n') as h:
        h.write(msg + '\n' + ''.join(x + '\n' for x in bad) + ''.join(x + '\n' for x in stats))
    print(msg)
    print('\n'.join(bad[:20]))
    return not bad


def noop():
    tg = targets()
    bad = []
    for fk in sorted({t.split('|')[0] for t in tg}):
        env, p = load(fk)
        tx = textures(env, fk)
        for tid in tg:
            if tid.split('|')[0] == fk:
                o, d = tx[tid]
                info = fmt_info(d)
                raw, where = get_raw(env, o, d)
                orig = decode(d)
                nl, ch = splice(to_linear(raw, info), orig, orig.copy(), info)
                if from_linear(to_linear(raw, info), info) != raw or bytes(nl) != bytes(to_linear(raw, info)) or ch:
                    bad.append(tid)
                put_raw(env, o, d, where, raw)
        data = env.file.save(packer='original')
        e0, e1 = UnityPy.load(p), UnityPy.load(data)
        same_obj = raw_objs(e0) == raw_objs(e1)
        same_res = res_files(e0) == res_files(e1)
        if not (same_obj and same_res):
            bad.append(f'{fk}: noop rewrite not raw-identical')
        print(f'noop {fk}: objects={len(raw_objs(e0))} raw_identical={same_obj} resS_identical={same_res}', flush=True)
    msg = f'image noop {C["TID"]} round={C["round"]} textures={len(tg)} bad={len(bad)} {bad}'
    os.makedirs(C['ART'], exist_ok=True)
    with open(os.path.join(C['ART'], 'image_noop.txt'), 'w', encoding='utf-8', newline='\n') as h:
        h.write(msg + '\n')
    print(msg)
    return not bad


# ---------------- selftest ----------------
def selftest():
    assert base_name('sactx-0-2048x1024-ASTC 4x4-UiAtlas_Home-1a2b3c4d') == 'UiAtlas_Home'
    assert base_name('adv_event_logo_01') == 'adv_event_logo_01'
    b = [((10, 20, 30), 2), ((255, 255, 255), 3)]
    assert parse_bands(fmt_bands(b)) == b and parse_bands('none') == [] and fmt_bands([]) == 'none'
    # row targets: primary / secondary / title-only rows
    r = dict(key='k', status='typeset', tex_id='u3d|a|T|8x8', box='1,2,3,4', also='u3d|a|T|8x8#2', tex_id_p2='cr|b|T|8x8')
    loc = {'k@u3d|a|T|8x8#2': (5, 6, 3, 4)}
    assert row_targets(r, loc, True) == [('u3d|a|T|8x8', (1, 2, 3, 4)), ('u3d|a|T|8x8#2', (5, 6, 3, 4))]
    assert row_targets(r, {}, False) == [('cr|b|T|8x8', None)]
    assert row_targets(dict(r, status='typeset_p1'), {}, False) == []
    assert row_targets(dict(r, status='typeset_p2'), {}, False) == [('cr|b|T|8x8', (1, 2, 3, 4))]
    # ring analysis: white fill inside a 2 px dark outline
    a = np.zeros((40, 60, 4), np.uint8)
    a[5:35, 5:55] = (20, 20, 20, 255)
    a[7:33, 7:53] = (250, 250, 250, 255)
    fill, bands = fit_bands(a, a[:, :, 3] > 0)
    assert fill == (250, 250, 250) and len(bands) == 1 and bands[0][0] == (20, 20, 20), (fill, bands)
    # splice on RGBA32 (4x1 px = 16-byte blocks): only blocks with edited pixels change, rest byte-exact
    w, h = 16, 8
    orig = np.random.RandomState(1).randint(0, 255, (h, w, 4)).astype(np.uint8)
    new = orig.copy()
    new[1, 13] = (1, 2, 3, 4)  # top-down row 1 -> storage row h-2, block x 13//4
    info = (None, 'RGBA32', 4, 1, False, 0, w, h)
    lin = bytearray(orig[::-1].tobytes())
    out, ch = splice(lin, orig, new, info, enc=lambda im, f: np.ascontiguousarray(im).tobytes())
    assert ch == [(h - 2, 3)], ch
    assert bytes(out) == new[::-1].tobytes()
    # 4x4 block layout with a fake 16-byte "codec" (block = its 16 alpha bytes): one block changed
    info4 = (None, 'ASTC_4x4', 4, 4, False, 0, w, h)

    def fake(im, f):
        hh, ww = im.shape[:2]
        return b''.join(im[y:y + 4, x:x + 4, 3].tobytes() for y in range(0, hh, 4) for x in range(0, ww, 4))
    lin4 = bytearray(fake(orig[::-1], None))
    out4, ch4 = splice(lin4, orig, new, info4, enc=fake)
    assert ch4 == [(1, 3)] and bytes(out4) == fake(new[::-1], None)
    assert sum(x != y for x, y in zip(out4, lin4)) <= 16
    # patch / logo modes
    cv = np.zeros((20, 20, 4), np.uint8)
    cv[5:15, 5:15] = (9, 9, 9, 255)
    lg = np.zeros((8, 8, 4), np.uint8)
    lg[2:6, 2:6] = (200, 0, 0, 255)
    assert paste_logo(cv[2:18, 2:18], lg) == 100 and (cv[5:15, 5:15, 0] == 200).all() and cv[:5].sum() == 0
    print('unity_image selftest OK')
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('cmd', choices=['list', 'dump', 'comps', 'locate', 'render', 'build', 'verify', 'noop', 'halo',
                                    'selftest'])
    ap.add_argument('args', nargs='*')
    ap.add_argument('-p', '--project')
    ap.add_argument('--round', default='r1')
    ap.add_argument('--base')
    ap.add_argument('--out')
    a = ap.parse_args(argv)
    if a.cmd == 'selftest':
        return selftest()
    if a.cmd == 'halo':
        halo_final(a.args[0], a.args[1], a.args[2], not (len(a.args) > 3 and a.args[3] == 'noglow'))
        return 0
    assert a.project, '-p <_work/TID> required'
    assert UnityPy is not None, 'UnityPy not importable (set GT_PYLIB)'
    setup(a.project, a.round)
    if a.cmd == 'list':
        env, _ = load(a.args[0])
        for k, (o, d) in sorted(textures(env, a.args[0]).items()):
            if len(a.args) < 2 or re.search(a.args[1], k):
                print(k, d.m_TextureFormat, o.path_id)
    elif a.cmd == 'dump':
        dump(a.args[0], a.args[1] if len(a.args) > 1 else '.')
    elif a.cmd == 'comps':
        comps(a.args[0], int(a.args[1]) if len(a.args) > 1 else 10)
    elif a.cmd == 'locate':
        locate()
    elif a.cmd == 'render':
        render()
    elif a.cmd == 'build':
        build(a.base, a.out)
    elif a.cmd == 'verify':
        return 0 if verify(a.base, a.out) else 1
    elif a.cmd == 'noop':
        return 0 if noop() else 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
