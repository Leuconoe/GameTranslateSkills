#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';
import { inspectProjectRoot } from './lib/project-identity.mjs';
import { createDeterministicSteamZip, steamReleaseFileName, validateSteamRelease } from './lib/steam-release-zip.mjs';
import { RELEASE_DIR, ensureReleaseRoot, resolveNswReleaseNaming, sha256File, supersedeRelease } from './lib/nsw-release-zip.mjs';

async function atomicText(target, content) {
  const temporary = path.join(path.dirname(target), `tmp-${path.basename(target)}.tmp`);
  await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
  await fs.rm(target, { force: true });
  await fs.rename(temporary, target);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(requiredOption(args, 'project-root'));
  const identity = inspectProjectRoot(projectRoot);
  if (!identity.valid || !['steam', 'pc'].includes(identity.platform)) throw new Error('--project-root must be a canonical Steam/PC project');
  const { projectId } = identity;
  const overlayRoot = path.join(projectRoot, '40_build', 'overlay');
  const manifestPath = path.join(projectRoot, '40_build', 'PATCH_MANIFEST.tsv');
  // "<한국어 제목> - <project-id>.zip" from PROJECT.md "- Korean title:" or --korean-title (fails closed); --legacy-name keeps "<project-id>.zip".
  const { gameName: koreanTitle } = await resolveNswReleaseNaming(projectRoot, {
    koreanTitle: option(args, 'korean-title') ?? null,
    legacyName: flag(args, 'legacy-name'),
    labelFolder: false,
  });
  const fileName = steamReleaseFileName(koreanTitle, projectId);
  const releaseRoot = await ensureReleaseRoot(projectRoot);
  const outputPath = path.join(releaseRoot, fileName);
  const temporaryPath = path.join(releaseRoot, `tmp-package-${projectId}.zip.tmp`);
  const previousPath = path.join(releaseRoot, `tmp-previous-${projectId}.zip.tmp`);
  await fs.rm(temporaryPath, { force: true });
  await fs.rm(previousPath, { force: true });
  let reused = false;
  try {
    await createDeterministicSteamZip({ projectId, overlayRoot, manifestPath, outputPath: temporaryPath });
    const temporaryReceipt = await validateSteamRelease({ projectId, zipPath: temporaryPath, overlayRoot, manifestPath, allowTemporaryName: true });
    const existingHash = await sha256File(outputPath).catch(() => null);
    if (existingHash === temporaryReceipt.zipSha256) {
      await fs.rm(temporaryPath);
      reused = true;
    } else if (existingHash && !flag(args, 'replace')) {
      throw new Error(`Canonical release already exists with different bytes: ${outputPath}; rerun with --replace after review`);
    } else if (existingHash) {
      await fs.rename(outputPath, previousPath);
      try { await fs.rename(temporaryPath, outputPath); } catch (error) {
        await fs.rename(previousPath, outputPath);
        throw error;
      }
      await supersedeRelease(previousPath, releaseRoot, fileName);
    } else await fs.rename(temporaryPath, outputPath);

    const receipt = await validateSteamRelease({ projectId, zipPath: outputPath, overlayRoot, manifestPath, koreanTitle });
    const stats = await fs.stat(outputPath);
    const packageManifest = {
      schema_version: 1,
      platform: identity.platform,
      format: 'install-root-overlay',
      project_id: projectId,
      release_filename: koreanTitle ? 'korean-title' : 'legacy-id',
      korean_title: koreanTitle,
      project_root: `_work/${projectId}`,
      archive_path: `${RELEASE_DIR}/${fileName}`,
      archive_root: 'patch/',
      source_overlay: '40_build/overlay',
      patch_manifest: '40_build/PATCH_MANIFEST.tsv',
      entry_count: receipt.entries.length,
      size_bytes: stats.size,
      sha256: receipt.zipSha256,
      deterministic_timestamp: '1980-01-01T00:00:00Z',
      reused,
      entries: receipt.entries,
    };
    await atomicText(path.join(releaseRoot, 'SHA256SUMS.txt'), `${receipt.zipSha256}  ${fileName}\n`);
    await atomicText(path.join(releaseRoot, 'RELEASE_PACKAGE.json'), `${JSON.stringify(packageManifest, null, 2)}\n`);
    process.stdout.write(`PASS\t${outputPath}\t${receipt.zipSha256}\tentries=${receipt.entries.length}\treused=${reused}\n`);
  } finally {
    await fs.rm(temporaryPath, { force: true });
    await fs.rm(previousPath, { force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`Steam/PC release packaging failed: ${error.message}\n`);
  process.exitCode = 1;
});
