"""unity_adapter.py - bulk_tool adapter for Unity (IL2CPP) + Utage titles. Root = romfs (SRC_REL).

  python -I scripts/bulk/bulk_tool.py extract|inject|verify|roundtrip -p <_work/TID> --adapter <this file> ...
  python -I unity_adapter.py inject|verify --manifest M --src <romfs> --out DIR   any manifest (e.g. SUPP_MANIFEST.tsv);
                                                                                 value = target_ko or ja
  python -I unity_adapter.py selftest

extract() = utage_text.walk (master TSV + scenario); supplement classes come from supp_text.py extract.
Row address forms accepted by inject/read (existing manifests work as-is; source_file may omit Data/StreamingAssets/):
  TSV       source_key L<line 1-based>:C<col>                  | id T|<file.tsv>|<line 0-based>|<col>
  scenario  source_key <path_id>|(import|setting)<g>:r<r>:c<c> | id S|<bundle>|<path_id>|<g>|<r>|<c>  (importGridList)
  shared    id G|<sheet>|<col>|<ja>: every settingList cell (sheet, col) == ja in every scenario bundle
  supp      class/notes ui_prefab u3d_ui textasset u3d_i2, source_key <assets>|<path_id>|<field | L<l>:C<c> | term:<t>>
  literal   source_key lit:<i> (global-metadata.dat); a changed value is injected only when its id is `safe` in the
            TSV named by $GT_UNITY_LITERAL_SAFETY, else left as source and counted
Anything else is skipped and counted; read() returns None for it. Values are written and read back exactly in manifest
form (TSV/scenario keep the literal 2-char `\\n`; supplement rows flagged `esc` hold real LF/CR/TAB in the source).
Every write asserts the source cell equals the row's ja.
"""
import collections
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ucommon import SA, esc, has_esc, load_env, read_manifest, tget, tset, unesc, w_atomic  # noqa: E402
import meta_literals as ML  # noqa: E402
import supp_text as ST  # noqa: E402
import utage_text as UT  # noqa: E402

SRC_REL = '10_extract/romfs_original'
TSV_KEY = re.compile(r'L(\d+):C(\d+)')
SCN_KEY = re.compile(r'(-?\d+)\|(import|setting)(\d+):r(\d+):c(\d+)')


def extract(src_root):
    return UT.walk(Path(src_root))


def cls_of(r):
    return r.get('class') or r.get('notes', '').split(';')[0]


def addr(r):
    """(rel, kind, loc) or None. kind: tsv (line0, col) | tt (assets|None, path_id, path) | ta (assets, path_id,
    line0, col) | i2 (assets, path_id, term) | lit index | shared (sheet, col, ja) with rel '*'."""
    q = r['id'].split('|')
    if q[0] == 'T' and len(q) == 4:
        return f'{SA}TSV/{q[1]}', 'tsv', (int(q[2]), int(q[3]))
    if q[0] == 'S' and len(q) == 6:
        return f'{SA}scenario/{q[1]}', 'tt', (None, int(q[2]), UT.scn_path('import', *map(int, q[3:])))
    if q[0] == 'G' and len(q) >= 4:
        return '*', 'shared', (q[1], q[2], r['id'].split('|', 3)[3])
    sf, sk, c = r['source_file'], r['source_key'], cls_of(r)
    rel = sf if sf.startswith('Data/') else SA + sf
    if sk.startswith('lit:'):
        return rel, 'lit', int(sk[4:])
    if c in ST.OWNED:
        an, pid, key = sk.split('|', 2)
        if c == 'u3d_i2':
            return rel, 'i2', (an, int(pid), key[5:])
        if c == 'textasset':
            return rel, 'ta', (an, int(pid), *ST.ta_loc(key))
        return rel, 'tt', (an, int(pid), tuple(key.split('.')))
    m = TSV_KEY.fullmatch(sk)
    if m and rel.startswith(SA + 'TSV/'):
        return rel, 'tsv', (int(m[1]) - 1, int(m[2]))
    m = SCN_KEY.fullmatch(sk)
    if m and rel.startswith(SA + 'scenario/'):
        return rel, 'tt', (None, int(m[1]), UT.scn_path(m[2], int(m[3]), int(m[4]), int(m[5])))
    return None


def plan(rows):
    """-> ({rel: [(kind, loc, ja, value, id)]}, [(loc, ja, value)] shared, Counter skipped). Values unescaped."""
    edits, shared, skipped = collections.defaultdict(list), [], collections.Counter()
    safe = ML.safe_ids(os.environ.get('GT_UNITY_LITERAL_SAFETY'))
    for r in rows:
        a = addr(r)
        if a is None:
            skipped[cls_of(r) or '?'] += 1
            continue
        rel, kind, loc = a
        ja, v = (unesc(r['ja']), unesc(r['value'])) if has_esc(r) else (r['ja'], r['value'])
        if kind == 'shared':
            shared.append((loc, v))
        elif kind == 'lit' and v != ja and (safe is None or r['id'] not in safe):
            skipped['il2cpp_literal_not_safe'] += 1
        else:
            edits[rel].append((kind, loc, ja, v, r['id']))
    return edits, shared, skipped


# ---------------- per-format edit / get ----------------
def tsv_edit(text, es):
    lines = text.split('\n')
    for _, (li, ci), ja, v, rid in es:
        cells = lines[li].split('\t')
        assert cells[ci] == ja, f'source identity {rid}'
        cells[ci] = v
        lines[li] = '\t'.join(cells)
    return '\n'.join(lines)


def tsv_get(lines, li, ci):
    cells = lines[li].split('\t') if li < len(lines) else []
    return cells[ci] if ci < len(cells) else '<missing>'


def tree_get(t, kind, loc):
    return ST.ta_get(t['m_Script'], *loc[2:]) if kind == 'ta' else tget(t, loc[2])


def tree_edit(t, items):
    for kind, loc, ja, v, rid in items:
        assert tree_get(t, kind, loc) == ja, f'source identity {rid}'
        if kind == 'ta':
            t['m_Script'] = ST.ta_set(t['m_Script'], *loc[2:], v)
        else:
            tset(t, loc[2], v)


def shared_cells(t):
    """(path, sheet, column, value) of every settingList data cell of one Utage typetree."""
    for gi, g in enumerate(t.get('settingList', [])):
        rows = g['rows']
        if not rows:
            continue
        sheet, hdr = g['name'].rsplit(':', 1)[-1], rows[0]['strings']
        for ri, r in enumerate(rows[1:], 1):
            for ci, v in enumerate(r['strings'][:len(hdr)]):
                yield UT.scn_path('setting', gi, ri, ci), sheet, hdr[ci], v


def apply_file(path, rel, es, rom, shared=None):
    """New bytes of one source file with edits applied (None: shared-only file without a matching cell)."""
    if es and es[0][0] == 'tsv':
        return tsv_edit(Path(path).read_bytes().decode('utf-8'), es).encode('utf-8')
    if es and es[0][0] == 'lit':
        b = Path(path).read_bytes()
        rows = [{'id': rid, 'source_key': f'lit:{i}', 'ja': ja, 'value': v} for _, i, ja, v, rid in es]
        return ML.inject(b, ML.changes_from(rows, b)[0])
    env = load_env(path, rel, rom)
    objs = list(env.objects)
    by2 = {(o.assets_file.name, o.path_id): o for o in objs}
    byp = {o.path_id: o for o in objs}
    per = collections.defaultdict(list)
    for e in es:
        o = by2[e[1][:2]] if e[1][0] else byp[e[1][1]]
        per[(o.assets_file.name, o.path_id)].append(e)
    for k, items in per.items():
        o = by2[k]
        if items[0][0] == 'i2':
            i2 = ST.I2(o.get_raw_data())
            ji = i2.ja_index()
            for _, loc, ja, v, rid in items:
                t = i2.term(loc[2])
                assert t[2][ji] == ja, f'source identity {rid}'
                t[2][ji] = v
            o.set_raw_data(i2.dump())
        else:
            t = o.read_typetree()
            tree_edit(t, items)
            o.save_typetree(t)
    hit = 0
    for o in objs if shared else ():
        if o.type.name == 'MonoBehaviour':
            t = o.read_typetree()
            n = 0
            for p, sheet, col, v in shared_cells(t):
                if (sheet, col, v) in shared:
                    tset(t, p, shared[(sheet, col, v)])
                    n += 1
            if n:
                o.save_typetree(t)
                hit += n
    return env.file.save(packer='original') if per or hit else None


def inject(rows, src_root, out_root):
    src, out = Path(src_root), Path(out_root)
    edits, shared, skipped = plan(rows)
    sh = {loc: v for loc, v in shared}
    if sh:
        for b in sorted(os.listdir(src / SA / 'scenario')):
            if not b.endswith('.manifest'):
                edits.setdefault(f'{SA}scenario/{b}', [])
    written = []
    for rel, es in sorted(edits.items()):
        data = apply_file(src / rel, rel, es, src, sh if rel.startswith(SA + 'scenario/') else None)
        if data is not None:
            w_atomic(out / rel, data)
            written.append(rel)
    if skipped:
        print(f'unity_adapter: skipped rows {dict(skipped)}')
    return written


def read_shared(roots, keys):
    """{(sheet, col, ja): value} read at every source position holding ja (inconsistent values are reported)."""
    from ucommon import UnityPy
    rom, vals = roots[-1], collections.defaultdict(set)
    for b in sorted(os.listdir(rom / SA / 'scenario')):
        if b.endswith('.manifest'):
            continue
        rel = f'{SA}scenario/{b}'
        pos = [(o.path_id, p, (sh, col, v)) for o in UnityPy.load(str(rom / rel)).objects
               if o.type.name == 'MonoBehaviour' for p, sh, col, v in shared_cells(o.read_typetree()) if (sh, col, v) in keys]
        if pos:
            f = next(x / rel for x in roots if (x / rel).exists())
            trees = {o.path_id: o.read_typetree() for o in UnityPy.load(str(f)).objects if o.type.name == 'MonoBehaviour'}
            for pid, p, k in pos:
                vals[k].add(tget(trees[pid], p))
    return {k: s.pop() if len(s) == 1 else f'<inconsistent {sorted(s)}>' for k, s in vals.items()}


def reader(p, rel, rom, kind):
    """Value getter for one located file."""
    if kind == 'tsv':
        lines = p.read_bytes().decode('utf-8').split('\n')
        return lambda a: tsv_get(lines, *a[2])
    if kind == 'lit':
        tx = ML.texts(p.read_bytes())
        return lambda a: tx[a[2]]
    env = load_env(p, rel, rom)
    by2 = {(o.assets_file.name, o.path_id): o for o in env.objects}
    byp = {o.path_id: o for o in env.objects}
    cache = {}

    def get(a):
        _, k, loc = a
        o = by2[loc[:2]] if loc[0] else byp[loc[1]]
        key = (o.assets_file.name, o.path_id)
        if key not in cache:
            cache[key] = ST.I2(o.get_raw_data()) if k == 'i2' else o.read_typetree()
        t = cache[key]
        return t.term(loc[2])[2][t.ja_index()] if k == 'i2' else tree_get(t, k, loc)
    return get


def read(roots, rows):
    """Value at each row's key; roots = [overlay, src_root], first existing file wins. No language filtering."""
    roots = [Path(x) for x in roots]
    addrs = [addr(r) for r in rows]
    by = collections.defaultdict(list)
    for i, a in enumerate(addrs):
        if a:
            by[a[0]].append(i)
    out = [None] * len(rows)
    for rel, idx in sorted(by.items()):
        if rel == '*':
            got = read_shared(roots, {addrs[i][2] for i in idx})
            for i in idx:
                out[i] = got.get(addrs[i][2])
            continue
        p = next((x / rel for x in roots if (x / rel).exists()), None)
        if p is None:
            continue
        get = reader(p, rel, roots[-1], addrs[idx[0]][1])
        for i in idx:
            try:
                v = get(addrs[i])
            except Exception as e:  # missing object / index: report as a mismatch, never drop the row
                v = f'<err {type(e).__name__}: {e}>'
            out[i] = esc(v) if isinstance(v, str) and has_esc(rows[i]) else v
    return out


# ---------------- CLI ----------------
def selftest():
    import tempfile
    rows = [
        {'id': 'GP1', 'source_file': 'TSV/a.tsv', 'source_key': 'L4:C2', 'ja': '剣\\n強い', 'notes': 'tsv;a.Name'},
        {'id': 'T|a.tsv|4|3', 'source_file': f'{SA}TSV/a.tsv', 'source_key': 'Desc:説明', 'ja': '盾', 'notes': 'tsv'},
        {'id': 'GP2', 'source_file': 'scenario/b1', 'source_key': '-42|setting0:r1:c1', 'ja': '一花', 'notes': ''},
        {'id': 'S|b1|7|0|2|3', 'source_file': f'{SA}scenario/b1', 'source_key': 'x:1:Text', 'ja': 'あ', 'notes': ''},
        {'id': 'G|Character|NameText|一花', 'source_file': f'{SA}scenario/*', 'source_key': '', 'ja': '一花', 'notes': ''},
        {'id': 'GS1', 'source_file': 'Data/data.unity3d', 'source_key': 'sharedassets0.assets|5|m_Options.m_Options.0.m_Text',
         'ja': '高', 'notes': 'u3d_ui;cls=Dropdown'},
        {'id': 'UI2|x', 'source_file': 'Data/data.unity3d', 'source_key': 'resources.assets|9|term:Menu/Start',
         'ja': 'はじめる', 'notes': 'u3d_i2', 'class': 'u3d_i2'},
        {'id': 'GS2', 'source_file': 'Data/data.unity3d', 'source_key': 'sharedassets0.assets|3|L2:C1', 'ja': 'はい',
         'notes': 'textasset;cls=SystemText'},
        {'id': 'GS3', 'source_file': ML.META_REL, 'source_key': 'lit:1', 'ja': 'いいえ', 'notes': 'il2cpp_literal'},
        {'id': 'X1', 'source_file': 'Data/other.bin', 'source_key': 'zz', 'ja': 'あ', 'notes': 'unknown'},
    ]
    a = [addr(r) for r in rows]
    assert a[0] == (f'{SA}TSV/a.tsv', 'tsv', (3, 2)) and a[1] == (f'{SA}TSV/a.tsv', 'tsv', (4, 3))
    assert a[2] == (f'{SA}scenario/b1', 'tt', (None, -42, ('settingList', 0, 'rows', 1, 'strings', 1)))
    assert a[3] == (f'{SA}scenario/b1', 'tt', (None, 7, ('importGridList', 0, 'rows', 2, 'strings', 3)))
    assert a[4] == ('*', 'shared', ('Character', 'NameText', '一花'))
    assert a[5] == ('Data/data.unity3d', 'tt', ('sharedassets0.assets', 5, ('m_Options', 'm_Options', '0', 'm_Text')))
    assert a[6] == ('Data/data.unity3d', 'i2', ('resources.assets', 9, 'Menu/Start'))
    assert a[7] == ('Data/data.unity3d', 'ta', ('sharedassets0.assets', 3, 2, 1))
    assert a[8] == (ML.META_REL, 'lit', 1) and a[9] is None
    # typetree edits (scenario cell, UI field path, TextAsset cell) + identity assert + shared cells
    t = {'importGridList': [{'name': 'b:M', 'rows': [{'strings': ['Command', 'Arg1', 'Arg2', 'Text']},
                                                      {'strings': ['', '', '', 'x']}, {'strings': ['', '', '', 'あ']}]}],
         'settingList': [{'name': 'b:Character', 'rows': [{'strings': ['CharacterName', 'NameText']},
                                                           {'strings': ['ichika', '一花']}]}],
         'm_Options': {'m_Options': [{'m_Text': '高'}]}, 'm_Script': 'Key\tJapanese\nA\tx\nB\tはい'}
    tree_edit(t, [('tt', a[3][2], 'あ', 'A\\nB', 'S'), ('tt', a[5][2], '高', '높음', 'GS1'), ('ta', a[7][2], 'はい', '예', 'GS2')])
    assert t['importGridList'][0]['rows'][2]['strings'][3] == 'A\\nB' and t['m_Options']['m_Options'][0]['m_Text'] == '높음'
    assert t['m_Script'] == 'Key\tJapanese\nA\tx\nB\t예' and tree_get(t, 'ta', a[7][2]) == '예'
    try:
        tree_edit(t, [('tt', a[3][2], 'あ', 'z', 'S')])
        raise SystemExit('identity assert missing')
    except AssertionError:
        pass
    assert [(s, c, v) for _, s, c, v in shared_cells(t)] == [('Character', 'CharacterName', 'ichika'),
                                                             ('Character', 'NameText', '一花')]
    # plan: esc rows unescape, unsafe literal skipped, unknown skipped
    pr = [dict(r, value=r['ja']) for r in rows] + [dict(rows[8], value='아니요')]
    pr.append({'id': 'E1', 'source_file': 'Data/data.unity3d', 'source_key': 'a|1|m_Text', 'ja': 'A\\nB', 'value': '가\\n나',
               'notes': 'ui_prefab;esc'})
    ed, sh, sk = plan(pr)
    assert sk == {'unknown': 1, 'il2cpp_literal_not_safe': 1} and sh == [(a[4][2], '一花')]
    assert ed['Data/data.unity3d'][-1][2:4] == ('A\nB', '가\n나')
    # end to end without UnityPy: TSV (both key forms, literal \n kept) + metadata literal, read [overlay, src]
    with tempfile.TemporaryDirectory() as d:
        src, out = Path(d, 'src'), Path(d, 'out')
        tsv = 'a\nフラグ\t名前\t説明\nFlag\tName\tDesc\n\tx\t剣\\n強い\n\ty\tz\t盾\n'
        w_atomic(src / SA / 'TSV/a.tsv', tsv)
        w_atomic(src / ML.META_REL, ML.synth(['はい', 'いいえ']))
        sub = [dict(rows[0], value='검\\n강함'), dict(rows[1], value='방패'), dict(rows[8], value='いいえ')]
        files = inject(sub, src, out)
        assert files == [ML.META_REL, f'{SA}TSV/a.tsv'], files
        assert (out / ML.META_REL).read_bytes() == (src / ML.META_REL).read_bytes()
        assert (out / SA / 'TSV/a.tsv').read_text(encoding='utf-8') == tsv.replace('剣\\n強い', '검\\n강함').replace('盾', '방패')
        assert read([out, src], sub) == ['검\\n강함', '방패', 'いいえ']
        assert read([out, src], [rows[0], rows[9]]) == ['검\\n강함', None]  # value read regardless of language
        assert read([src], sub[:1]) == ['剣\\n強い']
    print('unity_adapter selftest OK')


def main(argv):
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['inject', 'verify', 'selftest'])
    ap.add_argument('--manifest')
    ap.add_argument('--src')
    ap.add_argument('--out')
    a = ap.parse_args(argv)
    if a.cmd == 'selftest':
        return selftest()
    rows = [dict(r, value=r.get('target_ko') or r['ja']) for r in read_manifest(a.manifest)]
    if a.cmd == 'inject':
        if Path(a.out).exists():
            sys.exit(f'refuse: {a.out} exists')
        return print(f'inject files={len(inject(rows, a.src, a.out))} -> {a.out}')
    got = read([a.out, a.src], rows)
    bad = [(r['id'], r['value'], v) for r, v in zip(rows, got) if v != r['value']]
    for b in bad[:20]:
        print('MISMATCH', *b, sep='\t')
    print(f'verify rows={len(rows)} mismatch={len(bad)}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
