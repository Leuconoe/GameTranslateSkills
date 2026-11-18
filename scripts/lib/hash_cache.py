"""Shared SHA-256 cache keyed by absolute path + size + mtime (ns); same JSON file as scripts/lib/hash-cache.mjs.
File: $GT_HASH_CACHE, else <LOCALAPPDATA or ~/.cache>/game-translate/sha256-cache.json; GT_HASH_CACHE=off disables.
  from hash_cache import sha256      # lowercase hex
  python -I hash_cache.py <file>... | selftest
"""
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path


def cache_file():
    if os.environ.get('GT_HASH_CACHE'):
        return os.environ['GT_HASH_CACHE']
    base = os.environ.get('LOCALAPPDATA') or str(Path.home() / '.cache')
    return str(Path(base) / 'game-translate' / 'sha256-cache.json')


def _read(f):
    try:
        return json.loads(Path(f).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def key(p):
    st = os.stat(p)
    return f'{os.path.abspath(p)}|{st.st_size}|{st.st_mtime_ns}'


def _raw(p):
    with open(p, 'rb') as fh:
        return hashlib.file_digest(fh, 'sha256').hexdigest()


def sha256(p):
    f = cache_file()
    if f == 'off':
        return _raw(p)
    k = key(p)
    hit = _read(f).get(k)
    if hit:
        return hit
    h = _raw(p)
    try:
        c = _read(f)
        c[k] = h
        Path(f).parent.mkdir(parents=True, exist_ok=True)
        tmp = f'{f}.{os.getpid()}.tmp'
        Path(tmp).write_text(json.dumps(c), encoding='utf-8')
        os.replace(tmp, f)
    except OSError:
        pass  # best-effort cache
    return h


def selftest():
    with tempfile.TemporaryDirectory() as d:
        os.environ['GT_HASH_CACHE'] = os.path.join(d, 'c.json')
        p = os.path.join(d, 'a.bin')
        Path(p).write_bytes(b'abc')
        h = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
        assert sha256(p) == h and _read(cache_file())[key(p)] == h
        c = _read(cache_file())
        c[key(p)] = 'f' * 64  # a hit must come from the cache
        Path(cache_file()).write_text(json.dumps(c), encoding='utf-8')
        assert sha256(p) == 'f' * 64
        Path(p).write_bytes(b'abcd')  # size change -> miss -> re-hash
        assert sha256(p) == hashlib.sha256(b'abcd').hexdigest()
    print('selftest ok')


if __name__ == '__main__':
    if sys.argv[1:] == ['selftest']:
        selftest()
    else:
        for a in sys.argv[1:]:
            print(sha256(a), a)
