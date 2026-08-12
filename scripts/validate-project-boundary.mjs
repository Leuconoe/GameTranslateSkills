#!/usr/bin/env node
import path from 'node:path';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';
import { validateProjectBoundary } from './lib/project-boundary.mjs';

function values(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function usage() {
  console.log(`Usage: npm run project:boundary -- --project-root <title/_work/<id>> [options]

Options:
  --stage <stage>         source | extract | reference | translation | build | test | tools
  --assert-output <path> Repeatable output path to check before running a producer
  --no-link-scan         Skip full existing-tree link scan (output ancestors are always checked)
  --help                 Show this help`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flag(args, 'help')) return usage();
  const result = await validateProjectBoundary(path.resolve(requiredOption(args, 'project-root')), {
    stage: option(args, 'stage') ?? null,
    outputs: values(option(args, 'assert-output')),
    scanLinks: !flag(args, 'no-link-scan'),
  });
  for (const issue of result.issues) console.log(`ERROR\t${issue.path}\t${issue.problem}`);
  console.log(`Project: ${result.projectRoot}; Title root: ${result.titleRoot}; Issues: ${result.issues.length}`);
  if (result.issues.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exitCode = 1;
});
