"""ucommon.py - shared helpers for the Unity tools in this folder (no CLI).

UnityPy is imported from $GT_PYLIB (default E:\\NSW\\_tools\\python); TypeTreeGeneratorAPI from $GT_TTGEN.
UnityPy is None when the import fails, so pure-logic selftests still run.
"""
import os
import re
import sys
from pathlib import Path

PYLIB = os.environ.get('GT_PYLIB', r'E:\NSW\_tools\python')
TTGEN = os.environ.get('GT_TTGEN', r'E:\NSW\_tools\TypeTreeGeneratorAPI-0.0.10\site')
for _p in (TTGEN, PYLIB):
    if _p not in sys.path:
        sys.path.insert(0, _p)
try:
    import UnityPy
except ImportError:
    UnityPy = None

JP = re.compile(r'[぀-ヿ一-鿿ｦ-ﾟ]')
SA = 'Data/StreamingAssets/'
U3D_REL = 'Data/data.unity3d'
_GEN = {}


def dummy_dir(rom):
    """Il2CppDumper DummyDll for typetree-stripped data.unity3d: $GT_UNITY_DUMMYDLL, else
    <rom>/../decompiled/*/out/DummyDll (rom = 10_extract/romfs_original). None if absent."""
    if os.environ.get('GT_UNITY_DUMMYDLL'):
        return Path(os.environ['GT_UNITY_DUMMYDLL'])
    hits = sorted(Path(rom).parent.glob('decompiled/*/out/DummyDll'))
    return hits[-1] if hits else None


def load_env(src, rel='', rom=None):
    """UnityPy env; data.unity3d gets a TypeTreeGenerator over the DummyDll (when one exists)."""
    env = UnityPy.load(str(src) if isinstance(src, Path) else src)
    d = dummy_dir(rom) if rel == U3D_REL and rom else None
    if d:
        ver = env.objects[0].assets_file.unity_version
        if ver not in _GEN:
            from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator
            _GEN[ver] = TypeTreeGenerator(ver)
            _GEN[ver].load_local_dll_folder(str(d))
        env.typetree_generator = _GEN[ver]
    return env


def w_atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp')
    if isinstance(data, str):
        with open(tmp, 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(data)
    else:
        tmp.write_bytes(data)
    os.replace(tmp, path)


def overlay_root(out):
    """Write root of an overlay build: <out>/romfs unless <out> already is a `romfs` dir. Every stage reads a previous
    build as <base>/romfs/<rel>; an overlay written straight into <out> would be skipped and the original read instead."""
    out = Path(out)
    return out if out.name.lower() == 'romfs' else out / 'romfs'


def base_root(base):
    """Validate an input build root (--base): it must hold romfs/, else later stages silently read romfs_original."""
    if base and not (Path(base) / 'romfs').is_dir():
        sys.exit(f'refuse: input build {base} has no romfs/ (pass the build root that contains romfs/, not romfs/ '
                 f'itself; an overlay written without romfs/ must be rebuilt)')
    return base


def tget(t, path):
    for k in path:
        t = t[int(k)] if isinstance(t, list) else t[k]
    return t


def tset(t, path, v):
    t = tget(t, path[:-1])
    if isinstance(t, list):
        t[int(path[-1])] = v
    else:
        t[path[-1]] = v


def esc(s):
    """Manifest cell form of a source holding real LF/CR/TAB (rows flagged `esc` in notes)."""
    assert '\\' not in s or not re.search(r'[\n\r\t]', s), repr(s[:60])
    return s.replace('\n', '\\n').replace('\r', '\\r').replace('\t', '\\t')


def unesc(s):
    return s.replace('\\n', '\n').replace('\\r', '\r').replace('\\t', '\t')


def has_esc(r):
    return 'esc' in r.get('notes', '').split(';')


def read_manifest(path):
    lines = Path(path).read_bytes().decode('utf-8-sig').split('\n')
    hdr = lines[0].rstrip('\r').split('\t')
    return [dict(zip(hdr, ln.rstrip('\r').split('\t'))) for ln in lines[1:] if ln.strip()]
