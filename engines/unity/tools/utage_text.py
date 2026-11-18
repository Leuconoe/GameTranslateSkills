"""utage_text.py - Unity + Utage text walkers: master TSV (StreamingAssets/TSV) and Utage scenario bundles.

Extraction is driven by unity_adapter.extract() (bulk_tool `extract`); inject/read live in unity_adapter.
  python -I utage_text.py selftest

Sources (romfs root):
  Data/StreamingAssets/TSV/*.tsv  line1 table name, line2 JP header, line3 EN header, data from line 4; LF; a line break
                                  inside a cell is the literal 2-char escape `\\n` (kept as-is in the manifest).
  Data/StreamingAssets/scenario/* UnityFS bundles; Utage AdvImportScenarioSheet/AdvImportBook MonoBehaviours (typetree
                                  present); StringGrid rows in importGridList / settingList.
Keys: TSV `L<line 1-based>:C<col>`; scenario `<path_id>|(import|setting)<grid>:r<row>:c<col>`.
Per-title differences are config (JSON file in $GT_UTAGE_CFG overrides CFG keys):
  tsv_exclude [[table, col]...] identifier columns; tsv_exclude_table [table...]; tsv_skip_cols [col...];
  tsv_min_col first data column considered; tsv_strict skip lines whose cell count != header (kept byte-exact);
  arg_cmds {command: [arg col idx...]} displayed Arg columns (title / end cards).
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script dir
from ucommon import JP  # noqa: E402

CFG = {
    'tsv_exclude': [['validation_word', 'word'], ['item_password', 'password'], ['item_password', 'comment'],
                    ['special_content', 'Comment'], ['multilingual', 'Zh']],
    'tsv_exclude_table': [],
    'tsv_skip_cols': ['Flag'],
    'tsv_min_col': 0,
    'tsv_strict': False,
    'arg_cmds': {'TitleAnim': [1, 2], 'EndAnim': [1], 'EventEndAnim': [1]},
}


def cfg():
    c = dict(CFG)
    if os.environ.get('GT_UTAGE_CFG'):
        with open(os.environ['GT_UTAGE_CFG'], encoding='utf-8') as fh:
            c.update(json.load(fh))
    return c


def tsv_cells(name, text, c):
    """Yield (key, value, notes) for translatable cells of one master TSV (name without .tsv)."""
    lines = text.split('\n')
    if len(lines) < 4 or name in c['tsv_exclude_table']:
        return
    hdr = [h.strip() for h in lines[2].split('\t')]
    excl = {tuple(x) for x in c['tsv_exclude']}
    for li in range(3, len(lines)):
        cells = lines[li].split('\t')
        if c['tsv_strict'] and len(cells) != len(hdr):
            continue
        for ci, v in enumerate(cells):
            col = hdr[ci] if ci < len(hdr) else f'#{ci}'
            if ci >= c['tsv_min_col'] and JP.search(v) and col not in c['tsv_skip_cols'] and (name, col) not in excl:
                yield f'L{li + 1}:C{ci}', v, f'tsv;{name}.{col}'


def grids(t):
    return [('import', i, g) for i, g in enumerate(t.get('importGridList', []))] + \
           [('setting', i, g) for i, g in enumerate(t.get('settingList', []))]


def charkeys_of(trees):
    """Character-sheet keys: an Arg1 speaker equal to a key is displayed via NameText, so it is not a row."""
    out = set()
    for t in trees:
        for _, _, g in grids(t):
            rows = g['rows']
            if rows and g['name'].endswith(':Character') and rows[0]['strings'][:1] == ['CharacterName']:
                out.update(r['strings'][0] for r in rows[1:] if r['strings'])
    return out


def scn_cells(t, charkeys, c):
    """Yield (key, value, notes, speaker) for every translatable cell of one Utage MonoBehaviour typetree."""
    arg_cmds = {k: tuple(v) for k, v in c['arg_cmds'].items()}
    for kind, gi, g in grids(t):
        rows = g['rows']
        if not rows:
            continue
        hdr = rows[0]['strings']
        gname = g['name'].rsplit(':', 1)[-1]
        if hdr and hdr[0] == 'Command' and 'Text' in hdr:
            ti = hdr.index('Text')
            for ri, r in enumerate(rows[1:], 1):
                s = r['strings']
                cmd = s[0] if s else ''
                text = s[ti] if len(s) > ti else ''
                spk = s[1] if len(s) > 1 else ''
                if text and JP.search(text):
                    cls = {'': 'scn_text', 'Selection': 'scn_select'}.get(cmd, 'scn_text_' + cmd)
                    yield f'{kind}{gi}:r{ri}:c{ti}', text, cls, spk if cmd == '' else 'SEL'
                if cmd == '' and text and JP.search(spk) and spk not in charkeys:
                    yield f'{kind}{gi}:r{ri}:c1', spk, 'scn_speaker', 'NAME'
                for ai in arg_cmds.get(cmd, ()):
                    if len(s) > ai and JP.search(s[ai]):
                        yield f'{kind}{gi}:r{ri}:c{ai}', s[ai], 'scn_arg_' + cmd, 'TITLE'
        elif gname == 'Character' and hdr and 'NameText' in hdr:
            ni = hdr.index('NameText')
            for ri, r in enumerate(rows[1:], 1):
                s = r['strings']
                if len(s) > ni and JP.search(s[ni]):
                    yield f'{kind}{gi}:r{ri}:c{ni}', s[ni], 'scn_charname', 'NAME'


def scn_path(kind, gi, ri, ci):
    """Typetree path of one scenario grid cell."""
    return ('importGridList' if kind == 'import' else 'settingList', gi, 'rows', ri, 'strings', ci)


def walk(rom):
    """Yield bulk_tool extract dicts (TSV files, then scenario bundles); source_file is romfs-relative."""
    from ucommon import SA, UnityPy
    c = cfg()
    sa = rom / SA
    for name in sorted(os.listdir(sa / 'TSV')):
        text = (sa / 'TSV' / name).read_bytes().decode('utf-8')
        for key, v, notes in tsv_cells(name[:-4], text, c):
            yield {'source_file': f'{SA}TSV/{name}', 'source_key': key, 'ja': v, 'notes': notes, 'speaker': 'UI'}
    for b in sorted(f for f in os.listdir(sa / 'scenario') if not f.endswith('.manifest')):
        env = UnityPy.load(str(sa / 'scenario' / b))
        mbs = [(o, o.read_typetree()) for o in env.objects if o.type.name == 'MonoBehaviour']
        ck = charkeys_of([t for _, t in mbs])
        for o, t in mbs:
            for key, v, notes, spk in scn_cells(t, ck, c):
                yield {'source_file': f'{SA}scenario/{b}', 'source_key': f'{o.path_id}|{key}', 'ja': v,
                       'notes': notes, 'speaker': spk}


def selftest():
    c = dict(CFG)
    tsv = ('item\nフラグ\tID\t名前\t説明\nFlag\tID\tName\tDesc\n'
           '※有効\t1\t剣\t強い\\n剣\n\t2\tsword\t盾\n')
    got = list(tsv_cells('item', tsv, c))
    assert got == [('L4:C2', '剣', 'tsv;item.Name'), ('L4:C3', '強い\\n剣', 'tsv;item.Desc'),
                   ('L5:C3', '盾', 'tsv;item.Desc')], got
    c2 = dict(c, tsv_skip_cols=[], tsv_min_col=0, tsv_exclude=[['item', 'Desc']])
    assert [k for k, _, _ in tsv_cells('item', tsv, c2)] == ['L4:C0', 'L4:C2']
    assert [k for k, _, _ in tsv_cells('item', tsv, dict(c, tsv_min_col=3))] == ['L4:C3', 'L5:C3']
    assert not list(tsv_cells('item', tsv, dict(c, tsv_exclude_table=['item'])))
    assert [k for k, _, _ in tsv_cells('item', tsv + 'x\t剣\n', dict(c, tsv_strict=True))][-1] == 'L5:C3'

    def g(name, rows):
        return {'name': name, 'rows': [{'strings': r} for r in rows]}
    t = {'importGridList': [g('b:Main', [['Command', 'Arg1', 'Arg2', 'Text'],
                                         ['', '風太郎', '', 'おはよう\\n二乃'],
                                         ['', 'モブ男', '', 'やあ'],
                                         ['Selection', '', '', '行く'],
                                         ['TitleAnim', '第一話', '始まり', ''],
                                         ['EndAnim', '続く', '', '']])],
         'settingList': [g('b:Character', [['CharacterName', 'NameText'], ['風太郎', '上杉風太郎']])]}
    ck = charkeys_of([t])
    assert ck == {'風太郎'}
    cells = list(scn_cells(t, ck, c))
    assert [(k, n) for k, _, n, _ in cells] == [
        ('import0:r1:c3', 'scn_text'), ('import0:r2:c3', 'scn_text'), ('import0:r2:c1', 'scn_speaker'),
        ('import0:r3:c3', 'scn_select'), ('import0:r4:c1', 'scn_arg_TitleAnim'), ('import0:r4:c2', 'scn_arg_TitleAnim'),
        ('import0:r5:c1', 'scn_arg_EndAnim'), ('setting0:r1:c1', 'scn_charname')], cells
    assert cells[0][1] == 'おはよう\\n二乃' and cells[0][3] == '風太郎'
    assert not [k for k, *_ in scn_cells(t, ck, dict(c, arg_cmds={})) if 'arg' in k]
    assert scn_path('setting', 0, 1, 1) == ('settingList', 0, 'rows', 1, 'strings', 1)
    print('utage_text selftest OK')


if __name__ == '__main__':
    if sys.argv[1:] == ['selftest']:
        selftest()
    else:
        sys.exit(__doc__)
