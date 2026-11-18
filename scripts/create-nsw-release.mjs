#!/usr/bin/env node
import fsp from 'node:fs/promises';
import path from 'node:path';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';
import {
  DEFAULT_SPLIT_PART_SIZE,
  RELEASE_DIR,
  SPLIT_DIR,
  createDeterministicNswZip,
  ensureReleaseRoot,
  fat32ReleaseWarning,
  normalizeTitleId,
  nswReleaseFileName,
  parseByteSize,
  parseNswReleaseFileName,
  resolveNswReleaseNaming,
  sha256File,
  splitRelease,
  supersedeRelease,
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
  // Default "<한국어 제목> - <ID>.zip" (fails closed without a Korean title); "<ID>.zip" only with --legacy-name.
  const { gameName } = await resolveNswReleaseNaming(projectRoot, {
    koreanTitle: option(args, 'korean-title') ?? null,
    legacyName: flag(args, 'legacy-name'),
  });
  const fileName = nswReleaseFileName(gameName, titleId);
  // --split [--part-size 3990MiB]: also publish _release/split/<zip>.NNN; --split-only then moves the ZIP to superseded/.
  const splitOnly = flag(args, 'split-only');
  const split = splitOnly || flag(args, 'split');
  const partSize = parseByteSize(option(args, 'part-size') ?? DEFAULT_SPLIT_PART_SIZE);
  const releaseRoot = await ensureReleaseRoot(projectRoot);
  const outputPath = path.join(releaseRoot, fileName);
  const temporaryPath = path.join(releaseRoot, `tmp-package-${titleId}.zip.tmp`);
  const previousPath = path.join(releaseRoot, `tmp-previous-${titleId}.zip.tmp`);
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
      await supersedeRelease(previousPath, releaseRoot, fileName);
    }
    for (const leftover of leftovers) await supersedeRelease(leftover, releaseRoot);

    const receipt = await validateNswRelease({ titleId, zipPath: outputPath, romfsRoot, exefsRoot, gameName });
    const stats = await fsp.stat(outputPath);
    const manifest = {
      schema_version: 1,
      platform: 'nsw',
      format: 'LayeredFS',
      base_title_id: titleId,
      release_filename: gameName ? 'korean-title' : 'legacy-id',
      korean_title: gameName,
      project_root: `_work/${titleId}`,
      archive_path: `${RELEASE_DIR}/${fileName}`,
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
    let sums = `${receipt.zipSha256}  ${fileName}\n`;
    if (split) {
      const { parts, joinedSha256 } = await splitRelease({ zipPath: outputPath, releaseRoot, zipSha256: receipt.zipSha256, partSize });
      manifest.distribution = {
        form: 'split',
        part_size_bytes: partSize,
        parts: parts.map((part) => ({ path: `${RELEASE_DIR}/${SPLIT_DIR}/${part.name}`, sha256: part.sha256 })),
        joined_sha256: joinedSha256,
      };
      const partLines = (prefix) => parts.map((part) => `${part.sha256}  ${prefix}${part.name}\n`).join('');
      const joinedLine = `# joined (7-Zip/Bandizip: open .001, or concatenate the parts in order): ${joinedSha256}  ${fileName}\n`;
      await atomicText(path.join(releaseRoot, SPLIT_DIR, 'SHA256SUMS.txt'), partLines('') + joinedLine);
      sums = `${splitOnly ? '' : sums}${partLines(`${SPLIT_DIR}/`)}${joinedLine}`;
      if (splitOnly) await supersedeRelease(outputPath, releaseRoot); // kept, never deleted
    }
    await atomicText(path.join(releaseRoot, 'SHA256SUMS.txt'), sums);
    await atomicText(path.join(releaseRoot, 'RELEASE_PACKAGE.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const fat32Warning = await fat32ReleaseWarning(receipt.entries, outputPath);
    if (fat32Warning) process.stderr.write(`WARNING\t${fat32Warning}\n`);
    const splitNote = manifest.distribution ? `\tsplit=${manifest.distribution.parts.length}${splitOnly ? '\tzip=superseded' : ''}` : '';
    process.stdout.write(`PASS\t${outputPath}\t${receipt.zipSha256}\tentries=${receipt.entries.length}\treused=${reused}${splitNote}\n`);
  } finally {
    await fsp.rm(temporaryPath, { force: true });
    await fsp.rm(previousPath, { force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`NSW release packaging failed: ${error.message}\n`);
  process.exitCode = 1;
});
