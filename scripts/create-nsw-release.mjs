#!/usr/bin/env node
import fsp from 'node:fs/promises';
import path from 'node:path';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';
import {
  createDeterministicNswZip,
  normalizeTitleId,
  nswReleaseFileName,
  parseNswReleaseFileName,
  resolveNswGameName,
  sha256File,
  validateNswRelease,
} from './lib/nsw-release-zip.mjs';

async function hashOrNull(target) {
  try {
    return await sha256File(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

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
  const canonicalExefs = path.join(projectRoot, '40_build', 'layeredfs', titleId, 'exefs');
  const romfsRoot = path.resolve(option(args, 'romfs-root') ?? canonicalRomfs);
  const exefsRoot = path.resolve(option(args, 'exefs-root') ?? canonicalExefs);
  if (!samePath(romfsRoot, canonicalRomfs)) {
    throw new Error(`NSW release input must be canonical: ${canonicalRomfs}`);
  }
  if (!samePath(exefsRoot, canonicalExefs)) {
    throw new Error(`NSW ExeFS release input must be canonical: ${canonicalExefs}`);
  }
  const gameName = await resolveNswGameName(projectRoot, option(args, 'game-name'));
  if (!gameName) {
    throw new Error('NSW release game name is unknown: pass --game-name or add "- Game name: `<title>`" to PROJECT.md');
  }
  const fileName = nswReleaseFileName(gameName, titleId);
  const releaseRoot = path.join(projectRoot, '40_build', 'releases');
  const outputPath = path.join(releaseRoot, fileName);
  const temporaryPath = path.join(releaseRoot, `tmp-package-${titleId}.zip.tmp`);
  const previousPath = path.join(releaseRoot, `tmp-previous-${titleId}.zip.tmp`);
  await fsp.mkdir(releaseRoot, { recursive: true });
  await fsp.rm(temporaryPath, { force: true });
  await fsp.rm(previousPath, { force: true });

  try {
    await createDeterministicNswZip({ titleId, romfsRoot, exefsRoot, outputPath: temporaryPath });
    const temporaryReceipt = await validateNswRelease({
      titleId,
      zipPath: temporaryPath,
      romfsRoot,
      exefsRoot,
      allowTemporaryName: true,
    });
    const newHash = temporaryReceipt.zipSha256;

    // Release ZIPs for this Title ID under another name: the legacy "<ID>.zip" or "<other title> - <ID>.zip".
    const otherNames = (await fsp.readdir(releaseRoot)).filter((name) =>
      name !== fileName && (name.toUpperCase() === `${titleId}.ZIP` || parseNswReleaseFileName(name, titleId)));
    const currentHash = await hashOrNull(outputPath);
    let renameFrom = null;
    if (currentHash === null && otherNames.length === 1
      && await sha256File(path.join(releaseRoot, otherNames[0])) === newHash) {
      renameFrom = path.join(releaseRoot, otherNames[0]);
    }
    const leftovers = otherNames.map((name) => path.join(releaseRoot, name)).filter((p) => p !== renameFrom);
    const conflicts = [...(currentHash !== null && currentHash !== newHash ? [outputPath] : []), ...leftovers];
    if (conflicts.length && !flag(args, 'replace')) {
      throw new Error(`Canonical release already exists with different bytes: ${conflicts.join(', ')}; rerun with --replace after reviewing it`);
    }

    let reused = false;
    if (currentHash === newHash) {
      await fsp.rm(temporaryPath);
      reused = true;
    } else if (renameFrom) {
      await fsp.rename(renameFrom, outputPath);
      await fsp.rm(temporaryPath);
      reused = true;
    } else if (currentHash === null) {
      await fsp.rename(temporaryPath, outputPath);
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
    for (const leftover of leftovers) await fsp.rm(leftover);

    const receipt = await validateNswRelease({ titleId, zipPath: outputPath, romfsRoot, exefsRoot, gameName });
    const stats = await fsp.stat(outputPath);
    const manifest = {
      schema_version: 1,
      platform: 'nsw',
      format: 'LayeredFS',
      base_title_id: titleId,
      game_name: gameName,
      archive_path: `40_build/releases/${fileName}`,
      archive_root: `atmosphere/contents/${titleId}/romfs/`,
      source_romfs: `40_build/layeredfs/${titleId}/romfs`,
      ...(receipt.entries.some((entry) => entry.path.startsWith(`atmosphere/contents/${titleId}/exefs/`)) ? {
        exefs_root: `atmosphere/contents/${titleId}/exefs/`,
        source_exefs: `40_build/layeredfs/${titleId}/exefs`,
      } : {}),
      entry_count: receipt.entries.length,
      size_bytes: stats.size,
      sha256: receipt.zipSha256,
      deterministic_timestamp: '1980-01-01T00:00:00Z',
      reused,
      entries: receipt.entries,
    };
    await atomicText(path.join(releaseRoot, 'SHA256SUMS.txt'), `${receipt.zipSha256}  ${fileName}\n`);
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
