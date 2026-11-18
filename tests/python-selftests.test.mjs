import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const py = process.env.PYTHON || 'python';

// Shared python tools carry an assert-based `selftest` command; run each isolated (-I) from the repo root.
for (const script of ['scripts/bulk/bulk_tool.py']) {
  test(`${script} selftest`, () => {
    const r = spawnSync(py, ['-I', script, 'selftest'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /selftest ok/);
  });
}
