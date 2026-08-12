#!/usr/bin/env node
import fsp from 'node:fs/promises';
import path from 'node:path';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';
import {
  createDeterministicNswZip,
  normalizeTitleId,
  sha256File,
  validateNswRelease,
} from './lib/nsw-release-zip.mjs';

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function atomicText(target, content) {
  const temporary = path.join(path.dirname(target), `tmp-${path.basename(target)}.tmp`);
  await fsp.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
  const handle = await fsp.open(temporary, 'r+');
  try { await handle.sync(); } finally { await handle.close(); }
  await fsp.rm(target, { force: true });
  await fsp.rename(temporary, target);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(requiredOption(args, 'project-root'));
  const projectId = normalizeTitleId(path.basename(projectRoot));
  const titleId = normalizeTitleId(option(args, 'title-id') ?? projectId);
  if (projectId !== titleId) throw new Error(`Project folder Title ID ${projectId} does not match requested ${titleId}`);

  const canonicalRomfs = path.join(projectRoot, '40_build', 'layeredfs', titleId, 'romfs');
  const romfsRoot = path.resolve(option(args, 'romfs-root') ?? canonicalRomfs);
  if (!samePath(romfsRoot, canonicalRomfs)) {
    throw new Error(`NSW release input must be canonical: ${canonicalRomfs}`);
  }
  const releaseRoot = path.join(projectRoot, '40_build', 'releases');
  const outputPath = path.join(releaseRoot, `${titleId}.zip`);
  const temporaryPath = path.join(releaseRoot, `tmp-package-${titleId}.zip.tmp`);
  const previousPath = path.join(releaseRoot, `tmp-previous-${titleId}.zip.tmp`);
  await fsp.mkdir(releaseRoot, { recursive: true });
  await fsp.rm(temporaryPath, { force: true });
  await fsp.rm(previousPath, { force: true });

  try {
    await createDeterministicNswZip({ titleId, romfsRoot, outputPath: temporaryPath });
    const temporaryReceipt = await validateNswRelease({
      titleId,
      zipPath: temporaryPath,
      romfsRoot,
      allowTemporaryName: true,
    });

    let reused = false;
    try {
      const existingHash = await sha256File(outputPath);
      if (existingHash === temporaryReceipt.zipSha256) {
        await fsp.rm(temporaryPath);
        reused = true;
      } else if (!flag(args, 'replace')) {
        throw new Error(`Canonical release already exists with different bytes: ${outputPath}; rerun with --replace after reviewing it`);
      } else {
        await fsp.rename(outputPath, previousPath);
        try {
          await fsp.rename(temporaryPath, outputPath);
        } catch (error) {
          await fsp.rename(previousPath, outputPath);
          throw error;
        }
        await fsp.rm(previousPath);
      }
    } catch (error) {
      if (error?.code === 'ENOENT') {
        await fsp.rename(temporaryPath, outputPath);
      } else {
        throw error;
      }
    }

    const receipt = await validateNswRelease({ titleId, zipPath: outputPath, romfsRoot });
    const stats = await fsp.stat(outputPath);
    const manifest = {
      schema_version: 1,
      platform: 'nsw',
      format: 'LayeredFS',
      base_title_id: titleId,
      archive_path: `40_build/releases/${titleId}.zip`,
      archive_root: `${titleId}/romfs/`,
      source_romfs: `40_build/layeredfs/${titleId}/romfs`,
      entry_count: receipt.entries.length,
      size_bytes: stats.size,
      sha256: receipt.zipSha256,
      deterministic_timestamp: '1980-01-01T00:00:00Z',
      reused,
      entries: receipt.entries,
    };
    await atomicText(path.join(releaseRoot, 'SHA256SUMS.txt'), `${receipt.zipSha256}  ${titleId}.zip\n`);
    await atomicText(path.join(releaseRoot, 'RELEASE_PACKAGE.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`PASS\t${outputPath}\t${receipt.zipSha256}\tentries=${receipt.entries.length}\treused=${reused}\n`);
  } finally {
    await fsp.rm(temporaryPath, { force: true });
    await fsp.rm(previousPath, { force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`NSW release packaging failed: ${error.message}\n`);
  process.exitCode = 1;
});
