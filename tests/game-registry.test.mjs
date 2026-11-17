import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkRegistry } from '../scripts/check-game-registry.mjs';

const HDR = 'game_name\tbase_title_id\tupdate_title_id\trelease_folder\tproject_path\tengine_or_format\tstatus';

function fixture(rows, dirs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-registry-'));
  for (const d of dirs) fs.mkdirSync(path.join(root, d), { recursive: true });
  fs.writeFileSync(path.join(root, 'GAME_REGISTRY.tsv'), [HDR, ...rows].join('\n') + '\n');
  return root;
}

test('consistent registry passes', () => {
  const root = fixture([
    'A\t0100000000001000\tunknown\t_complete/A [0100000000001000]\t_work/0100000000001000\tunknown\tcomplete; done',
    'B\t0100000000002000\tunknown\t_working/B\t_work/0100000000002000\tunknown\tText qa_ready',
    'C\t0100000000003000\tunknown\t_waitng/C [0100000000003000]\t_work/0100000000003000\tunknown\twaiting; queued',
    'D\t0100000000004000\tunknown\tD [0100000000004000]\t_work/0100000000004000\tunknown\tremoved; deleted by user',
  ], ['_complete/A [0100000000001000]', '_working/B/_work/0100000000002000', '_waitng/C [0100000000003000]']);
  assert.deepEqual(checkRegistry(root).errors, []);
});

test('stale path, wrong zone status, orphan folder and removed-but-present are errors', () => {
  const root = fixture([
    'A\t0100000000001000\tunknown\tA [0100000000001000]\t_work/0100000000001000\tunknown\tregistered',
    'B\t0100000000002000\tunknown\t_complete/B [0100000000002000]\t_work/0100000000002000\tunknown\tregistered; extraction not started',
    'C\t0100000000003000\tunknown\t_waitng/C [0100000000003000]\t_work/0100000000003000\tunknown\tremoved; gone',
  ], ['_complete/A [0100000000001000]', '_complete/B [0100000000002000]', '_waitng/C [0100000000003000]', '_waitng/E [0100000000005000]']);
  const { errors } = checkRegistry(root);
  assert.ok(errors.some((e) => e.includes('0100000000001000') && e.includes('folder not found')));
  assert.ok(errors.some((e) => e.includes('0100000000002000') && e.includes('expects status complete')));
  assert.ok(errors.some((e) => e.includes('0100000000003000') && e.includes('removed but folder exists')));
  assert.ok(errors.some((e) => e.includes('0100000000005000') && e.includes('not in registry')));
});
