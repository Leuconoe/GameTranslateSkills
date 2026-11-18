"""meta_literals.py - IL2CPP global-metadata.dat (v29) string-literal extract / no-op / inject / verify.

  python -I meta_literals.py extract <meta> <out.tsv>             all literals: index<TAB>bytes<TAB>text(escaped)
  python -I meta_literals.py noop <meta>                           empty and identity change sets -> byte-identical
  python -I meta_literals.py inject <meta> <manifest> <out_file> [safety.tsv]
  python -I meta_literals.py verify <meta> <manifest> <out_file> [safety.tsv]
  python -I meta_literals.py selftest
Manifest rows: source_key `lit:<i>`, non-empty target_ko; every literal index holding the same text gets the value.
With safety.tsv (columns id, verdict) only ids whose verdict == safe are applied (usage review is per title).

Format (v29): header int32s; [8]=stringLiteralOffset [12]=stringLiteralSize (8 bytes/entry: uint32 length,
uint32 dataIndex) [16]=stringLiteralDataOffset [20]=stringLiteralDataSize; UTF-8 without NUL. Injection keeps the old
data region, appends a new (8-aligned) blob = old blob + new strings at file end, repoints the header and rewrites only
the entries of changed literals: no length limit, literal indices never change, unchanged entries keep exact bytes.
An empty change set returns the input bytes unchanged.
"""
import collections
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script dir
MAGIC = 0xFAB11BAF
META_REL = 'Data/Managed/Metadata/global-metadata.dat'


def header(b):
    magic, ver, lo, ls, do, ds = struct.unpack_from('<IiIIII', b, 0)
    assert magic == MAGIC and ver == 29, (hex(magic), ver)
    assert ls % 8 == 0 and lo + ls <= len(b) and do + ds <= len(b)
    return lo, ls // 8, do, ds


def literals(b):
    lo, n, do, ds = header(b)
    out = []
    for i in range(n):
        ln, idx = struct.unpack_from('<II', b, lo + i * 8)
        assert idx + ln <= ds, (i, idx, ln, ds)
        out.append(bytes(b[do + idx:do + idx + ln]))
    return out


def texts(b):
    out = []
    for r in literals(b):
        try:
            out.append(r.decode('utf-8'))
        except UnicodeDecodeError:
            out.append(None)
    return out


def inject(b, changes):
    """changes {index: str} -> new bytes (input bytes unchanged if nothing really changes)."""
    lo, n, do, ds = header(b)
    old = literals(b)
    enc = {i: s.encode('utf-8') for i, s in changes.items()}
    assert all(0 <= i < n for i in enc)
    enc = {i: e for i, e in enc.items() if e != old[i]}
    if not enc:
        return bytes(b)
    out = bytearray(b)
    out += b'\0' * (-len(out) % 8)
    new_do = len(out)
    blob = bytearray(b[do:do + ds])
    for i in sorted(enc):
        struct.pack_into('<II', out, lo + i * 8, len(enc[i]), len(blob))
        blob += enc[i]
    out += blob
    assert len(out) < 2 ** 31
    struct.pack_into('<II', out, 16, new_do, len(blob))
    return bytes(out)


def check(orig, new, changes):
    """Independent re-parse: (bad indices, stray byte offsets). Inside the original range only the header data
    offset/size and the table entries of changed literals may differ."""
    exp = texts(orig)
    for i, s in changes.items():
        exp[i] = s
    got = texts(new)
    bad = [i for i in range(len(exp)) if exp[i] != got[i]]
    if len(new) < len(orig):
        return bad, ['truncated']
    lo = header(orig)[0]
    allowed = set(range(16, 24))
    for i in changes:
        allowed |= set(range(lo + i * 8, lo + i * 8 + 8))
    stray = [k for k, (x, y) in enumerate(zip(orig, new)) if x != y and k not in allowed]
    if not changes and len(new) != len(orig):
        stray.append('grown')
    return bad, stray


def safe_ids(path):
    if not path:
        return None
    from ucommon import read_manifest
    return {r['id'] for r in read_manifest(path) if r.get('verdict') == 'safe'}


def changes_from(rows, b, allow=None):
    """{index: value} from manifest literal rows (row['value'] if present, else target_ko)."""
    from ucommon import has_esc, unesc
    tx = texts(b)
    by_text = collections.defaultdict(list)
    for i, s in enumerate(tx):
        by_text[s].append(i)
    ch, stats = {}, collections.Counter()
    for r in rows:
        if not r.get('source_key', '').startswith('lit:'):
            continue
        v = r.get('value', r.get('target_ko', ''))
        ja = unesc(r['ja']) if has_esc(r) else r['ja']
        v = unesc(v) if has_esc(r) else v
        if not v or v == ja:
            stats['unchanged'] += 1
            continue
        if allow is not None and r['id'] not in allow:
            stats['skipped_not_safe'] += 1
            continue
        i0 = int(r['source_key'][4:])
        assert tx[i0] == ja, f'source identity mismatch at lit:{i0}'
        for i in by_text[ja]:
            ch[i] = v
        stats['rows_applied'] += 1
    return ch, stats


def esc_cell(s):
    return s.replace('\\', '\\\\').replace('\n', '\\n').replace('\r', '\\r').replace('\t', '\\t')


def main(a):
    cmd = a[0] if a else ''
    if cmd == 'selftest':
        return selftest()
    if cmd == 'extract':
        b = Path(a[1]).read_bytes()
        tx = texts(b)
        with open(a[2], 'w', encoding='utf-8', newline='\n') as f:
            f.write('index\tbytes\ttext\n')
            for i, (raw, s) in enumerate(zip(literals(b), tx)):
                f.write(f'{i}\t{len(raw)}\t{esc_cell(s) if s is not None else "<non-utf8:" + raw.hex() + ">"}\n')
        return print(f'extract n={len(tx)} non_utf8={tx.count(None)} -> {a[2]}')
    if cmd == 'noop':
        b = Path(a[1]).read_bytes()
        ok = inject(b, {}) == b and inject(b, {i: s for i, s in enumerate(texts(b)) if s is not None}) == b
        print(f'noop identical={ok}')
        return 0 if ok else 1
    if cmd in ('inject', 'verify'):
        from ucommon import read_manifest, w_atomic
        b = Path(a[1]).read_bytes()
        ch, stats = changes_from(read_manifest(a[2]), b, safe_ids(a[4] if len(a) > 4 else None))
        out = Path(a[3])
        if cmd == 'inject':
            new = inject(b, ch)
            bad, stray = check(b, new, ch)
            assert not bad and not stray, (bad[:5], stray[:5])
            if new != b:
                w_atomic(out, new)
            return print(f'inject changed={len(ch)} stats={dict(stats)} written={new != b}')
        bad, stray = check(b, out.read_bytes() if out.exists() else b, ch)
        print(f'verify changed={len(ch)} mismatch={len(bad)} stray={len(stray)}')
        return 1 if bad or stray else 0
    sys.exit(__doc__)


def synth(strs):
    """Minimal v29 metadata image: header, literal table, data blob."""
    data = b''.join(s.encode('utf-8') for s in strs)
    lo = 32
    table, pos = b'', 0
    for s in strs:
        e = s.encode('utf-8')
        table += struct.pack('<II', len(e), pos)
        pos += len(e)
    do = lo + len(table)
    return struct.pack('<IiIIII', MAGIC, 29, lo, len(table), do, len(data)) + b'\0' * 8 + table + data


def selftest():
    b = synth(['はい', 'OK', 'はい', 'いいえ'])
    assert texts(b) == ['はい', 'OK', 'はい', 'いいえ']
    assert inject(b, {}) == b and inject(b, {0: 'はい'}) == b
    rows = [{'id': 'x1', 'source_key': 'lit:0', 'ja': 'はい', 'value': '예', 'notes': ''},
            {'id': 'x2', 'source_key': 'lit:3', 'ja': 'いいえ', 'value': '아니요\\n!', 'notes': 'il2cpp_literal;esc'}]
    ch, st = changes_from(rows, b)
    assert ch == {0: '예', 2: '예', 3: '아니요\n!'}, ch
    new = inject(b, ch)
    assert texts(new) == ['예', 'OK', '예', '아니요\n!'] and new[:len(b)] != b
    assert check(b, new, ch) == ([], [])
    assert check(b, inject(b, {1: 'NG'}), ch)[0] == [0, 1, 2, 3]
    assert changes_from(rows, b, allow={'x2'})[0] == {3: '아니요\n!'}
    print('meta_literals selftest OK')


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
