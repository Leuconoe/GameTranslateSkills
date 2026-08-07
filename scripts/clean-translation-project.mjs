#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { flag, parseArgs, requiredOption } from './lib/args.mjs';

const titleIdPattern = /^[0-9A-Fa-f]{16}$/;

function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isTemporaryName(name) {
  return /^tmp[-_.].+/i.test(name) || /\.tmp(?:$|[.])/i.test(name);
}

async function isDirectory(target) {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function containsLink(target) {
  const stats = await fs.lstat(target);
  if (stats.isSymbolicLink()) return true;
  if (!stats.isDirectory()) return false;
  for (const entry of await fs.readdir(target, { withFileTypes: true })) {
    if (await containsLink(path.join(target, entry.name))) return true;
  }
  return false;
}

async function collectCandidates(projectRoot, current = projectRoot, candidates = []) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(current, entry.name);
    if (!isWithin(projectRoot, target)) {
      throw new Error(`Candidate escaped project root: ${target}`);
    }

    const stats = await fs.lstat(target);
    const isLink = stats.isSymbolicLink();
    if (isTemporaryName(entry.name)) {
      candidates.push({
        path: target,
        relativePath: path.relative(projectRoot, target),
        kind: stats.isDirectory() ? 'directory' : 'file',
        blocked: isLink || (stats.isDirectory() && await containsLink(target)),
      });
      continue;
    }

    if (stats.isDirectory() && !isLink) {
      await collectCandidates(projectRoot, target, candidates);
    }
  }
  return candidates;
}

function usage() {
  console.log(`Usage: npm run project:clean -- --project-root <title/_work/<16-hex-title-id>> [options]

The default is a dry run. Deletion requires the explicit --apply flag.

Options:
  --project-root <path>  Exact project root under a title's _work folder
  --apply                Remove only exact tmp-* / tmp_* / *.tmp candidates
  --help                 Show this help`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flag(args, 'help')) {
    usage();
    return;
  }

  const projectRoot = path.resolve(requiredOption(args, 'project-root'));
  const workRoot = path.dirname(projectRoot);
  if (path.basename(workRoot) !== '_work' || !titleIdPattern.test(path.basename(projectRoot))) {
    throw new Error('--project-root must be an exact title project under <title>/_work/<16-hex-title-id>');
  }
  if (!(await isDirectory(projectRoot))) {
    throw new Error(`Project root does not exist: ${projectRoot}`);
  }

  const candidates = (await collectCandidates(projectRoot)).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  console.log(`Project: ${projectRoot}`);
  if (candidates.length === 0) {
    console.log('Disposable temporary candidates: 0');
    return;
  }

  console.log('Mode\tKind\tPath');
  for (const candidate of candidates) {
    console.log(`${candidate.blocked ? 'BLOCKED' : 'CANDIDATE'}\t${candidate.kind}\t${candidate.relativePath}`);
  }

  if (candidates.some((candidate) => candidate.blocked)) {
    throw new Error('A temporary candidate is a symbolic link/reparse-like entry; no deletion was performed');
  }

  if (!flag(args, 'apply')) {
    console.log('Dry run only. Re-run the exact command with --apply after reviewing this allowlist.');
    return;
  }

  for (const candidate of candidates) {
    await fs.rm(candidate.path, { recursive: candidate.kind === 'directory', force: false });
    console.log(`REMOVED\t${candidate.relativePath}`);
  }
  console.log(`Removed: ${candidates.length}`);
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exitCode = 1;
});
