# python test_lzlr.py — synthetic round trips for lzlr.py (no game data).
import os
import random

import lzlr


def demo():
    rnd = random.Random(7)
    cases = [b'', b'\0' * 4, b'\0' * 4096, bytes(range(256)) * 9,
             bytes(rnd.getrandbits(8) for _ in range(4000)),
             (b'ABCD' + b'\x01\x02\x03\x04' * 3) * 300 + os.urandom(64)]
    for raw in cases:
        c = lzlr.compress(raw)
        assert c[:4] == b'LZLR'
        assert lzlr.decompress(c)[0] == raw, len(raw)
        assert lzlr.compress(lzlr.decompress(c)[0]) == c  # deterministic
    # dist 1 is never emitted (game encoder uses 2..1023): a single repeated word must use dist 2 or literals
    t = []
    lzlr.decompress(lzlr.compress(b'\x11\x22\x33\x44' * 50), t)
    assert all(x[0] == 'L' or x[2] >= 2 for x in t), t
    print('lzlr ok')


if __name__ == '__main__':
    demo()
