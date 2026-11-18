import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cachedSha256 } from '../scripts/lib/hash-cache.mjs';
import { compare, parseFsTree } from '../scripts/nsw-romfs-verify.mjs';
import { titleStatus } from '../scripts/project-status.mjs';
import { moveTitle } from '../scripts/title-move.mjs';

const HDR = 'game_name\tbase_title_id\tupdate_title_id\trelease_folder\tproject_path\tengine_or_format\tstatus';
const TID = '0100AAAA00000000';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-util-'));
  const work = path.join(root, '_working', 'Game [0100AAAA00000000][JP]', '_work', TID);
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(path.join(root, '_complete'));
  fs.writeFileSync(path.join(root, 'GAME_REGISTRY.tsv'), `﻿${HDR}\r\nGame\t${TID}\tunknown\t_working/Game [0100AAAA00000000][JP]\t_work/${TID}\tunity\tstarted\r\n`);
  return { root, work };
}

test('title:move renames within the volume, rewrites the row with LF, refuses bad status/destination', () => {
  const { root } = fixture();
  assert.throws(() => moveTitle({ root, tid: TID, to: '_complete' }), /expects status complete/);
  assert.throws(() => moveTitle({ root, tid: TID, to: '_nowhere', status: 'complete' }), /--to must be/);
  const dry = moveTitle({ root, tid: TID, to: '_complete', status: 'complete', dryRun: true });
  assert.match(dry.plan, /-> _complete\/Game/);
  assert.ok(fs.existsSync(path.join(root, '_working', 'Game [0100AAAA00000000][JP]')));
  const r = moveTitle({ root, tid: TID, to: '_complete', status: 'complete' });
  assert.deepEqual(r.errors, []);
  assert.ok(fs.existsSync(path.join(root, '_complete', 'Game [0100AAAA00000000][JP]', '_work', TID)));
  const reg = fs.readFileSync(path.join(root, 'GAME_REGISTRY.tsv'), 'utf8');
  assert.ok(reg.startsWith('﻿') && !reg.includes('\r'));
  assert.match(reg, /\t_complete\/Game \[0100AAAA00000000\]\[JP\]\t_work\/0100AAAA00000000\tunity\tcomplete\n$/);
  fs.mkdirSync(path.join(root, '_working', 'Game [0100AAAA00000000][JP]'));
  assert.throws(() => moveTitle({ root, tid: TID, to: '_working', status: 'started' }), /destination exists/);
});

test('project:status reports translated rows, resume point, build, Eden verdict and zip hash8', async () => {
  const { root, work } = fixture();
  const t = path.join(work, '30_translation');
  fs.mkdirSync(path.join(t, 'text', 'batches', 'bulk', 'out'), { recursive: true });
  fs.mkdirSync(path.join(t, 'exports', 'source'), { recursive: true });
  fs.writeFileSync(path.join(t, 'text', 'translation_manifest.tsv'), 'id\tja\ttarget_ko\tstatus\tnotes\nA\tx\tk\ttranslated\t\nB\ty\t\tnew\t\nC\tz\t\tnew\t\n');
  fs.writeFileSync(path.join(t, 'exports', 'source', 'bulk_source.txt'), '1\tx\n2\ty\n3\tz\n');
  fs.writeFileSync(path.join(t, 'text', 'batches', 'bulk', 'out', 'P000001.tsv'), '1\tk\n');
  fs.writeFileSync(path.join(t, 'text', 'batches', 'bulk', 'out', 'PZ_dupfill.tsv'), '2\tk\n');
  fs.mkdirSync(path.join(work, '40_build', 'integrated_r2'), { recursive: true });
  fs.mkdirSync(path.join(work, '50_test'));
  fs.writeFileSync(path.join(work, '50_test', 'EDEN_QA_r2.md'), '**Verdict: 완수 (brief scope).**\n');
  const rel = path.join(root, '_working', 'Game [0100AAAA00000000][JP]', '_release');
  fs.mkdirSync(rel);
  fs.writeFileSync(path.join(rel, `게임 - ${TID}.zip`), 'abc');
  process.env.GT_HASH_CACHE = path.join(root, 'cache.json');
  const row = { base_title_id: TID, status: 'started', release_folder: '_working/Game [0100AAAA00000000][JP]', project_path: `_work/${TID}` };
  assert.equal(await titleStatus(root, row),
    `${TID} | started | tr 1/3 next n 2 (2/3 left) | build integrated_r2 | eden 완수 (EDEN_QA_r2.md) | zip 게임 - ${TID}.zip BA7816BF`);
});

test('hash cache serves path+size+mtime hits and re-hashes changed files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-hash-'));
  process.env.GT_HASH_CACHE = path.join(dir, 'c.json');
  const f = path.join(dir, 'a.bin');
  fs.writeFileSync(f, 'abc');
  assert.equal(await cachedSha256(f), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const cache = JSON.parse(fs.readFileSync(process.env.GT_HASH_CACHE, 'utf8'));
  const [key] = Object.keys(cache);
  cache[key] = 'f'.repeat(64);
  fs.writeFileSync(process.env.GT_HASH_CACHE, JSON.stringify(cache));
  assert.equal(await cachedSha256(f), 'f'.repeat(64));
  fs.writeFileSync(f, 'abcd');
  assert.notEqual(await cachedSha256(f), 'f'.repeat(64));
});

test('nsw:romfs-verify parses the nstool tree of one partition and diffs both ways', () => {
  const tree = '[NCA Header]\n  Size: 0x1\n[ContentArchive/Tree]\n program:/\n  0/\n   main\n  1/\n   a.bin\n   movie/\n    op.mp4\n   b.bin\n  2/\n   logo.png\n';
  const files = parseFsTree(tree, '1');
  assert.deepEqual(files, ['a.bin', 'movie/op.mp4', 'b.bin']);
  assert.deepEqual(compare(files, ['a.bin', 'b.bin', 'x.bin']), { missing: ['movie/op.mp4'], extra: ['x.bin'] });
});
