#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flag, option, parseArgs } from './lib/args.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePackageExtensions = new Set(['.nsp', '.xci']);
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
  ['50_test', 'eden'],
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
  ['50_test', 'eden', 'SESSION.json'],
  ['50_test', 'eden', 'ARTIFACT_MANIFEST.tsv'],
];

async function isType(target, type) {
  try {
    const stats = await fs.stat(target);
    return type === 'directory' ? stats.isDirectory() : stats.isFile();
  } catch {
    return false;
  }
}

async function directSourcePackages(root) {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && sourcePackageExtensions.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => path.join(root, entry.name))
      .sort();
  } catch {
    return [];
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
  --titles-root <path>  Titles container (default: existing <repository>/_titles or <repository>/_title)
  --strict              Treat root leak warnings as errors
  --help                Show this help`);
}

async function resolveTitlesRoot(args) {
  const explicit = option(args, 'titles-root');
  if (typeof explicit === 'string') return path.resolve(explicit);
  const candidates = [path.join(repositoryRoot, '_titles'), path.join(repositoryRoot, '_title')];
  const existing = [];
  for (const candidate of candidates) if (await isType(candidate, 'directory')) existing.push(candidate);
  if (existing.length > 1) throw new Error(`Both title containers exist; pass an explicit --titles-root: ${existing.join(', ')}`);
  return existing[0] ?? candidates[0];
}

async function validateEdenState(project, id, issues) {
  const edenRoot = path.join(project, '50_test', 'eden');
  let entries = [];
  try {
    entries = await fs.readdir(edenRoot, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (/^session(?:[-_.].+)?\.json$/i.test(entry.name) && entry.name !== 'SESSION.json') {
      issues.push({ severity: 'ERROR', titleId: id, item: path.join(edenRoot, entry.name), problem: 'Duplicate Eden session state; keep only 50_test/eden/SESSION.json' });
    }
    if (entry.isDirectory() && /^(sessions?|runs?)$/i.test(entry.name)) {
      issues.push({ severity: 'ERROR', titleId: id, item: path.join(edenRoot, entry.name), problem: 'Per-run Eden session directory is forbidden; reuse the canonical session state' });
    }
  }

  const manifestPath = path.join(edenRoot, 'ARTIFACT_MANIFEST.tsv');
  try {
    const lines = (await fs.readFile(manifestPath, 'utf8')).split(/\r?\n/).filter(Boolean);
    const header = lines.shift()?.split('\t') ?? [];
    const keyIndex = header.indexOf('artifact_key');
    if (keyIndex === -1) {
      issues.push({ severity: 'ERROR', titleId: id, item: manifestPath, problem: 'Artifact manifest must contain an artifact_key column' });
      return;
    }
    const seen = new Set();
    for (const line of lines) {
      const key = (line.split('\t')[keyIndex] ?? '').trim();
      if (!key) {
        issues.push({ severity: 'ERROR', titleId: id, item: manifestPath, problem: 'Artifact manifest contains an empty artifact_key' });
      } else if (seen.has(key)) {
        issues.push({ severity: 'ERROR', titleId: id, item: manifestPath, problem: `Duplicate artifact_key: ${key}` });
      } else {
        seen.add(key);
      }
    }
  } catch {
    // requiredFiles reports a missing manifest; no duplicate check is possible here.
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flag(args, 'help')) {
    usage();
    return;
  }

  const titlesRoot = await resolveTitlesRoot(args);
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
    const titleRoot = path.dirname(path.dirname(project));
    if ((await directSourcePackages(titleRoot)).length === 0) {
      issues.push({ severity: 'ERROR', titleId: id, item: titleRoot, problem: 'Title root must directly contain at least one .nsp or .xci; do not create a nested generic title folder' });
    }
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
    await validateEdenState(project, id, issues);

    const layeredFsRoot = path.join(project, '40_build', 'layeredfs');
    for (const foreignIdPath of await directDirectories(layeredFsRoot)) {
      const foreignId = path.basename(foreignIdPath);
      if (/^[0-9A-Fa-f]{16}$/.test(foreignId) && foreignId.toUpperCase() !== id) {
        issues.push({ severity: 'ERROR', titleId: id, item: foreignIdPath, problem: 'LayeredFS folder belongs to another Title ID' });
      }
    }
  }

  const rootLeakNames = new Set(['data', 'output', 'temp', 'romfs', 'image_translation', '.codex_m2_probe']);
  for (const candidate of await directDirectories(titlesRoot)) {
    if (path.basename(candidate).toLowerCase() === 'title' && (await directSourcePackages(candidate)).length === 0) {
      issues.push({
        severity: 'ERROR',
        titleId: '-',
        item: candidate,
        problem: 'Generic title folder has no direct NSP/XCI; keep work under the actual source-package folder',
      });
    }
  }
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
