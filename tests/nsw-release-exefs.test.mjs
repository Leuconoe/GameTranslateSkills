import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDeterministicNswZip, validateNswRelease } from '../scripts/lib/nsw-release-zip.mjs';

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
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
