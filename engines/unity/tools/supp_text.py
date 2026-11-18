"""supp_text.py - Unity supplement text classes (outside master TSV / Utage scenario).

  python -I supp_text.py extract -p <_work/TID> [--prefix GS|key] [--bundle-dirs model,pc/AssetBundle]
        [--key-fields Class.field,...] [--force]
        -> 30_translation/text/supplement/SUPP_MANIFEST.tsv (refuses overwrite); lookup-key fields (KEY_FIELDS + the
        --key-fields list) are never extracted
  python -I supp_text.py noop -p <_work/TID> [--manifest M]   rewrite every owned file unchanged: all objects raw-exact
  python -I supp_text.py selftest
Inject / verify of these rows: unity_adapter (bulk_tool inject/verify, or `unity_adapter.py inject|verify --manifest`).

Classes (column `class`, also first notes field):
  ui_prefab      StreamingAssets/<bundle dirs> MonoBehaviour UI fields (typetree present)
  u3d_ui         Data/data.unity3d MonoBehaviour UI fields (typetree stripped -> generated from the Il2CppDumper DummyDll,
                 see ucommon.dummy_dir); resources.assets skipped except the I2 source
  u3d_i2         data.unity3d I2.Loc.LanguageSourceAsset, `ja` language column (raw codec below)
  textasset      Utage language TextAssets (TA_NAMES), Japanese column
  il2cpp_literal global-metadata.dat literals (screen-facing heuristic, not already in the main manifest);
                 injected only after a per-title usage review (meta_literals safety TSV)
Source keys: `<assets file>|<path_id>|<field path | term:<term> | L<line0>:C<col>>`; `lit:<index>`.
Rows whose source holds real LF/CR/TAB carry `esc` in notes and store them as the 2-char sequences \\n \\r \\t.
"""
import argparse
import collections
import os
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script dir
from ucommon import JP, U3D_REL, esc, load_env, read_manifest, w_atomic  # noqa: E402

KANA = re.compile(r'[぀-ヿｦ-ﾟ]')
PLACEHOLDER = re.compile(r'^(あ)+$|仮の?文言|^テキスト表示領域$')  # overwritten at runtime
TA_NAMES = {'SystemText', 'ExampleText'}  # AdvErrorMsg / ErrorMsg = developer diagnostics
OWNED = ('ui_prefab', 'u3d_ui', 'u3d_i2', 'textasset')
HEADER = ['id', 'source_file', 'source_key', 'ja', 'en', 'target_ko', 'status', 'notes', 'class']
LIT_DROP = re.compile(r'が見つかりません|エラー|[Nn]ull|NULL|Prefab|ロジック|不正|存在しない|読み込めません|権限|参照数|'
                      r'デバッグ|Debug|テスト|ID\(|\(1以上\)|[A-Za-z_]+=|\[\w+\(\)\]|[A-Za-z]{3,}\s*:|ボーン|コライダー|モーション番号')


# ---------------- MonoBehaviour UI fields ----------------
def ui_fields(t):
    """Screen-facing string field paths of one MonoBehaviour typetree (signature based, no script needed)."""
    if isinstance(t.get('m_Text'), str) and ('m_FontData' in t or 'm_TextComponent' in t):
        yield 'm_Text'  # uGUI Text (+ Utage UguiNovelText) / InputField initial text
    if isinstance(t.get('m_text'), str) and 'm_fontAsset' in t:
        yield 'm_text'  # TextMeshPro
    o = t.get('m_Options')
    if isinstance(o, dict) and isinstance(o.get('m_Options'), list):
        for i, opt in enumerate(o['m_Options']):
            if isinstance(opt.get('m_Text'), str):
                yield f'm_Options.m_Options.{i}.m_Text'  # Dropdown
    for k in ('_chapterName', '_chapterNum'):  # chapter-node style string fields (see KEY_FIELDS)
        if isinstance(t.get(k), str):
            yield k


# MonoBehaviour string fields that games use as lookup keys (translating them hangs the screen that resolves them).
# Extend per project with `extract --key-fields Class.field,...`.
KEY_FIELDS = {('ChapterListNode', '_chapterName'), ('ChapterListNode', '_chapterNum')}


def keep_ui(s):
    return bool(JP.search(s)) and not PLACEHOLDER.search(s)


def script_name(o):
    try:
        return o.parse_monobehaviour_head().m_Script.deref_parse_as_object().m_ClassName
    except Exception:
        return '?'


# ---------------- I2 LanguageSourceAsset raw codec ----------------
class I2:
    """mSource.mTerms of an I2 LanguageSourceAsset: head | count | terms | tail (tail kept byte-exact)."""

    def __init__(self, b):
        self.b = b
        i = 12 + 4 + 12  # m_GameObject, m_Enabled(aligned), m_Script
        n = struct.unpack_from('<i', b, i)[0]
        i = (i + 4 + n + 3) & ~3  # m_Name
        i += 12  # 3 aligned bools
        self.head_end = i
        cnt = struct.unpack_from('<i', b, i)[0]
        i += 4
        self.terms = []
        for _ in range(cnt):
            term, i = self._s(i)
            ttype = struct.unpack_from('<i', b, i)[0]
            i += 4
            langs, i = self._sa(i)
            fl = struct.unpack_from('<i', b, i)[0]
            flags = b[i + 4:i + 4 + fl]
            i = (i + 4 + fl + 3) & ~3
            touch, i = self._sa(i)
            self.terms.append([term, ttype, langs, flags, touch])
        self.tail = b[i:]
        j = i + 8  # bool, int, string AppName, LanguageData[] (name, code, int)
        j = self._s(j)[1]
        nl = struct.unpack_from('<i', b, j)[0]
        j += 4
        self.langs = []
        for _ in range(nl):
            nm, j = self._s(j)
            cd, j = self._s(j)
            j += 4
            self.langs.append((nm, cd))

    def _s(self, i):
        n = struct.unpack_from('<i', self.b, i)[0]
        return self.b[i + 4:i + 4 + n].decode('utf-8'), (i + 4 + n + 3) & ~3

    def _sa(self, i):
        n = struct.unpack_from('<i', self.b, i)[0]
        i += 4
        out = []
        for _ in range(n):
            v, i = self._s(i)
            out.append(v)
        return out, i

    @staticmethod
    def ws(v):
        e = v.encode('utf-8')
        return struct.pack('<i', len(e)) + e + b'\0' * (-len(e) % 4)

    def dump(self):
        out = [self.b[:self.head_end], struct.pack('<i', len(self.terms))]
        for term, ttype, langs, flags, touch in self.terms:
            out += [self.ws(term), struct.pack('<i', ttype), struct.pack('<i', len(langs))]
            out += [self.ws(v) for v in langs]
            out += [struct.pack('<i', len(flags)), flags, b'\0' * (-len(flags) % 4), struct.pack('<i', len(touch))]
            out += [self.ws(v) for v in touch]
        out.append(self.tail)
        return b''.join(out)

    def ja_index(self):
        return [c for _, c in self.langs].index('ja')

    def term(self, name):
        return next(t for t in self.terms if t[0] == name)


# ---------------- TextAsset (Utage language TSV) ----------------
def ta_cells(s):
    lines = s.split('\n')
    if lines[0].lstrip('﻿').rstrip('\r').split('\t')[:2] != ['Key', 'Japanese']:
        return
    for li in range(1, len(lines)):
        c = lines[li].split('\t')
        if len(c) > 1 and JP.search(c[1]):
            assert '\r' not in c[1]
            yield f'L{li}:C1', c[1]


def ta_loc(key):
    li, ci = key.split(':')
    return int(li[1:]), int(ci[1:])


def ta_get(s, li, ci):
    return s.split('\n')[li].split('\t')[ci]


def ta_set(s, li, ci, v):
    lines = s.split('\n')
    c = lines[li].split('\t')
    c[ci] = v
    lines[li] = '\t'.join(c)
    return '\n'.join(lines)


# ---------------- extract ----------------
def units(env, rel, key_fields=KEY_FIELDS):
    """Yield (class, source_key, value, script/asset name) for every owned unit of one Unity file (key fields skipped)."""
    u3d = rel == U3D_REL
    for o in env.objects:
        an = o.assets_file.name
        if o.type.name == 'TextAsset':
            t = o.read_typetree()
            if t['m_Name'] in TA_NAMES:
                for key, v in ta_cells(t['m_Script']):
                    yield 'textasset', f'{an}|{o.path_id}|{key}', v, t['m_Name']
            continue
        if o.type.name != 'MonoBehaviour':
            continue
        if u3d and an == 'resources.assets':  # Resources/ prefabs are debug menus; only the I2 source is used
            if script_name(o) == 'LanguageSourceAsset':
                i2 = I2(o.get_raw_data())
                ji = i2.ja_index()
                for term, _, langs, _, _ in i2.terms:
                    if term.split('_')[0].split('/')[0] != 'Debug' and len(langs) > ji and JP.search(langs[ji]):
                        yield 'u3d_i2', f'{an}|{o.path_id}|term:{term}', langs[ji], 'I2:' + term.split('_')[0]
            continue
        try:
            t = o.read_typetree()
        except Exception:
            continue
        cn = None
        for f in ui_fields(t):
            cn = cn or script_name(o)
            if (cn, f) in key_fields:
                continue
            v = t
            for k in f.split('.'):
                v = v[int(k)] if isinstance(v, list) else v[k]
            if keep_ui(v):
                yield ('u3d_ui' if u3d else 'ui_prefab'), f'{an}|{o.path_id}|{f}', v, cn


def lit_keep(s):
    """Heuristic screen-facing filter for IL2CPP literals (no xref): (keep, reason)."""
    jp = JP.findall(s)
    if not jp:
        return False, 'no_jp'
    if not KANA.search(s) and len(jp) < 2:
        return False, 'single_kanji'
    if re.fullmatch(r'[ｦ-ﾟ]+', s):
        return False, 'halfwidth_table'
    if s != s.strip(' ') or s.startswith('　぀'):
        return False, 'debug_label_space'
    if LIT_DROP.search(s):
        return False, 'dev_log'
    if re.fullmatch(r'[^\s,]+(,[^\s,]+)+', s):
        return False, 'param_list'
    if s.endswith('\\n') or s.endswith('\n'):
        return False, 'editor_tooltip'
    return True, ''


def bundle_files(rom, dirs):
    out = []
    for sub in dirs:
        for dp, dn, fn in os.walk(rom / 'Data/StreamingAssets' / sub):
            dn.sort()
            out += [Path(dp, f).relative_to(rom).as_posix() for f in sorted(fn) if not f.endswith('.manifest')]
    return out


def extract(prj, prefix, dirs, key_fields=KEY_FIELDS):
    from meta_literals import META_REL, texts
    rom = prj / '10_extract' / 'romfs_original'
    man = prj / '30_translation' / 'text' / 'translation_manifest.tsv'
    rows, stats = [], collections.Counter()

    def add(cls, sf, key, v, extra):
        flag = bool(re.search(r'[\n\r\t]', v))
        rows.append({'id': '', 'source_file': sf, 'source_key': key, 'ja': esc(v) if flag else v, 'en': '',
                     'target_ko': '', 'status': 'new', 'class': cls,
                     'notes': cls + (';esc' if flag else '') + (f';{extra}' if extra else '')})
        stats[cls] += 1

    for rel in bundle_files(rom, dirs) + [U3D_REL]:
        try:
            env = load_env(rom / rel, rel, rom)
        except Exception:
            stats['load_error'] += 1
            continue
        for cls, key, v, cn in units(env, rel, key_fields):
            add(cls, rel, key, v, f'cls={cn}')
    main_ja = {r['ja'] for r in read_manifest(man)} if man.exists() else set()
    seen = set()
    for i, s in enumerate(texts((rom / META_REL).read_bytes())):
        if s is None or s in main_ja or s in seen:
            continue
        seen.add(s)
        ok, why = lit_keep(s)
        stats['lit_' + (why or 'keep')] += 1
        if ok:
            add('il2cpp_literal', META_REL, f'lit:{i}', s, 'extract_only')
    pre = {'ui_prefab': 'UP', 'u3d_ui': 'UD', 'u3d_i2': 'UI2', 'textasset': 'TA', 'il2cpp_literal': 'ML'}
    for n, r in enumerate(rows, 1):
        r['id'] = f"{pre[r['class']]}|{r['source_file']}|{r['source_key']}" if prefix == 'key' else f'{prefix}{n:06d}'
    assert len({r['id'] for r in rows}) == len(rows), 'duplicate ids'
    assert not any(re.search(r'[\t\r\n]', r['ja'] + r['source_key']) for r in rows)
    out = prj / '30_translation' / 'text' / 'supplement' / 'SUPP_MANIFEST.tsv'
    w_atomic(out, '\t'.join(HEADER) + '\n' + ''.join('\t'.join(r[h] for h in HEADER) + '\n' for r in rows))
    print(f'SUPP rows={len(rows)} {dict(stats)} -> {out}')


def noop(prj, manifest):
    """Every owned file rewritten with value = ja: all objects must stay raw-identical."""
    import unity_adapter as ua
    from ucommon import UnityPy
    rom = prj / '10_extract' / 'romfs_original'
    rows = [dict(r, value=r['ja']) for r in read_manifest(manifest) if (r.get('class') or r['notes'].split(';')[0]) in OWNED]
    edits = ua.plan(rows)[0]
    bad = 0
    for rel, es in sorted(edits.items()):
        data = ua.apply_file(rom / rel, rel, es, rom)
        a = {(o.assets_file.name, o.path_id): o.get_raw_data() for o in UnityPy.load(str(rom / rel)).objects}
        b = {(o.assets_file.name, o.path_id): o.get_raw_data() for o in UnityPy.load(data).objects}
        bad += a != b
    print(f'supp noop rows={len(rows)} files={len(edits)} bad_files={bad}')
    return 1 if bad else 0


def selftest():
    # I2 codec: synthetic MonoBehaviour raw (head, 2 terms, tail with language list)
    ws = I2.ws
    head = b'\0' * 28 + ws('I2Languages') + b'\0' * 12
    def term(name, langs):
        return ws(name) + struct.pack('<i', 0) + struct.pack('<i', len(langs)) + b''.join(ws(v) for v in langs) + \
            struct.pack('<i', 2) + b'\1\0\0\0' + struct.pack('<i', 0)
    tail = b'\0' * 8 + ws('App') + struct.pack('<i', 2) + ws('English') + ws('en') + b'\0' * 4 + \
        ws('Japanese') + ws('ja') + b'\0' * 4 + b'TAIL'
    raw = head + struct.pack('<i', 2) + term('Menu/Start', ['Start', 'はじめる']) + term('Debug_x', ['d', 'デバッグ']) + tail
    i2 = I2(raw)
    assert i2.dump() == raw and i2.ja_index() == 1 and i2.term('Menu/Start')[2][1] == 'はじめる'
    i2.term('Menu/Start')[2][1] = '시작하기\n!'
    assert I2(i2.dump()).term('Menu/Start')[2] == ['Start', '시작하기\n!'] and I2(i2.dump()).tail == tail
    # TextAsset cells
    s = '﻿Key\tJapanese\tEnglish\r\nA\tはい\tYes\r\nB\tOK\tOK\nC\tいいえ\\n本当\tNo'
    assert list(ta_cells(s)) == [('L1:C1', 'はい'), ('L3:C1', 'いいえ\\n本当')]
    assert ta_get(ta_set(s, 1, 1, '예'), 1, 1) == '예' and ta_set(s, 1, 1, 'はい') == s and ta_loc('L3:C1') == (3, 1)
    assert not list(ta_cells('Key\tEnglish\nA\tはい'))
    # UI field signatures
    t = {'m_Text': '閉じる', 'm_FontData': {}, 'm_Options': {'m_Options': [{'m_Text': '高'}, {'m_Text': 'x'}]}}
    assert list(ui_fields(t)) == ['m_Text', 'm_Options.m_Options.0.m_Text', 'm_Options.m_Options.1.m_Text']
    assert list(ui_fields({'m_text': 'あ', 'm_fontAsset': {}})) == ['m_text'] and not list(ui_fields({'m_Text': 'あ'}))
    assert keep_ui('閉じる') and not keep_ui('あああ') and not keep_ui('Close')
    # key fields: ChapterListNode._chapterName is a lookup key -> never extracted; extra project fields too
    from types import SimpleNamespace as NS
    def mb(cls, tt):
        sc = NS(deref_parse_as_object=lambda: NS(m_ClassName=cls))
        return NS(assets_file=NS(name='level4'), path_id=1, type=NS(name='MonoBehaviour'), read_typetree=lambda: tt,
                  parse_monobehaviour_head=lambda: NS(m_Script=sc))
    env = NS(objects=[mb('ChapterListNode', {'_chapterName': 'バレンタイン', '_chapterNum': '第5章'}),
                      mb('Label', {'m_Text': '閉じる', 'm_FontData': {}})])
    assert [k for _, k, _, _ in units(env, 'x')] == ['level4|1|m_Text']
    assert not list(units(env, 'x', KEY_FIELDS | {('Label', 'm_Text')}))
    assert len(list(units(env, 'x', set()))) == 3
    assert lit_keep('ガチャを引く') == (True, '') and lit_keep('エラーです')[1] == 'dev_log'
    assert lit_keep('剣')[1] == 'single_kanji' and lit_keep('a,b,c')[1] == 'no_jp'
    print('supp_text selftest OK')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['extract', 'noop', 'selftest'])
    ap.add_argument('-p')
    ap.add_argument('--prefix', default='GS', help="sequential id prefix, or 'key' for <CLS>|<file>|<key> ids")
    ap.add_argument('--bundle-dirs', default='model,pc/AssetBundle')
    ap.add_argument('--manifest')
    ap.add_argument('--key-fields', default='', help='extra Class.field lookup-key fields to skip (added to KEY_FIELDS)')
    ap.add_argument('--force', action='store_true')
    a = ap.parse_args()
    if a.cmd == 'selftest':
        return selftest()
    prj = Path(a.p)
    if a.cmd == 'extract':
        if (prj / '30_translation/text/supplement/SUPP_MANIFEST.tsv').exists() and not a.force:
            sys.exit('refuse: SUPP_MANIFEST.tsv exists')
        return extract(prj, a.prefix, a.bundle_dirs.split(','),
                       KEY_FIELDS | {tuple(s.split('.', 1)) for s in a.key_fields.split(',') if s})
    return noop(prj, a.manifest or prj / '30_translation/text/supplement/SUPP_MANIFEST.tsv')


if __name__ == '__main__':
    sys.exit(main())
