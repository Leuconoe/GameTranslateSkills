"""Shared Eden-MCP tooling for runtime QA (one file, four subcommands). Run with the eden-mcp venv python:
  PY=D:\\workspace\\____personal____\\eden-mcp\\.venv\\Scripts\\python.exe

  broker  <workdir> [log]                      long-lived eden-mcp stdio client; serves <workdir>/q -> <workdir>/r
  call    <workdir> <tool> <json|@file> [timeout_s]   enqueue one MCP call, wait, print "<id> <result json (truncated)>"
  step    <workdir> <sid> <capdir> <name> [ops...]    input ops then a screenshot -> <capdir>/<NN>_<name>.png
          ops: A B X Y UP DOWN LEFT RIGHT PLUS MINUS L R ZL ZR | hBTN (hold 1 s) | wNNNN (wait ms) | tX,Y (touch, 1920x1080)
  publish <tid> <sid> <candidate_dir> <prefix> <tag> <retire_dir>
          candidate_dir holds romfs/ and optionally exefs/. Real copies into <load>/<tid>/.staging_<name>, hash-checked,
          every other entry for this TID moved to <retire_dir>, then an atomic rename. Asserts exactly one entry. No deletes.

Env overrides: EDEN_MCP_EXE, EDEN_CONFIG_FILE, EDEN_SESSIONS_ROOT, EDEN_MAX_SESSIONS (default 8), HOLD (button ms).
The broker writes <workdir>/r/READY.json when connected. Stop the broker with: call <workdir> __quit__ {}.
Stop a game with eden_stop (not eden_stop_session) so the session stays registered.
"""
import asyncio, base64, hashlib, json, os, shutil, sys, time
from pathlib import Path

EXE = os.environ.get('EDEN_MCP_EXE', r'D:\workspace\____personal____\eden-mcp\.venv\Scripts\eden-mcp.exe')
CONFIG = os.environ.get('EDEN_CONFIG_FILE', r'E:\NSW\_tools\Eden\mcp-v0.4.0\eden-mcp.toml')
SESSIONS = Path(os.environ.get('EDEN_SESSIONS_ROOT', r'E:\NSW\_tools\Eden\mcp-v0.4.0\sessions'))
BTN = {'UP': 'DPadUp', 'DOWN': 'DPadDown', 'LEFT': 'DPadLeft', 'RIGHT': 'DPadRight', 'PLUS': 'Plus', 'MINUS': 'Minus'}


def broker(workdir, log=None):
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    d = Path(workdir); q, r = d / 'q', d / 'r'; q.mkdir(parents=True, exist_ok=True); r.mkdir(exist_ok=True)
    logf = open(log or d / 'broker.log', 'a', encoding='utf-8', buffering=1)
    sys.stdout = sys.stderr = logf
    env = dict(os.environ, EDEN_CONFIG_FILE=CONFIG, EDEN_MAX_SESSIONS=os.environ.get('EDEN_MAX_SESSIONS', '8'))

    async def main():
        async with stdio_client(StdioServerParameters(command=EXE, args=[], env=env), errlog=logf) as (rd, wr):
            async with ClientSession(rd, wr) as s:
                await s.initialize()
                tools = (await s.list_tools()).tools
                (r / 'READY.json').write_text(json.dumps({t.name: t.inputSchema for t in tools}, indent=1))
                while True:
                    for f in sorted(q.glob('*.json')):
                        n = f.stem; req = json.loads(f.read_text(encoding='utf-8'))
                        f.replace(q / f'{n}.taken')  # keep the request (no deletes); never re-read
                        if req['tool'] == '__quit__':
                            return
                        try:
                            res = await s.call_tool(req['tool'], req.get('args', {}))
                            out = dict(isError=res.isError, text=[], images=[])
                            for k, c in enumerate(res.content):
                                if c.type == 'text': out['text'].append(c.text)
                                elif c.type == 'image':
                                    p = r / f'{n}_{k}.png'; p.write_bytes(base64.b64decode(c.data)); out['images'].append(str(p))
                            if res.structuredContent is not None: out['structured'] = res.structuredContent
                        except Exception as e:
                            out = dict(isError=True, exception=repr(e))
                        tmp = r / f'{n}.tmp'; tmp.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8'); tmp.replace(r / f'{n}.json')
                    await asyncio.sleep(0.2)
    asyncio.run(main())


def call(workdir, tool, args, timeout=300):
    d = Path(workdir); q, r = d / 'q', d / 'r'
    n = f'{time.time_ns():020d}'
    (q / f'{n}.tmp').write_text(json.dumps(dict(tool=tool, args=args)), encoding='utf-8'); (q / f'{n}.tmp').replace(q / f'{n}.json')
    if tool == '__quit__':
        return n, {}
    dl = time.time() + timeout
    while not (r / f'{n}.json').exists():
        if time.time() > dl: raise TimeoutError(f'timeout waiting {n}')
        time.sleep(0.3)
    return n, json.loads((r / f'{n}.json').read_text(encoding='utf-8'))


def ops_to_steps(ops, hold_ms=90):
    steps = []
    for o in ops:
        if o.startswith('w') and o[1:].isdigit(): steps.append(dict(op='wait', duration_ms=int(o[1:])))
        elif o.startswith('t') and ',' in o:
            x, y = map(int, o[1:].split(',')); steps.append(dict(op='touch', x=x, y=y, action='tap', source_width=1920, source_height=1080))
        elif o.startswith('h') and len(o) > 1:
            steps += [dict(op='button', button=BTN.get(o[1:], o[1:]), action='tap', hold_ms=1000), dict(op='wait', duration_ms=700)]
        else:
            steps += [dict(op='button', button=BTN.get(o, o), action='tap', hold_ms=hold_ms), dict(op='wait', duration_ms=700)]
    return steps


def step(workdir, sid, capdir, name, ops):
    steps = ops_to_steps(ops, int(os.environ.get('HOLD', '90')))
    if steps:
        _, res = call(workdir, 'eden_run_input_script', dict(session_id=sid, steps=steps))
        if res.get('isError'): sys.exit(f'INPUT ERROR {json.dumps(res)[:800]}')
    _, shot = call(workdir, 'eden_take_screenshot', dict(session_id=sid))
    if shot.get('isError') or not shot.get('images'): sys.exit(f'SHOT ERROR {json.dumps(shot)[:800]}')
    c = Path(capdir); c.mkdir(parents=True, exist_ok=True); k = len(list(c.glob('*.png'))) + 1
    dst = c / f'{k:02d}_{name}.png'; shutil.copyfile(shot['images'][0], dst)
    with open(Path(workdir) / 'OPERATIONS.jsonl', 'a', encoding='utf-8') as f:
        f.write(json.dumps(dict(t=time.strftime('%Y-%m-%dT%H:%M:%S'), capture=str(dst), ops=ops), ensure_ascii=False) + '\n')
    print(dst)


def _sha(p):
    with open(p, 'rb') as f: return hashlib.file_digest(f, 'sha256').hexdigest()


def _tree(root):
    return {p.relative_to(root).as_posix(): _sha(p) for p in sorted(Path(root).rglob('*')) if p.is_file()}


def publish(tid, sid, candidate, prefix, tag, retire_dir):
    src = Path(candidate); parts = [x for x in ('romfs', 'exefs') if (src / x).is_dir()]
    assert 'romfs' in parts or 'exefs' in parts, 'candidate needs romfs/ or exefs/'
    man = {f'{x}/{k}': v for x in parts for k, v in _tree(src / x).items()}
    th = hashlib.sha256(''.join(f'{k}\t{v}\n' for k, v in sorted(man.items())).encode()).hexdigest()
    name = f'{prefix}_{tag}_{th[:8]}'
    load = SESSIONS / sid / 'user' / 'load' / tid; load.mkdir(parents=True, exist_ok=True)
    assert not (load / name).exists(), f'already published: {name}'
    stg = load / f'.staging_{name}'
    for x in parts: shutil.copytree(src / x, stg / x)
    assert {f'{x}/{k}': v for x in parts for k, v in _tree(stg / x).items()} == man, 'staged copy hash mismatch'
    retired = []
    for e in load.iterdir():
        if e.name != stg.name:
            dst = Path(retire_dir) / f'{time.strftime("%Y%m%d_%H%M%S")}_{e.name}'; dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(e), str(dst)); retired.append(str(dst))
    stg.rename(load / name)
    assert [e.name for e in load.iterdir()] == [name]
    rec = dict(t=time.strftime('%Y-%m-%dT%H:%M:%S'), tid=tid, sid=sid, src=str(src), tree_sha256=th, files=len(man),
               entry=str(load / name), retired=retired)
    print(json.dumps(rec, ensure_ascii=False))
    return rec


if __name__ == '__main__':
    cmd, a = sys.argv[1], sys.argv[2:]
    if cmd == 'broker': broker(*a[:2])
    elif cmd == 'call':
        arg = a[2] if len(a) > 2 else '{}'
        args = json.loads(Path(arg[1:]).read_text(encoding='utf-8')) if arg.startswith('@') else json.loads(arg)
        n, res = call(a[0], a[1], args, float(a[3]) if len(a) > 3 else 300)
        sys.stdout.reconfigure(encoding='utf-8'); print(n, json.dumps(res, ensure_ascii=False)[:6000])
    elif cmd == 'step': step(a[0], a[1], a[2], a[3], a[4:])
    elif cmd == 'publish': publish(*a[:6])
    else: sys.exit(__doc__)
