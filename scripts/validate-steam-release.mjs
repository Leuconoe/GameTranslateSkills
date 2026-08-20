#!/usr/bin/env node
import path from 'node:path';
import { option, parseArgs, requiredOption } from './lib/args.mjs';
import { inspectProjectRoot } from './lib/project-identity.mjs';
import { validateSteamRelease } from './lib/steam-release-zip.mjs';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(requiredOption(args, 'project-root'));
  const identity = inspectProjectRoot(projectRoot);
  if (!identity.valid || !['steam', 'pc'].includes(identity.platform)) throw new Error('--project-root must be a canonical Steam/PC project');
  const zipPath = path.resolve(option(args, 'zip') ?? path.join(projectRoot, '40_build', 'releases', `${identity.projectId}.zip`));
  const receipt = await validateSteamRelease({
    projectId: identity.projectId,
    zipPath,
    overlayRoot: path.join(projectRoot, '40_build', 'overlay'),
    manifestPath: path.join(projectRoot, '40_build', 'PATCH_MANIFEST.tsv'),
  });
  process.stdout.write(`PASS\t${receipt.zipPath}\t${receipt.zipSha256}\tentries=${receipt.entries.length}\n`);
}

main().catch((error) => {
  process.stderr.write(`Steam/PC release validation failed: ${error.message}\n`);
  process.exitCode = 1;
});
