import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const titleId = '0100983013C9A000';

function run(script, args) {
  try {
    return { ok: true, out: execFileSync(process.execPath, [path.join(scriptsRoot, script), ...args], { encoding: 'utf8', env: { ...process.env, GT_HASH_CACHE: 'off' } }) };
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

test('NSW split release: tiny parts round-trip, parts-only validation passes, a corrupted part fails', async () => {
  const titleRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nsw-release-split-'));
  try {
    const projectRoot = path.join(titleRoot, '_work', titleId);
    const romfs = path.join(projectRoot, '40_build', 'layeredfs', titleId, 'romfs');
    await fs.mkdir(path.join(romfs, 'sub'), { recursive: true });
    await fs.writeFile(path.join(romfs, 'a.txt'), 'Korean patch '.repeat(50));
    await fs.writeFile(path.join(romfs, 'sub', 'b.bin'), Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 31) & 255)));
    const args = ['--project-root', projectRoot, '--korean-title', '분할 샘플'];
    const releaseRoot = path.join(titleRoot, '_release');
    const zipName = `분할 샘플 - ${titleId}.zip`;

    const created = run('create-nsw-release.mjs', [...args, '--split', '--part-size', '256']);
    assert.ok(created.ok, created.out);
    const zip = await fs.readFile(path.join(releaseRoot, zipName));
    const manifest = JSON.parse(await fs.readFile(path.join(releaseRoot, 'RELEASE_PACKAGE.json'), 'utf8'));
    const { distribution } = manifest;
    assert.equal(distribution.form, 'split');
    assert.equal(distribution.part_size_bytes, 256);
    assert.equal(distribution.parts.length, Math.ceil(zip.length / 256));
    assert.equal(distribution.joined_sha256, manifest.sha256);
    assert.equal(distribution.parts[0].path, `_release/split/${zipName}.001`);
    const joined = Buffer.concat(await Promise.all(distribution.parts.map((part) => fs.readFile(path.join(titleRoot, part.path)))));
    assert.ok(joined.equals(zip), 'parts concatenate to the ZIP');
    const sums = await fs.readFile(path.join(releaseRoot, 'SHA256SUMS.txt'), 'utf8');
    assert.match(sums, new RegExp(`  split/${zipName.replace(/[.]/g, '\\.')}\\.002\\n`));
    assert.match(sums, /^# joined .*: [0-9A-F]{64}  /m);
    assert.match(await fs.readFile(path.join(releaseRoot, 'split', 'SHA256SUMS.txt'), 'utf8'), /\.001\n/);

    // --split-only keeps the ZIP under superseded/; the validator then reads the parts as one virtual ZIP.
    const splitOnly = run('create-nsw-release.mjs', [...args, '--split-only', '--part-size', '256']);
    assert.ok(splitOnly.ok, splitOnly.out);
    await assert.rejects(fs.stat(path.join(releaseRoot, zipName)));
    assert.ok((await fs.readFile(path.join(releaseRoot, 'superseded', zipName))).equals(zip));
    assert.doesNotMatch(await fs.readFile(path.join(releaseRoot, 'SHA256SUMS.txt'), 'utf8'), new RegExp(`^[0-9A-F]{64}  ${zipName}$`, 'm'));
    const validated = run('validate-nsw-release.mjs', args);
    assert.ok(validated.ok, validated.out);
    assert.match(validated.out, new RegExp(`PASS\\t.*\\t${manifest.sha256}\\tentries=2\\tsplit=${distribution.parts.length}`));

    // One flipped byte in a middle part fails closed.
    const part = path.join(titleRoot, distribution.parts[1].path);
    const bytes = await fs.readFile(part);
    bytes[10] ^= 0xff;
    await fs.writeFile(part, bytes);
    const corrupted = run('validate-nsw-release.mjs', args);
    assert.equal(corrupted.ok, false);
    assert.match(corrupted.out, /Split part SHA-256 mismatch/);

    // Even with the manifest hashes rewritten to match, the entry check over the joined stream still fails.
    const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
    distribution.parts[1].sha256 = sha(bytes);
    distribution.joined_sha256 = sha(Buffer.concat(await Promise.all(distribution.parts.map((p) => fs.readFile(path.join(titleRoot, p.path))))));
    await fs.writeFile(path.join(releaseRoot, 'RELEASE_PACKAGE.json'), JSON.stringify(manifest));
    const rehashed = run('validate-nsw-release.mjs', args);
    assert.equal(rehashed.ok, false);
    assert.doesNotMatch(rehashed.out, /PASS/);
  } finally {
    await fs.rm(titleRoot, { recursive: true, force: true });
  }
});
