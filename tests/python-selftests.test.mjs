import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const py = process.env.PYTHON || 'python';

// Shared python tools carry an assert-based `selftest` command; run each isolated (-I) from the repo root.
for (const script of ['scripts/bulk/bulk_tool.py', 'scripts/lib/hash_cache.py', 'scripts/fonts/ttf_append.py', 'scripts/fonts/glyph_render.py', 'engines/m2-psb/tools/m2font.py',
  'engines/unity/tools/utage_text.py', 'engines/unity/tools/supp_text.py', 'engines/unity/tools/unity_font.py', 'engines/unity/tools/meta_literals.py', 'engines/unity/tools/unity_adapter.py', 'engines/unity/tools/unity_image.py',
  'engines/m2-psb/tools/psb.py', 'engines/m2-psb/tools/m2arc.py', 'engines/m2-psb/tools/m2_adapter.py', 'engines/m2-psb/tools/m2img.py']) {
  test(`${script} selftest`, () => {
    const r = spawnSync(py, ['-I', script, 'selftest'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /selftest ok/i);
  });
}
