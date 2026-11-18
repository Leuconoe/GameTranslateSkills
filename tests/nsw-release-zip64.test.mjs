import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDeterministicNswZip, sha256File, validateNswRelease } from '../scripts/lib/nsw-release-zip.mjs';

const titleId = '0100983013C9A000';

async function makeRomfs(root) {
  const romfs = path.join(root, 'romfs');
  await fs.mkdir(path.join(romfs, 'sub'), { recursive: true });
  await fs.writeFile(path.join(romfs, 'a.txt'), 'Korean patch '.repeat(50));
  await fs.writeFile(path.join(romfs, 'sub', 'b.bin'), Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 31) & 255)));
  await fs.writeFile(path.join(romfs, 'empty.dat'), '');
  await fs.writeFile(path.join(romfs, 'tiny.dat'), 'tiny');
  return romfs;
}

const pythonCheck = `
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    assert z.testzip() is None
    for i in z.infolist():
        print(f"{i.filename}\\t{i.file_size}\\t{i.extract_version}")
`;

test('NSW release ZIP stays byte-identical below the Zip64 limit and round-trips forced Zip64', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsw-release-zip64-'));
  try {
    const romfs = await makeRomfs(root);
    const sizes = new Map();
    for (const name of ['a.txt', 'empty.dat', 'sub/b.bin', 'tiny.dat']) {
      sizes.set(`atmosphere/contents/${titleId}/romfs/${name}`, (await fs.stat(path.join(romfs, name))).size);
    }

    // Pre-Zip64 writer output for the same input (minus tiny.dat it was pinned without); guards byte identity.
    const classicRoot = path.join(root, 'classic');
    await fs.mkdir(classicRoot);
    await fs.cp(romfs, path.join(classicRoot, 'romfs'), { recursive: true });
    await fs.rm(path.join(classicRoot, 'romfs', 'tiny.dat'));
    const classicZip = path.join(root, 'classic.zip');
    await createDeterministicNswZip({ titleId, romfsRoot: path.join(classicRoot, 'romfs'), outputPath: classicZip });
    assert.equal(await sha256File(classicZip), 'DF6E8A977C4E847547DE99FCB48F8267B25054FBE4648E4D451E4DF239F482F3');
    assert.equal((await fs.readFile(classicZip)).indexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06])), -1);

    // A 64-byte threshold forces Zip64 sizes (local + central extra), Zip64 offsets and the Zip64 EOCD record + locator.
    const zipPath = path.join(root, 'releases', `${titleId}.zip`);
    await fs.mkdir(path.dirname(zipPath));
    await createDeterministicNswZip({ titleId, romfsRoot: romfs, outputPath: zipPath, zip64Threshold: 64 });
    const bytes = await fs.readFile(zipPath);
    assert.notEqual(bytes.indexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06])), -1, 'Zip64 EOCD record');
    assert.notEqual(bytes.indexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07])), -1, 'Zip64 EOCD locator');
    const receipt = await validateNswRelease({ titleId, zipPath, romfsRoot: romfs });
    assert.deepEqual(receipt.entries.map((entry) => [entry.path, entry.size]), [...sizes.entries()]);

    // Independent readers: Python zipfile (CRC via testzip, sizes, version 45) and the system tar listing (bsdtar reads ZIP).
    const python = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-I', '-c', pythonCheck, zipPath], { encoding: 'utf8' });
    if (!python.error) {
      assert.equal(python.status, 0, python.stderr);
      const rows = python.stdout.trim().split(/\r?\n/).map((line) => line.split('\t'));
      assert.deepEqual(rows.map(([name, size]) => [name, Number(size)]), [...sizes.entries()]);
      for (const [name, , version] of rows) assert.equal(version, '45', `${name} needs version 4.5`);
    }
    const tarExe = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'bsdtar';
    const tar = spawnSync(tarExe, ['-tf', zipPath], { encoding: 'utf8' });
    if (!tar.error && tar.status === 0) assert.deepEqual(tar.stdout.trim().split(/\r?\n/), [...sizes.keys()]);

    // A classic EOCD field that disagrees with the Zip64 record is rejected.
    const tampered = Buffer.from(bytes);
    tampered.writeUInt16LE(3, tampered.length - 22 + 10);
    await fs.writeFile(zipPath, tampered);
    await assert.rejects(validateNswRelease({ titleId, zipPath, romfsRoot: romfs }), /disagree/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
