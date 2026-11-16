#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';
import { ensureArtifactLayout, findReusableArtifact, registerArtifact, validateArtifactLayout } from './lib/project-artifacts.mjs';
import { validateProjectBoundary } from './lib/project-boundary.mjs';
import { inspectProjectRoot, projectRootShapeDescription } from './lib/project-identity.mjs';

async function isDirectory(target) {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

function usage() {
  console.log(`Usage: npm run project:artifacts -- --project-root ${projectRootShapeDescription()} [options]

Options:
  --project-root <path> Exact title project root
  --init                Create managed folders and PROJECT_ARTIFACT_MANIFEST.tsv, then validate
  --register            Register one existing managed file and calculate its SHA-256
  --artifact-key <key>  Stable <PROJECT_ID>/<stage>/<logical-name> key
  --stage <stage>       extract | translation | build | test
  --class <class>       source-export | translation-source | translation-output | test-artifact | test-script | work | cache
  --lifecycle <value>   canonical | evidence | reproducible | disposable
  --path <relative>     File path under the class's managed root
  --producer <value>    Tool, script, or workflow stage that created the file
  --reproduce-command <command>
                        Required for lifecycle=reproducible
  --status <status>     active | complete | failed | superseded (default: complete)
  --notes <text>        Optional single-line note
  --reuse-check         Before re-running work: print REUSE<TAB>path<TAB>sha256 for a complete artifact with the
                        same --producer and --reproduce-command whose file still matches (exit 0),
                        otherwise print NONE (exit 3). Run the producer only on NONE.
  --validate            Validate paths, ownership, lifecycle, hashes, unregistered files, duplicate content
                        and repeated active work (default)
  --help                Show this help`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flag(args, 'help')) return usage();
  const projectRoot = path.resolve(requiredOption(args, 'project-root'));
  if (!inspectProjectRoot(projectRoot).valid) {
    throw new Error(`--project-root must be an exact title project under ${projectRootShapeDescription()}`);
  }
  if (!(await isDirectory(projectRoot))) throw new Error(`Project root does not exist: ${projectRoot}`);
  if (flag(args, 'reuse-check')) {
    const found = await findReusableArtifact(projectRoot, {
      producer: requiredOption(args, 'producer'),
      reproduce_command: requiredOption(args, 'reproduce-command'),
    });
    console.log(found ? `REUSE\t${found.path}\t${found.sha256}\t${found.artifact_key}` : 'NONE');
    process.exitCode = found ? 0 : 3;
    return;
  }
  if (flag(args, 'init')) console.log(`Artifact index: ${await ensureArtifactLayout(projectRoot)}`);
  if (flag(args, 'register')) {
    const registered = await registerArtifact(projectRoot, {
      artifact_key: requiredOption(args, 'artifact-key'),
      stage: requiredOption(args, 'stage'),
      class: requiredOption(args, 'class'),
      lifecycle: requiredOption(args, 'lifecycle'),
      path: requiredOption(args, 'path'),
      producer: requiredOption(args, 'producer'),
      reproduce_command: option(args, 'reproduce-command') ?? '',
      status: option(args, 'status') ?? 'complete',
      notes: option(args, 'notes') ?? '',
    });
    console.log(`Registered: ${registered.artifact_key}\t${registered.path}\t${registered.sha256}`);
  }
  const result = await validateArtifactLayout(projectRoot);
  const boundary = await validateProjectBoundary(projectRoot);
  const issues = [...boundary.issues, ...result.issues];
  for (const issue of issues) console.log(`ERROR\t${issue.path}\t${issue.problem}`);
  console.log(`Indexed: ${result.rows.length}; Managed files: ${result.files.length}; Issues: ${issues.length}`);
  if (issues.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exitCode = 1;
});
