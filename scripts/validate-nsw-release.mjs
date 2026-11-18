#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';
import {
  LEGACY_RELEASE_DIRS,
  fat32ReleaseWarning,
  normalizeTitleId,
  nswReleaseFileName,
  parseNswReleaseFileName,
  releaseRootOfProject,
  resolveNswReleaseNaming,
  validateNswRelease,
  verifySplitDistribution,
} from './lib/nsw-release-zip.mjs';

function readDistribution(releaseRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(releaseRoot, 'RELEASE_PACKAGE.json'), 'utf8')).distribution ?? null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRootOption = option(args, 'project-root');
  const projectRoot = projectRootOption ? path.resolve(projectRootOption) : null;
  const inferredId = projectRoot ? path.basename(projectRoot) : null;
  const titleId = normalizeTitleId(option(args, 'title-id') ?? inferredId);
  if (projectRoot && normalizeTitleId(inferredId) !== titleId) {
    throw new Error(`Project folder Title ID ${inferredId} does not match requested ${titleId}`);
  }
  const naming = { koreanTitle: option(args, 'korean-title') ?? null, legacyName: flag(args, 'legacy-name') };
  const zipOption = option(args, 'zip');
  let zipPath;
  let gameName;
  let parts = null;
  if (!projectRoot) {
    zipPath = path.resolve(requiredOption(args, 'zip'));
    // Without a project the title comes from --korean-title or the "<제목> - <TID>.zip" name itself (TID suffix checked).
    gameName = naming.legacyName ? null : naming.koreanTitle ?? parseNswReleaseFileName(path.basename(zipPath), titleId);
    if (gameName === null && !naming.legacyName) {
      throw new Error(`NSW release filename must be "<한국어 제목> - ${titleId}.zip": ${path.basename(zipPath)}`);
    }
  } else {
    let namingError = null;
    try {
      ({ gameName } = await resolveNswReleaseNaming(projectRoot, naming));
    } catch (error) {
      namingError = error;
    }
    if (zipOption) {
      if (namingError) throw namingError;
      zipPath = path.resolve(zipOption);
    } else {
      // Canonical <title root>/_release first; the legacy in-project folders (60_release, 40_build/releases, with the
      // Korean or "<ID>.zip" name) are read with a warning.
      const releaseRoot = releaseRootOfProject(projectRoot);
      const legacyNames = [...new Set([...(namingError ? [] : [gameName]), null])];
      const candidates = [
        ...(namingError ? [] : [{ root: releaseRoot, name: gameName, legacy: false }]),
        ...LEGACY_RELEASE_DIRS.flatMap((dir) => legacyNames.map((name) => ({ root: path.join(projectRoot, dir), name, legacy: true }))),
      ].map((candidate) => ({ ...candidate, file: path.join(candidate.root, nswReleaseFileName(candidate.name, titleId)) }));
      const found = candidates.find((candidate) => fs.existsSync(candidate.file));
      // No single ZIP but RELEASE_PACKAGE.json says split: read _release/split/<zip>.NNN in order as one virtual ZIP.
      const distribution = !found && !namingError ? readDistribution(releaseRoot) : null;
      if (distribution?.form === 'split') {
        zipPath = candidates[0].file;
        parts = await verifySplitDistribution({ releaseRoot, zipName: path.basename(zipPath), distribution });
      } else {
        if (!found) throw namingError ?? new Error(`NSW release ZIP not found: ${candidates[0].file}`);
        if (found.legacy) {
          process.stderr.write(`WARNING\tlegacy release location ${found.file}; move it to ${releaseRoot} on the next release\n`);
        }
        zipPath = found.file;
        gameName = found.name;
      }
    }
  }
  const romfsRoot = path.resolve(option(args, 'romfs-root') ?? (projectRoot
    ? path.join(projectRoot, '40_build', 'layeredfs', titleId, 'romfs')
    : requiredOption(args, 'romfs-root')));
  const exefsRoot = option(args, 'exefs-root') ?? (projectRoot
    ? path.join(projectRoot, '40_build', 'layeredfs', titleId, 'exefs')
    : null);
  const receipt = await validateNswRelease({ titleId, zipPath, romfsRoot, exefsRoot, gameName, parts });
  const fat32Warning = await fat32ReleaseWarning(receipt.entries, receipt.zipPath);
  if (fat32Warning) process.stderr.write(`WARNING\t${fat32Warning}\n`);
  const splitNote = parts ? `\tsplit=${parts.length}` : '';
  process.stdout.write(`PASS\t${receipt.zipPath}\t${receipt.zipSha256}\tentries=${receipt.entries.length}${splitNote}\n`);
}

main().catch((error) => {
  process.stderr.write(`NSW release validation failed: ${error.message}\n`);
  process.exitCode = 1;
});
