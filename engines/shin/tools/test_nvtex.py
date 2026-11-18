# python test_nvtex.py — synthetic RGBA8 '.tex' page: swizzle/deswizzle round trip (no game data, no BC7 deps).
import struct

import numpy as np

import nvtex


def demo():
    for w, h in ((128, 128), (64, 256), (512, 64)):
        hd = struct.pack('<4s8I', b'.tex', 37, 1, w, h, 1, 1, 256, w * h * 4).ljust(256, b'\0')
        rnd = np.random.default_rng(w + h).integers(0, 256, (h, w, 4), np.uint8)
        t = nvtex.put_rgba(hd + bytes(w * h * 4), rnd)
        assert len(t) == 256 + w * h * 4
        assert (nvtex.to_rgba(t) == rnd).all(), (w, h)
        assert nvtex.put_rgba(t, rnd) == t
        _, idx = nvtex.blocks(t)
        assert len(np.unique(idx)) == idx.size  # every texel maps to a distinct byte
    print('nvtex ok')


if __name__ == '__main__':
    demo()
