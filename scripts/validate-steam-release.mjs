#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';
import { inspectProjectRoot } from './lib/project-identity.mjs';
import { LEGACY_RELEASE_DIRS, releaseRootOfProject, resolveNswReleaseNaming } from './lib/nsw-release-zip.mjs';
import { steamReleaseFileName, validateSteamRelease } from './lib/steam-release-zip.mjs';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(requiredOption(args, 'project-root'));
  const identity = inspectProjectRoot(projectRoot);
  if (!identity.valid || !['steam', 'pc'].includes(identity.platform)) throw new Error('--project-root must be a canonical Steam/PC project');
  let koreanTitle = null;
  let namingError = null;
  try {
    ({ gameName: koreanTitle } = await resolveNswReleaseNaming(projectRoot, {
      koreanTitle: option(args, 'korean-title') ?? null,
      legacyName: flag(args, 'legacy-name'),
      labelFolder: false,
    }));
  } catch (error) {
    namingError = error;
  }
  let zipPath = option(args, 'zip');
  if (zipPath) {
    if (namingError) throw namingError;
    zipPath = path.resolve(zipPath);
  } else {
    // Canonical <install root>/_release first; the legacy in-project folders are read with a warning.
    const releaseRoot = releaseRootOfProject(projectRoot);
    const canonical = namingError ? null : path.join(releaseRoot, steamReleaseFileName(koreanTitle, identity.projectId));
    const legacyNames = [...new Set([...(namingError ? [] : [koreanTitle]), null])];
    const legacy = LEGACY_RELEASE_DIRS.flatMap((dir) => legacyNames.map((name) => ({
      name, file: path.join(projectRoot, dir, steamReleaseFileName(name, identity.projectId)),
    }))).find((candidate) => fs.existsSync(candidate.file));
    if (canonical && fs.existsSync(canonical)) zipPath = canonical;
    else if (legacy) {
      process.stderr.write(`WARNING\tlegacy release location ${legacy.file}; move it to ${releaseRoot} on the next release\n`);
      zipPath = legacy.file;
      koreanTitle = legacy.name;
    } else throw namingError ?? new Error(`Steam/PC release ZIP not found: ${canonical}`);
  }
  const receipt = await validateSteamRelease({
    projectId: identity.projectId,
    zipPath,
    overlayRoot: path.join(projectRoot, '40_build', 'overlay'),
    manifestPath: path.join(projectRoot, '40_build', 'PATCH_MANIFEST.tsv'),
    koreanTitle,
  });
  process.stdout.write(`PASS\t${receipt.zipPath}\t${receipt.zipSha256}\tentries=${receipt.entries.length}\n`);
}

main().catch((error) => {
  process.stderr.write(`Steam/PC release validation failed: ${error.message}\n`);
  process.exitCode = 1;
});
