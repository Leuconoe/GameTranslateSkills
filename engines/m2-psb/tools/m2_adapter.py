#!/usr/bin/env python3
"""m2_adapter.py - bulk_tool adapter for M2 Switch text (scn PSB, config text.psb, Squirrel2 .nut.m).

  python -I bulk_tool.py extract|inject|verify|roundtrip -p <_work/TID> --adapter m2_adapter.py [--out DIR]
  python -I m2_adapter.py selftest

Sources (archives under SRC_REL; key via m2arc.load_key: env M2_KEY_FILE or <project>/90_tools/environment/m2_key.txt):
  config/text.psb.m, every scenario + script entry, and patch entries under scenario/ or script/.
Rows (source_file = '<arch>/<keyname>'; notes kind first):
  scn         s<i>/t<j> dlg (texts[j][1][0][1]; spk = speaker|display), s<i>/title, s<i>/sel<k>, s<i>/selinfo
  scenelist   list<i>/title slist_title, list<i>/sel<k> slist_sel
  text.psb.m  <key> systext (value[0]; extract keeps rows with Japanese, read never filters)
  .nut.m      <fn path>:<fn name>#<lit idx> nut - only literals listed in <project>/30_translation/text/NUT_ALLOW.txt
              (one manifest-escaped literal per line). Squirrel literals are often lookup keys; no list = no nut rows.
  *speaker    <name> speaker: written to texts[j][1][0][0] (display name) where it is None, only when value != source;
              extract emits it only for speakers with such a line (an older-manifest row without one reads back as the id)
  *disp       <display> disp: replaces texts[j][1][0][0] values
Manifest cell form: '\\' -> '\\\\', real LF -> '\\n', TAB -> '\\t'. So scn dialog keeps the engine escape as '\\\\n'
(3 chars) and systext/nut real newlines read as '\\n' (2 chars); each row keeps its own form (bulk_tool BR).
Dialog count field texts[j][1][0][2] (= length without engine '\\n') is updated when it matched the source.
This is the key scheme of the Summer title's m2text.py; the Kanojo title's gtb_text.py manifest (scenario/* speaker:,
config/mapmove, hard-coded script literal list) is title-specific - re-extract with this adapter for a new title.
Inject re-serializes every entry that has a row (identity values included) so roundtrip exercises the full write path.
"""
import re
import struct
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import m2arc  # noqa: E402
import psb  # noqa: E402

SRC_REL = '10_extract/romfs_original'
TEXT_ARCHS = ('config', 'scenario', 'script', 'patch')
JP = re.compile(r'[぀-ヿ一-鿿]')


def esc(s):
    assert '\r' not in s, s
    return s.replace('\\', '\\\\').replace('\n', '\\n').replace('\t', '\\t')


def unesc(s):
    return re.sub(r'\\(.)', lambda m: {'n': '\n', 't': '\t', '\\': '\\'}[m.group(1)], s)


def vis_len(s):
    return len(s.replace('\\n', ''))


# ---------------- Squirrel 2.x compiled closure (FAFA 'RIQS', char=1, SQInteger=4); write(parse(x)) == x
OT_NULL, OT_INTEGER, OT_FLOAT, OT_BOOL, OT_STRING = 0x01000001, 0x05000002, 0x05000004, 0x01000008, 0x08000010
PART, TAIL, HEAD = b'TRAP', b'LIAT', b'\xfa\xfaRIQS\x01\x00\x00\x00'


class _R:
    def __init__(self, b):
        self.b, self.p = b, 0

    def take(self, n):
        v = self.b[self.p:self.p + n]
        assert len(v) == n, 'eof'
        self.p += n
        return v

    def tag(self, t):
        assert self.take(4) == t, f'tag {t} @ {self.p - 4:#x}'

    def obj(self):
        t = struct.unpack('<I', self.take(4))[0]
        if t == OT_STRING:
            return ('s', self.take(struct.unpack('<I', self.take(4))[0]))
        if t in (OT_INTEGER, OT_FLOAT, OT_BOOL):
            return (t, self.take(4))
        if t == OT_NULL:
            return (t, b'')
        raise ValueError(f'object type {t:#x} @ {self.p - 4:#x}')


def _wobj(o):
    return struct.pack('<II', OT_STRING, len(o[1])) + o[1] if o[0] == 's' else struct.pack('<I', o[0]) + o[1]


def _read_func(r):
    f = {}
    r.tag(PART)
    f['src'], f['name'] = r.obj(), r.obj()
    r.tag(PART)
    f['cnt'] = nlit, npar, nout, nloc, nline, ndef, ninst, nfun = struct.unpack('<8I', r.take(32))
    for k, n, rd in (('lits', nlit, r.obj), ('pars', npar, r.obj), ('outs', nout, lambda: (r.take(4), r.obj(), r.obj())),
                     ('locs', nloc, lambda: (r.obj(), r.take(12)))):
        r.tag(PART)
        f[k] = [rd() for _ in range(n)]
    for k, n in (('lines', 8 * nline), ('defs', 4 * ndef), ('inst', 8 * ninst)):
        r.tag(PART)
        f[k] = r.take(n)
    r.tag(PART)
    f['funcs'] = [_read_func(r) for _ in range(nfun)]
    f['tail'] = r.take(6)  # stacksize u32 + bgenerator + varparams (observed layout)
    return f


def _write_func(f):
    o = bytearray(PART + _wobj(f['src']) + _wobj(f['name']) + PART + struct.pack('<8I', *f['cnt']) + PART)
    o += b''.join(_wobj(x) for x in f['lits']) + PART
    o += b''.join(_wobj(x) for x in f['pars']) + PART
    o += b''.join(t + _wobj(a) + _wobj(b) for t, a, b in f['outs']) + PART
    o += b''.join(_wobj(a) + b for a, b in f['locs']) + PART
    o += f['lines'] + PART + f['defs'] + PART + f['inst'] + PART
    return bytes(o + b''.join(_write_func(x) for x in f['funcs']) + f['tail'])


def nut_parse(b):
    assert b[:10] == HEAD, 'not squirrel2 char=1 closure'
    r = _R(b)
    r.p = 10
    f = _read_func(r)
    r.tag(TAIL)
    assert r.p == len(b), 'trailing bytes'
    return f


def nut_write(f):
    return HEAD + _write_func(f) + TAIL


def nut_literals(f, path='0'):
    """yield (key, func, index) per string literal; key = <child-index path>:<func name>#<literal index>"""
    name = f['name'][1].decode('utf-8', 'surrogateescape') if f['name'][0] == 's' else '?'
    for i, x in enumerate(f['lits']):
        if x[0] == 's':
            yield f'{path}:{name}#{i}', f, i
    for ci, x in enumerate(f['funcs']):
        yield from nut_literals(x, f'{path}/{ci}')


# ---------------- containers
def text_items(A):
    for it in A.items:
        n, k = it[0], it[1]
        if (A.arch == 'config' and k == 'text.psb.m') or A.arch in ('scenario', 'script') or \
                (A.arch == 'patch' and n.split('/')[0] in ('scenario', 'script')):
            yield it


def archives(roots, key):
    """{arch: Archive} from the first root holding <arch>_info.psb.m"""
    out = {}
    for a in TEXT_ARCHS:
        r = next((Path(r) for r in roots if (Path(r) / f'{a}_info.psb.m').exists()), None)
        if r:
            out[a] = m2arc.Archive(r, a, key)
    return out


def values(keyname, raw):
    """yield (source_key, kind, raw value, speaker) for every text slot of one entry - no language filter"""
    if keyname.endswith('.nut.m'):
        for k, fn, i in nut_literals(nut_parse(raw)):
            yield k, 'nut', fn['lits'][i][1].decode('utf-8', 'surrogateescape'), ''
        return
    root = psb.PSB(raw).root()
    if not isinstance(root, dict):
        return
    if keyname == 'text.psb.m':
        for k, v in root.items():
            if isinstance(v, list) and v and isinstance(v[0], str):
                yield k, 'systext', v[0], ''
        return
    for i, e in enumerate(root.get('list') or [] if keyname.startswith('scenelist.') else []):
        if e.get('title'):
            yield f'list{i}/title', 'slist_title', e['title'], ''
        for j, s in enumerate(e.get('selects') or []):
            if s.get('text'):
                yield f'list{i}/sel{j}', 'slist_sel', s['text'], ''
    for si, sc in enumerate(root.get('scenes') or []):
        if sc.get('title'):
            yield f's{si}/title', 'title', sc['title'], ''
        for ti, t in enumerate(sc.get('texts') or []):
            L = t[1][0]
            if L[1]:
                yield f's{si}/t{ti}', 'dlg', L[1], (t[0] or '') + ('|' + L[0] if L[0] else '')
        for j, s in enumerate(sc.get('selects') or []):
            if s.get('text'):
                yield f's{si}/sel{j}', 'sel', s['text'], ''
        inf = sc.get('selectInfo')
        if isinstance(inf, dict) and inf.get('text'):
            yield f's{si}/selinfo', 'selinfo', inf['text'], inf.get('name') or ''


def speakers(raw):
    """[(speaker, display)] per dialog line, in order"""
    root = psb.PSB(raw).root()
    return [(t[0], t[1][0][0]) for sc in (root.get('scenes') or [] if isinstance(root, dict) else [])
            for t in sc.get('texts') or []]


def apply(keyname, raw, vals, spk, disp):
    """vals {source_key: raw text}; spk/disp {name: display}; -> new raw bytes"""
    if keyname.endswith('.nut.m'):
        t = nut_parse(raw)
        for k, fn, i in nut_literals(t):
            if k in vals:
                fn['lits'][i] = ('s', vals[k].encode('utf-8', 'surrogateescape'))
        return nut_write(t)
    p = psb.PSB(raw)
    root = p.root()
    if not isinstance(root, dict):
        return raw
    if keyname == 'text.psb.m':
        for k, v in root.items():
            if k in vals:
                v[0] = vals[k]
    for i, e in enumerate(root.get('list') or [] if keyname.startswith('scenelist.') else []):
        if f'list{i}/title' in vals:
            e['title'] = vals[f'list{i}/title']
        for j, s in enumerate(e.get('selects') or []):
            if f'list{i}/sel{j}' in vals:
                s['text'] = vals[f'list{i}/sel{j}']
    for si, sc in enumerate(root.get('scenes') or []):
        if f's{si}/title' in vals:
            sc['title'] = vals[f's{si}/title']
        for ti, t in enumerate(sc.get('texts') or []):
            L = t[1][0]
            if f's{si}/t{ti}' in vals:
                new = vals[f's{si}/t{ti}']
                if len(L) > 2 and isinstance(L[2], int) and L[2] == vis_len(L[1]):
                    L[2] = vis_len(new)
                L[1] = new
            if L[0] is None and t[0] in spk:
                L[0] = spk[t[0]]
            elif L[0] is not None and L[0] in disp:
                L[0] = disp[L[0]]
        for j, s in enumerate(sc.get('selects') or []):
            if f's{si}/sel{j}' in vals:
                s['text'] = vals[f's{si}/sel{j}']
        inf = sc.get('selectInfo')
        if isinstance(inf, dict) and f's{si}/selinfo' in vals:
            inf['text'] = vals[f's{si}/selinfo']
    return psb.dump(root, p.chunks, p.version, p.ext_chunks, p.names_section())


# ---------------- adapter interface
def extract(src_root):
    key = m2arc.load_key(None, src_root)
    allow_f = Path(src_root).resolve().parents[1] / '30_translation' / 'text' / 'NUT_ALLOW.txt'
    allow = {unesc(x) for x in allow_f.read_text(encoding='utf-8-sig').split('\n') if x} if allow_f.exists() else set()
    spk, disp = {}, {}
    for a, A in archives([src_root], key).items():
        for it in text_items(A):
            raw = A.raw(it)
            sf = f'{a}/{it[1]}'
            for k, kind, v, extra in values(it[1], raw):
                if (kind == 'nut' and v not in allow) or (kind == 'systext' and not JP.search(v)):
                    continue
                yield {'source_file': sf, 'source_key': k, 'ja': esc(v), 'notes': kind, 'speaker': esc(extra)}
            if it[1].endswith('.scn.m'):
                for n, d in speakers(raw):
                    if d is not None:
                        disp[d] = disp.get(d, 0) + 1
                    elif n is not None:  # speaker row only where it takes effect (display slot empty)
                        spk[n] = spk.get(n, 0) + 1
    for sf, m in (('*speaker', spk), ('*disp', disp)):
        for n, c in sorted(m.items(), key=lambda x: -x[1]):
            yield {'source_file': sf, 'source_key': esc(n), 'ja': esc(n), 'notes': f'{sf[1:]};count={c}'}


def _maps(rows):
    vals, spk, disp = {}, {}, {}
    for r in rows:
        if r['source_file'] in ('*speaker', '*disp'):
            if r['value'] != r['ja']:
                (spk if r['source_file'] == '*speaker' else disp)[unesc(r['source_key'])] = unesc(r['value'])
        else:
            vals.setdefault(r['source_file'], {})[r['source_key']] = unesc(r['value'])
    return vals, spk, disp


def inject(rows, src_root, out_root):
    key = m2arc.load_key(None, src_root)
    vals, spk, disp = _maps(rows)
    written = []
    for a, A in archives([src_root], key).items():
        new = {}
        for it in text_items(A):
            sf = f'{a}/{it[1]}'
            if sf in vals or (it[1].endswith('.scn.m') and (spk or disp)):
                raw = A.raw(it)
                nr = apply(it[1], raw, vals.get(sf, {}), spk, disp)
                if sf in vals or nr != raw:
                    new[it[1]] = nr
        if new:
            written += A.write(out_root, new)
    return written


def read(roots, rows):
    key = m2arc.load_key(None, roots[-1])
    arcs, cache = archives(roots, key), {}

    def entry(sf):
        if sf not in cache:
            a, k = sf.split('/', 1)
            A = arcs.get(a)
            it = A.by_key.get(k) if A else None
            cache[sf] = {sk: esc(v) for sk, _, v, _ in values(k, A.raw(it))} if it else {}
        return cache[sf]
    named, ids = {}, {}
    if any(r['source_file'] in ('*speaker', '*disp') for r in rows):  # value at every line the source maps the key to
        src = archives([roots[-1]], key)
        for a, A in arcs.items():
            for it in text_items(A):
                if it[1].endswith('.scn.m'):
                    for (n0, d0), (n1, d1) in zip(speakers(src[a].raw(src[a].by_key[it[1]])), speakers(A.raw(it))):
                        if n0 is not None:  # speaker id itself (never rewritten)
                            ids.setdefault(('*speaker', esc(n0)), set()).add(esc(n1))
                        if n0 is not None or d0 is not None:
                            k = ('*speaker', esc(n0)) if d0 is None else ('*disp', esc(d0))
                            named.setdefault(k, set()).add(esc(d1 if d1 is not None else n1))
    out = []
    for r in rows:
        if r['source_file'] in ('*speaker', '*disp'):
            k = (r['source_file'], r['source_key'])  # speaker never shown via an empty display slot: its id (dead row)
            got = named.get(k) or ids.get(k, set())
            out.append(next(iter(got)) if len(got) == 1 else f'<{len(got)} values>')
        else:
            out.append(entry(r['source_file']).get(r['source_key']))
    return out


# ---------------- selftest (synthetic project, no title data)
def _nut_fixture(lits):
    f = {'src': ('s', b'x.nut'), 'name': ('s', b'main'), 'cnt': (len(lits), 0, 0, 0, 0, 0, 0, 1), 'pars': [], 'outs': [],
         'locs': [], 'lines': b'', 'defs': b'', 'inst': b'', 'tail': b'\0' * 6,
         'lits': [('s', x.encode()) for x in lits] + [(OT_INTEGER, b'\1\0\0\0')]}
    f['cnt'] = (len(f['lits']),) + f['cnt'][1:]
    f['funcs'] = [dict(f, name=('s', b'sub'), funcs=[], cnt=(len(f['lits']), 0, 0, 0, 0, 0, 0, 0))]
    return nut_write(f)


def selftest():
    key = 'synthetic-key'
    scn = {'scenes': [{'title': '第一話', 'texts': [
        ['風太郎', [[None, 'あ\\n　い', 3]], 1], ['一花', [['？？？', 'う', 1]], 2], ['風太郎', [[None, 'え', 1]], 3]],
        'selects': [{'text': '行く'}], 'selectInfo': {'name': '一花', 'text': 'どうする？'}}]}
    with tempfile.TemporaryDirectory() as d:
        prj = Path(d) / 'prj'
        src, env = prj / SRC_REL, prj / '90_tools' / 'environment'
        src.mkdir(parents=True)
        env.mkdir(parents=True)
        (env / 'm2_key.txt').write_text(key, encoding='utf-8')
        (prj / '30_translation' / 'text').mkdir(parents=True)
        (prj / '30_translation' / 'text' / 'NUT_ALLOW.txt').write_text('朝\\n昼\n', encoding='utf-8')

        def make(arch, suf, ents):
            body, fi = bytearray(), {}
            for n, data in ents.items():
                b = n.rsplit('/', 1)[-1]
                blob = m2arc.mdf_encode(data, key + (b if b.endswith('.m') else b + suf))
                fi[n] = [len(body), len(blob)]
                body += blob
            (src / f'{arch}_body.bin').write_bytes(bytes(body))
            info = psb.dump({'expire_suffix_list': [suf], 'file_info': fi})
            (src / f'{arch}_info.psb.m').write_bytes(m2arc.mdf_encode(info, key + f'{arch}_info.psb.m'))
        make('config', '.psb.m', {'text': psb.dump({'A': ['開く\n閉じる', 'Open'], 'B': ['OK', 'OK']}),
                                  'init': psb.dump({'x': 1})})
        make('scenario', '.scn.m', {'ca01.txt': psb.dump(scn),
                                    'scenelist.txt': psb.dump({'list': [{'title': '第一話', 'selects': [{'text': '行く'}]}]})})
        make('script', '.nut.m', {'main': _nut_fixture(['朝\n昼', 'chara_id'])})
        make('patch', '.psb.m', {'scenario/ca02.txt.scn.m': psb.dump(scn)})
        rows = list(extract(src))
        by = {(r['source_file'], r['source_key']): r for r in rows}
        assert by[('scenario/ca01.txt.scn.m', 's0/t0')]['ja'] == 'あ\\\\n　い'  # engine escape -> 3-char form
        assert by[('config/text.psb.m', 'A')]['ja'] == '開く\\n閉じる'  # real LF -> 2-char form
        assert by[('script/main.nut.m', '0:main#0')]['ja'] == '朝\\n昼' and ('script/main.nut.m', '0:main#1') not in by
        assert ('config/text.psb.m', 'B') not in by and ('patch/ca02.txt.scn.m', 's0/selinfo') in by
        assert by[('*speaker', '風太郎')]['notes'] == 'speaker;count=4' and ('*disp', '？？？') in by
        assert not any(re.search(r'[\t\r\n]', r['ja']) for r in rows) and ('*speaker', '一花') not in by
        rows.append({'source_file': '*speaker', 'source_key': '一花', 'ja': '一花'})  # older-manifest dead speaker row
        for r in rows:
            r['value'] = r['ja']
        files = inject(rows, src, Path(d) / 'rt')
        assert sorted(files) == sorted(f'{a}_{x}' for a in TEXT_ARCHS for x in ('body.bin', 'info.psb.m')), files
        assert read([Path(d) / 'rt', src], rows) == [r['ja'] for r in rows]
        ko = {'あ\\\\n　い': '가\\\\n　나다', '開く\\n閉じる': '열기\\n닫기', '風太郎': '후타로', '？？？': '???',
              '朝\\n昼': '아침\\n점심', '第一話': '제1화'}
        for r in rows:
            r['value'] = ko.get(r['ja'], r['ja'])
        inject(rows, src, Path(d) / 'ko')
        got = read([Path(d) / 'ko', src], rows)
        assert got == [r['value'] for r in rows], [(r['ja'], g) for r, g in zip(rows, got) if g != r['value']]
        A = m2arc.Archive(Path(d) / 'ko', 'scenario', key)
        t = psb.PSB(A.raw(A.by_key['ca01.txt.scn.m'])).root()['scenes'][0]['texts']
        assert t[0][1][0] == ['후타로', '가\\n　나다', 4] and t[1][1][0][0] == '???' and t[0][0] == '風太郎'
        assert read([Path(d) / 'nothing', src], rows[:1]) == [rows[0]['ja']]  # overlay missing -> source wins
    print('selftest ok')


if __name__ == '__main__':
    if sys.argv[1:] == ['selftest']:
        selftest()
    else:
        sys.exit(__doc__)
