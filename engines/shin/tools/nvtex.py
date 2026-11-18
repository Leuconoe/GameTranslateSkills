# nvtex.py — Shin-engine CROSS '.tex' pages (NVN texture, Tegra X1 block-linear) inside TXPL pools or standalone.
#
# '.tex' header (256 B, u32 LE): +4 nvn format (37 = RGBA8, 77 = BC7 unorm), +8 ?, +12 width, +16 height,
#   +20 depth, +24 mip levels, +28 data offset (256), +32 data size; data = mip chain, each level block-linear.
# TXPL pool: 'TXPL' u32 table_off u32 table_size, (u32 page_off, u32 page_size)* ending with size 0; pages are '.tex'.
# BC7 needs texture2ddecoder (decode) and etcpak (encode); both live in E:/NSW/_tools/python.
#
#   python nvtex.py png <file> <out_prefix>     page/mip-0 PNGs (decodes LZLR first when needed)
#   python nvtex.py test <file...>              swizzle(deswizzle(x)) == x for mip 0 of every page
import struct
import sys

import numpy as np

FMT = {37: ('rgba8', 1, 4), 77: ('bc7', 4, 16)}  # name, block dim, bytes per block


def _gob_order(wb, hb, bpb, bh):
    """Linear block index (y*wb + x) for each swizzled block slot, Tegra X1 block-linear, GOB = 64 B x 8 rows."""
    x = np.arange(wb)[None, :]
    y = np.arange(hb)[:, None]
    xb = x * bpb
    gobs_w = -(-wb * bpb // 64)
    addr = ((y // (8 * bh)) * 512 * bh * gobs_w + (xb // 64) * 512 * bh + (y % (8 * bh) // 8) * 512
            + (xb % 64) // 32 * 256 + (y % 8) // 2 * 64 + (xb % 32) // 16 * 32 + (y % 2) * 16 + xb % 16)
    return addr  # byte address of block (y, x)


def block_height(hb):
    bh = 1
    while bh < 16 and bh * 8 < hb:
        bh *= 2
    return bh


def _level(hdr):
    fmt, w, h = hdr['fmt'], hdr['w'], hdr['h']
    _, bd, bpb = FMT[fmt]
    wb, hb = -(-w // bd), -(-h // bd)
    bh = block_height(hb)
    gw = -(-wb * bpb // 64) * 64 // bpb  # blocks per row padded to GOB width
    gh = -(-hb // (8 * bh)) * 8 * bh
    return wb, hb, bpb, bh, gw, gh


def header(t):
    assert t[:4] == b'.tex', t[:4]
    fmt, _, w, h, d, mips, off, size = struct.unpack_from('<8I', t, 4)
    return dict(fmt=fmt, w=w, h=h, mips=mips, off=off, size=size)


def blocks(t):
    """Mip-0 blocks as (hb, wb, bpb) uint8 array, plus the byte addresses used (for writing back)."""
    hd = header(t)
    wb, hb, bpb, bh, gw, gh = _level(hd)
    addr = _gob_order(wb, hb, bpb, bh) + hd['off']
    idx = addr[..., None] + np.arange(bpb)
    return np.frombuffer(t, np.uint8)[idx], idx


def to_rgba(t):
    hd = header(t)
    name, bd, bpb = FMT[hd['fmt']]
    bl, _ = blocks(t)
    if name == 'rgba8':
        return bl.reshape(hd['h'], hd['w'], 4).copy()
    import texture2ddecoder
    hb, wb = bl.shape[:2]
    raw = texture2ddecoder.decode_bc7(bl.tobytes(), wb * 4, hb * 4)  # BGRA
    a = np.frombuffer(raw, np.uint8).reshape(hb * 4, wb * 4, 4)[..., [2, 1, 0, 3]]
    return a[:hd['h'], :hd['w']].copy()


def put_rgba(t, rgba, orig=None):
    """New page bytes with mip 0 replaced. BC7: only 4x4 blocks whose pixels differ from `orig` are re-encoded;
    every other block keeps its original bytes. Lower mips (if any) are left untouched."""
    hd = header(t)
    name, bd, bpb = FMT[hd['fmt']]
    out = bytearray(t)
    bl, idx = blocks(t)
    hb, wb = bl.shape[:2]
    if name == 'rgba8':
        new = np.ascontiguousarray(rgba, np.uint8).reshape(hb, wb, 4)
        flat = np.frombuffer(out, np.uint8).copy()
        flat[idx] = new
        return bytes(flat.tobytes())
    import etcpak
    if orig is None:
        orig = to_rgba(t)
    diff = (rgba != orig).any(2)
    pad = np.zeros((hb * 4, wb * 4), bool)
    pad[:diff.shape[0], :diff.shape[1]] = diff
    ch = pad.reshape(hb, 4, wb, 4).any((1, 3))
    if not ch.any():
        return bytes(t)
    full = np.zeros((hb * 4, wb * 4, 4), np.uint8)
    full[:rgba.shape[0], :rgba.shape[1]] = rgba
    ys, xs = np.nonzero(ch)
    tiles = full.reshape(hb, 4, wb, 4, 4).transpose(0, 2, 1, 3, 4)[ys, xs]  # (n, 4, 4, 4) RGBA
    # etcpak expects BGRA rows; encode the changed blocks as one n*4 x 4 strip
    strip = np.ascontiguousarray(tiles[..., [2, 1, 0, 3]].reshape(-1, 4, 4))  # (n*4 rows, 4 px, 4)
    enc = np.frombuffer(etcpak.compress_bc7(strip.tobytes(), 4, strip.shape[0]), np.uint8).reshape(-1, 16)
    flat = np.frombuffer(out, np.uint8).copy()
    flat[idx[ys, xs]] = enc
    return bytes(flat.tobytes())


def pool_pages(b):
    """[(offset, size)] of '.tex' pages: TXPL pool or a single standalone page."""
    if b[:4] != b'TXPL':
        return [(0, len(b))]
    res, k = [], 0
    while True:
        off, size = struct.unpack_from('<2I', b, 0x0c + 8 * k)
        if size == 0:
            return res
        res.append((off, size))
        k += 1


def _load(path):
    b = open(path, 'rb').read()
    if b[:4] == b'LZLR':
        import lzlr
        b = lzlr.decompress(b)[0]
    return b


def main():
    cmd = sys.argv[1]
    if cmd == 'png':
        from PIL import Image
        b = _load(sys.argv[2])
        for i, (o, s) in enumerate(pool_pages(b)):
            Image.fromarray(to_rgba(b[o:o + s]), 'RGBA').save(f'{sys.argv[3]}_{i}.png')
    elif cmd == 'test':
        bad = 0
        for f in sys.argv[2:]:
            b = _load(f)
            for i, (o, s) in enumerate(pool_pages(b)):
                t = b[o:o + s]
                rgba = to_rgba(t)
                same = put_rgba(t, rgba, rgba) == t
                bad += not same
                print(f'{f}\tpage={i}\t{header(t)["w"]}x{header(t)["h"]}\tfmt={header(t)["fmt"]}\tnoop_identical={same}')
        sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
