#!/usr/bin/env node
import path from 'node:path';
import { option, parseArgs, requiredOption } from './lib/args.mjs';
import { normalizeTitleId, validateNswRelease } from './lib/nsw-release-zip.mjs';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRootOption = option(args, 'project-root');
  const projectRoot = projectRootOption ? path.resolve(projectRootOption) : null;
  const inferredId = projectRoot ? path.basename(projectRoot) : null;
  const titleId = normalizeTitleId(option(args, 'title-id') ?? inferredId);
  if (projectRoot && normalizeTitleId(inferredId) !== titleId) {
    throw new Error(`Project folder Title ID ${inferredId} does not match requested ${titleId}`);
  }
  const zipPath = path.resolve(option(args, 'zip') ?? (projectRoot
    ? path.join(projectRoot, '40_build', 'releases', `${titleId}.zip`)
    : requiredOption(args, 'zip')));
  const romfsRoot = path.resolve(option(args, 'romfs-root') ?? (projectRoot
    ? path.join(projectRoot, '40_build', 'layeredfs', titleId, 'romfs')
    : requiredOption(args, 'romfs-root')));
  const receipt = await validateNswRelease({ titleId, zipPath, romfsRoot });
  process.stdout.write(`PASS\t${receipt.zipPath}\t${receipt.zipSha256}\tentries=${receipt.entries.length}\n`);
}

main().catch((error) => {
  process.stderr.write(`NSW release validation failed: ${error.message}\n`);
  process.exitCode = 1;
});
