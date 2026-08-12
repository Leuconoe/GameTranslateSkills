#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';
import { ensureArtifactLayout, registerArtifact, validateArtifactLayout } from './lib/project-artifacts.mjs';
import { validateProjectBoundary } from './lib/project-boundary.mjs';

const titleIdPattern = /^[0-9A-Fa-f]{16}$/;

async function isDirectory(target) {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

function usage() {
  console.log(`Usage: npm run project:artifacts -- --project-root <title/_work/<16-hex-title-id>> [options]

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
  --validate            Validate paths, ownership, lifecycle, hashes, and unregistered files (default)
  --help                Show this help`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flag(args, 'help')) return usage();
  const projectRoot = path.resolve(requiredOption(args, 'project-root'));
  if (path.basename(path.dirname(projectRoot)) !== '_work' || !titleIdPattern.test(path.basename(projectRoot))) {
    throw new Error('--project-root must be an exact title project under <title>/_work/<16-hex-title-id>');
  }
  if (!(await isDirectory(projectRoot))) throw new Error(`Project root does not exist: ${projectRoot}`);
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
