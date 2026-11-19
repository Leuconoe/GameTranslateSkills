import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDeterministicNswZip, createDeterministicZip, nswReleaseFileName, parseNswReleaseFileName, validateNswRelease } from '../scripts/lib/nsw-release-zip.mjs';

test('NSW release accepts one ExeFS main and still validates RomFS-only archives', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsw-release-exefs-'));
  const titleId = '0100983013C9A000';
  try {
    const romfsRoot = path.join(root, 'romfs');
    const exefsRoot = path.join(root, 'exefs');
    const releases = path.join(root, 'releases');
    await fs.mkdir(romfsRoot);
    await fs.mkdir(exefsRoot);
    await fs.mkdir(releases);
    await fs.writeFile(path.join(romfsRoot, 'translated.dat'), 'Korean patch');
    await fs.writeFile(path.join(exefsRoot, 'main'), Buffer.concat([Buffer.from('NSO0'), Buffer.alloc(252)]));
    const zipPath = path.join(releases, `${titleId}.zip`);
    await createDeterministicNswZip({ titleId, romfsRoot, exefsRoot, outputPath: zipPath });
    const receipt = await validateNswRelease({ titleId, zipPath, romfsRoot, exefsRoot });
    assert.deepEqual(receipt.entries.map((entry) => entry.path), [
      `atmosphere/contents/${titleId}/exefs/main`,
      `atmosphere/contents/${titleId}/romfs/translated.dat`,
    ]);
    await fs.writeFile(path.join(exefsRoot, 'main'), Buffer.concat([Buffer.from('NSO0'), Buffer.alloc(253)]));
    await assert.rejects(validateNswRelease({ titleId, zipPath, romfsRoot, exefsRoot }), /mismatch/);
    await fs.rm(path.join(exefsRoot, 'main'));
    await assert.rejects(validateNswRelease({ titleId, zipPath, romfsRoot, exefsRoot }), /mismatch|entry|no patch files/);
    await fs.rmdir(exefsRoot);

    const legacyRoot = path.join(root, 'legacy', 'releases');
    await fs.mkdir(legacyRoot, { recursive: true });
    const legacyZip = path.join(legacyRoot, `${titleId}.zip`);
    await createDeterministicNswZip({ titleId, romfsRoot, outputPath: legacyZip });
    const legacy = await validateNswRelease({ titleId, zipPath: legacyZip, romfsRoot, exefsRoot });
    assert.deepEqual(legacy.entries.map((entry) => entry.path), [`atmosphere/contents/${titleId}/romfs/translated.dat`]);

    // Default expects "<ID>.zip"; a titled name is accepted only when that title is requested.
    const titledZip = path.join(legacyRoot, `Clockwork Rayline - ${titleId}.zip`);
    await fs.copyFile(legacyZip, titledZip);
    await assert.rejects(validateNswRelease({ titleId, zipPath: titledZip, romfsRoot }), /filename must be exactly/);
    await validateNswRelease({ titleId, zipPath: titledZip, romfsRoot, gameName: 'Clockwork Rayline' });
    await assert.rejects(validateNswRelease({ titleId, zipPath: titledZip, romfsRoot, gameName: 'Other' }), /filename must be exactly/);
    assert.equal(nswReleaseFileName('Bluey’s Quest: Gold Pen? [0100EF802631A000]', '0100EF802631A000'), 'Bluey’s Quest Gold Pen - 0100EF802631A000.zip');
    assert.equal(parseNswReleaseFileName('A  B - 0100EF802631A000.zip', '0100EF802631A000'), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('NSW release rejects a double-nested overlay (romfs/romfs/...) in the packager and the validator', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsw-release-nested-'));
  const titleId = '0100983013C9A000';
  const contentRoot = `atmosphere/contents/${titleId}`;
  try {
    const releases = path.join(root, 'releases');
    const romfsRoot = path.join(root, 'romfs');
    await fs.mkdir(path.join(romfsRoot, 'romfs', 'data'), { recursive: true });
    await fs.mkdir(releases);
    const payload = path.join(romfsRoot, 'romfs', 'data', 'foo.bin');
    await fs.writeFile(payload, 'Korean patch');
    const zipPath = path.join(releases, `${titleId}.zip`);
    await assert.rejects(createDeterministicNswZip({ titleId, romfsRoot, outputPath: zipPath }), /Double-nested.*belong directly in/);

    // Hand-built ZIPs: each bad layout must fail validation even without a source tree to compare against.
    for (const [bad, pattern] of [
      [`${contentRoot}/romfs/romfs/data/foo.bin`, /Repeated LayeredFS layout segment/],
      [`${contentRoot}/romfs/EXEFS/main`, /Repeated LayeredFS layout segment/],
      [`${contentRoot}/exefs/romfs/data/foo.bin`, /Repeated LayeredFS layout segment/],
      [`${contentRoot}/exefs/exefs/main`, /Repeated LayeredFS layout segment/],
      [`${contentRoot}/cheats/foo.txt`, /must use/],
    ]) {
      await fs.rm(zipPath, { force: true });
      await createDeterministicZip({ files: [{ absolutePath: payload, archivePath: bad }], outputPath: zipPath });
      await assert.rejects(validateNswRelease({ titleId, zipPath, exefsRoot: path.join(root, 'exefs') }), pattern, bad);
    }

    // The same payload, flattened to the overlay root, packages and validates.
    await fs.rename(path.join(romfsRoot, 'romfs', 'data'), path.join(romfsRoot, 'data'));
    await fs.rmdir(path.join(romfsRoot, 'romfs'));
    await fs.rm(zipPath, { force: true });
    await createDeterministicNswZip({ titleId, romfsRoot, outputPath: zipPath });
    const receipt = await validateNswRelease({ titleId, zipPath, romfsRoot });
    assert.deepEqual(receipt.entries.map((entry) => entry.path), [`${contentRoot}/romfs/data/foo.bin`]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
