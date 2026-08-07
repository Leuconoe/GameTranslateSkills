#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flag, option, parseArgs } from './lib/args.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredDirectories = [
  ['00_source'],
  ['10_extract'],
  ['20_reference'],
  ['30_translation', 'text'],
  ['30_translation', 'image_translation', 'for_translation'],
  ['30_translation', 'image_translation', 'reference'],
  ['40_build', 'layeredfs'],
  ['40_build', 'releases'],
  ['50_test'],
  ['90_tools'],
];
const requiredFiles = [
  ['PROJECT.md'],
  ['WORK_LOG.md'],
  ['00_source', 'SOURCE_INVENTORY.tsv'],
  ['20_reference', 'REFERENCE_INDEX.tsv'],
  ['30_translation', 'text', 'glossary.tsv'],
  ['30_translation', 'text', 'translation_manifest.tsv'],
  ['30_translation', 'text', 'CODEX_TRANSLATION_WORKFLOW.md'],
  ['30_translation', 'image_translation', 'reference', 'image_manifest.tsv'],
  ['40_build', 'BUILD_MANIFEST.tsv'],
  ['50_test', 'TEST_LOG.md'],
];

async function isType(target, type) {
  try {
    const stats = await fs.stat(target);
    return type === 'directory' ? stats.isDirectory() : stats.isFile();
  } catch {
    return false;
  }
}

async function directDirectories(root) {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

async function findWorkFolders(root, depth = 0, results = []) {
  if (depth > 3) return results;
  for (const directory of await directDirectories(root)) {
    if (path.basename(directory) === '_work') {
      results.push(directory);
      continue;
    }
    await findWorkFolders(directory, depth + 1, results);
  }
  return results;
}

async function printIssues(issues) {
  for (const issue of issues.sort((left, right) => `${left.severity}${left.titleId}${left.item}`.localeCompare(`${right.severity}${right.titleId}${right.item}`))) {
    console.log(`${issue.severity}\t${issue.titleId}\t${issue.item}\t${issue.problem}`);
  }
}

function usage() {
  console.log(`Usage: npm run project:validate -- [options]

Options:
  --titles-root <path>  Titles root (default: <repository>/_titles)
  --strict              Treat root leak warnings as errors
  --help                Show this help`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flag(args, 'help')) {
    usage();
    return;
  }

  const titlesRoot = path.resolve(String(option(args, 'titles-root') ?? path.join(repositoryRoot, '_titles')));
  const projects = [];
  for (const workRoot of await findWorkFolders(titlesRoot)) {
    for (const project of await directDirectories(workRoot)) {
      if (/^[0-9A-Fa-f]{16}$/.test(path.basename(project))) projects.push(project);
    }
  }

  const issues = [];
  if (projects.length === 0) {
    issues.push({ severity: 'ERROR', titleId: '-', item: titlesRoot, problem: 'No translation projects found' });
  }

  const groups = new Map();
  for (const project of projects) {
    const id = path.basename(project).toUpperCase();
    const group = groups.get(id) ?? [];
    group.push(project);
    groups.set(id, group);
  }
  for (const [id, group] of groups) {
    if (group.length > 1) {
      issues.push({ severity: 'ERROR', titleId: id, item: group.join('; '), problem: 'Title ID is registered in more than one project' });
    }
  }

  for (const project of projects) {
    const id = path.basename(project).toUpperCase();
    for (const relativePath of requiredDirectories) {
      const item = relativePath.join(path.sep);
      if (!(await isType(path.join(project, ...relativePath), 'directory'))) {
        issues.push({ severity: 'ERROR', titleId: id, item, problem: 'Required directory is missing' });
      }
    }
    for (const relativePath of requiredFiles) {
      const item = relativePath.join(path.sep);
      if (!(await isType(path.join(project, ...relativePath), 'file'))) {
        issues.push({ severity: 'ERROR', titleId: id, item, problem: 'Required project file is missing' });
      }
    }

    const layeredFsRoot = path.join(project, '40_build', 'layeredfs');
    for (const foreignIdPath of await directDirectories(layeredFsRoot)) {
      const foreignId = path.basename(foreignIdPath);
      if (/^[0-9A-Fa-f]{16}$/.test(foreignId) && foreignId.toUpperCase() !== id) {
        issues.push({ severity: 'ERROR', titleId: id, item: foreignIdPath, problem: 'LayeredFS folder belongs to another Title ID' });
      }
    }
  }

  const rootLeakNames = new Set(['data', 'output', 'temp', 'romfs', 'image_translation', '.codex_m2_probe']);
  for (const searchRoot of [path.dirname(titlesRoot), titlesRoot]) {
    for (const candidate of await directDirectories(searchRoot)) {
      const candidateName = path.basename(candidate);
      if (rootLeakNames.has(candidateName) || /^tmp[-_]/i.test(candidateName)) {
        issues.push({
          severity: flag(args, 'strict') ? 'ERROR' : 'WARN',
          titleId: '-',
          item: candidate,
          problem: 'Unscoped work directory may mix game artifacts',
        });
      }
    }
  }

  console.log('TitleId\tProject');
  for (const project of [...projects].sort()) console.log(`${path.basename(project).toUpperCase()}\t${project}`);
  if (issues.length > 0) {
    console.log('\nSeverity\tTitleId\tItem\tProblem');
    await printIssues(issues);
  }

  const errorCount = issues.filter((issue) => issue.severity === 'ERROR').length;
  const warningCount = issues.filter((issue) => issue.severity === 'WARN').length;
  console.log(`Projects: ${projects.length}; Errors: ${errorCount}; Warnings: ${warningCount}`);
  if (errorCount > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exitCode = 1;
});
