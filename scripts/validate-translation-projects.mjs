#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flag, option, parseArgs } from './lib/args.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePackageExtensions = new Set(['.nsp', '.xci']);
const requiredDirectories = [
  ['00_source'],
  ['10_extract', 'romfs_original'],
  ['10_extract', 'decompiled'],
  ['20_reference', 'external_patches'],
  ['20_reference', 'fonts'],
  ['20_reference', 'documents'],
  ['30_translation', 'text'],
  ['30_translation', 'text', 'translation_batches'],
  ['30_translation', 'text', 'reports'],
  ['30_translation', 'text', 'reviews'],
  ['30_translation', 'image_translation', 'for_translation'],
  ['30_translation', 'image_translation', 'reference'],
  ['30_translation', 'image_translation', 'reports'],
  ['40_build', 'layeredfs'],
  ['40_build', 'staging'],
  ['40_build', 'releases'],
  ['50_test', 'screenshots'],
  ['50_test', 'logs'],
  ['50_test', 'eden'],
  ['90_tools', 'scripts'],
  ['90_tools', 'environment'],
  ['90_tools', 'cleanup'],
];
const requiredFiles = [
  ['PROJECT.md'],
  ['WORK_LOG.md'],
  ['HANDOFF.md'],
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

const policyRules = {
  project_status: new Set(['registered', 'analyzing', 'analyzed', 'translating', 'review_ready', 'qa', 'qa_passed', 'runtime_verified', 'released', 'blocked']),
  text_status: new Set(['pending', 'analyzing', 'analyzed', 'translated', 'qa_ready', 'review_waiting', 'review_ready', 'blocked']),
  image_status: new Set(['pending', 'skipped', 'analyzing', 'analyzed', 'translated', 'qa_ready', 'review_waiting', 'review_ready', 'blocked']),
  qa_status: new Set(['pending', 'bench_ready', 'runtime_pending', 'passed', 'blocked']),
  release_status: new Set(['pending', 'blocked', 'released']),
  font_status: new Set(['pending', 'verified', 'blocked']),
  image_scope: new Set(['pending', 'required', 'N/A']),
  text_review_policy: new Set(['prepare-only', 'user-gate']),
  image_review_policy: new Set(['prepare-only', 'user-gate']),
  text_review_approval: new Set(['not_required', 'pending', 'approved']),
  image_review_approval: new Set(['not_required', 'pending', 'approved']),
  runtime_policy: new Set(['static-first', 'slot-probe', 'final-only']),
  runtime_authorization: new Set(['pending', 'approved', 'not_required']),
  batch_size: null,
  batch_size_override_reason: null,
  glossary_path: null,
  target_language_slot: null,
  release_contract: null,
};
const requiredPolicyKeys = Object.keys(policyRules);

async function isType(target, type) {
  try {
    const stats = await fs.stat(target);
    return type === 'directory' ? stats.isDirectory() : stats.isFile();
  } catch {
    return false;
  }
}

async function readProjectPolicies(project) {
  const text = await fs.readFile(path.join(project, 'PROJECT.md'), 'utf8');
  const policies = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*([a-z][a-z0-9_]*)\s*:\s*([^\r\n]+)$/i);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const raw = match[2].trim();
    policies[key] = raw.split(/\s+[—#]/, 1)[0].trim().replace(/^`|`$/g, '');
  }
  return policies;
}

function validateProjectPolicies(policies, id, project, issues) {
  for (const key of requiredPolicyKeys) {
    if (!Object.hasOwn(policies, key) || policies[key] === '') {
      issues.push({ severity: 'ERROR', titleId: id, item: path.join(project, 'PROJECT.md'), problem: `Missing policy field: ${key}` });
      continue;
    }
    const allowed = policyRules[key];
    if (allowed && !allowed.has(policies[key])) {
      issues.push({ severity: 'ERROR', titleId: id, item: path.join(project, 'PROJECT.md'), problem: `Invalid ${key}: ${policies[key]}` });
    }
    if (key === 'batch_size' && (!/^\d+$/.test(policies[key]) || Number(policies[key]) <= 0)) {
      issues.push({ severity: 'ERROR', titleId: id, item: path.join(project, 'PROJECT.md'), problem: `Invalid batch_size: ${policies[key]}` });
    }
  }
  if (policies.batch_size && policies.batch_size !== '80' && (!policies.batch_size_override_reason || policies.batch_size_override_reason === 'none')) {
    issues.push({ severity: 'ERROR', titleId: id, item: path.join(project, 'PROJECT.md'), problem: 'Non-default batch_size requires a non-empty override reason' });
  }
  if (policies.image_scope === 'N/A' && policies.image_status !== 'skipped') {
    issues.push({ severity: 'ERROR', titleId: id, item: path.join(project, 'PROJECT.md'), problem: 'image_scope=N/A requires image_status=skipped' });
  }
  if (policies.image_scope === 'required' && policies.image_status === 'skipped') {
    issues.push({ severity: 'ERROR', titleId: id, item: path.join(project, 'PROJECT.md'), problem: 'image_scope=required cannot have image_status=skipped' });
  }
  for (const branch of ['text', 'image']) {
    const policy = policies[`${branch}_review_policy`];
    const approvalKey = `${branch}_review_approval`;
    const status = policies[`${branch}_status`];
    const approval = policies[approvalKey];
    if (policy === 'prepare-only' && approval !== 'not_required') {
      issues.push({ severity: 'ERROR', titleId: id, item: path.join(project, 'PROJECT.md'), problem: `${policy} requires ${approvalKey}=not_required` });
    }
    if (policy === 'user-gate' && !['pending', 'approved'].includes(approval)) {
      issues.push({ severity: 'ERROR', titleId: id, item: path.join(project, 'PROJECT.md'), problem: `${policy} requires ${approvalKey}=pending or approved` });
    }
    if (status === 'review_waiting' && approval !== 'pending') {
      issues.push({ severity: 'ERROR', titleId: id, item: path.join(project, 'PROJECT.md'), problem: `${status} requires ${approvalKey}=pending` });
    }
    if (status === 'review_ready' && policy === 'user-gate' && approval !== 'approved') {
      issues.push({ severity: 'ERROR', titleId: id, item: path.join(project, 'PROJECT.md'), problem: `${status} with ${policy} requires ${approvalKey}=approved` });
    }
    if (status === 'review_waiting' && policy === 'prepare-only') {
      issues.push({ severity: 'ERROR', titleId: id, item: path.join(project, 'PROJECT.md'), problem: `${policy} cannot leave ${branch}_status=review_waiting` });
    }
  }
}

async function validateStageArtifacts(policies, id, project, issues) {
  const requiredWhen = (condition, relativePaths, label) => {
    if (!condition) return;
    for (const relativePath of relativePaths) {
      if (!isType(path.join(project, relativePath), 'file')) {
        issues.push({ severity: 'ERROR', titleId: id, item: relativePath, problem: `${label} requires canonical artifact` });
      }
    }
  };
  requiredWhen(policies.font_status === 'verified', [
    path.join('30_translation', 'text', 'FONT_COVERAGE.tsv'),
    path.join('30_translation', 'text', 'FONT_ATLAS_MANIFEST.tsv'),
    path.join('30_translation', 'text', 'FONT_ATLAS_QA_REPORT.md'),
  ], 'font_status=verified');
  requiredWhen(['qa_ready', 'review_waiting', 'review_ready'].includes(policies.text_status), [
    path.join('30_translation', 'text', 'TEXT_QA_REPORT.md'),
    path.join('30_translation', 'text', 'TEXT_BUILD_MANIFEST.tsv'),
  ], `text_status=${policies.text_status}`);
  requiredWhen(policies.text_status === 'review_ready', [
    path.join('30_translation', 'text', 'reviews', 'REVIEW_TEXT.tsv'),
    path.join('30_translation', 'text', 'reviews', 'TEXT_REVIEW_HANDOFF.md'),
  ], 'text_status=review_ready');
  requiredWhen(policies.image_scope === 'required' && ['qa_ready', 'review_waiting', 'review_ready'].includes(policies.image_status), [
    path.join('30_translation', 'image_translation', 'reports', 'IMAGE_QA_REPORT.md'),
    path.join('30_translation', 'image_translation', 'reports', 'IMAGE_BUILD_MANIFEST.tsv'),
  ], `image_status=${policies.image_status}`);
  requiredWhen(policies.image_scope === 'required' && policies.image_status === 'review_ready', [
    path.join('30_translation', 'image_translation', 'reports', 'REVIEW_IMAGE.tsv'),
    path.join('30_translation', 'image_translation', 'reports', 'IMAGE_REVIEW_HANDOFF.md'),
  ], 'image_status=review_ready');
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

async function nestedEntries(root, current = root, results = []) {
  let entries;
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const target = path.join(current, entry.name);
    results.push({ target, entry });
    if (entry.isDirectory() && !entry.isSymbolicLink()) await nestedEntries(root, target, results);
  }
  return results;
}

async function validateEdenState(project, id, issues) {
  const edenRoot = path.join(project, '50_test', 'eden');
  const entries = await nestedEntries(edenRoot);
  if (entries.length === 0) return;

  for (const { target, entry } of entries) {
    if (/^session(?:[-_.].+)?\.json$/i.test(entry.name) && entry.name !== 'SESSION.json') {
      issues.push({ severity: 'ERROR', titleId: id, item: target, problem: 'Duplicate Eden session state; keep only 50_test/eden/SESSION.json' });
    }
    if (entry.isDirectory() && /^(sessions?|runs?)$/i.test(entry.name)) {
      issues.push({ severity: 'ERROR', titleId: id, item: target, problem: 'Per-run Eden session directory is forbidden; reuse the canonical session state' });
    }
    if (entry.isDirectory() && /^(session|run)[-_.]/i.test(entry.name)) {
      issues.push({ severity: 'ERROR', titleId: id, item: target, problem: 'Timestamped/session-specific Eden directory is forbidden; reuse canonical paths' });
    }
    if (entry.isFile() && /(?:\(\d+\)|[-_.](?:copy|backup))\./i.test(entry.name)) {
      issues.push({ severity: 'ERROR', titleId: id, item: target, problem: 'Duplicate-like Eden artifact filename is forbidden' });
    }
  }

  const sessionPath = path.join(edenRoot, 'SESSION.json');
  try {
    const session = JSON.parse(await fs.readFile(sessionPath, 'utf8'));
    if (!['active', 'pending', 'closed', 'blocked'].includes(session.status)) issues.push({ severity: 'ERROR', titleId: id, item: sessionPath, problem: `Unsupported Eden session status: ${session.status}` });
    if (session.status === 'active' && !session.session_id) issues.push({ severity: 'ERROR', titleId: id, item: sessionPath, problem: 'Active Eden session must have a session_id' });
    if (session.status === 'active' && !session.session_key) issues.push({ severity: 'ERROR', titleId: id, item: sessionPath, problem: 'Active Eden session must have a session_key' });
    if (session.status === 'pending' && session.session_id) issues.push({ severity: 'ERROR', titleId: id, item: sessionPath, problem: 'Pending Eden session cannot have a session_id' });
    if (session.status === 'closed' && session.last_session_id && session.remote_close_session_id !== session.last_session_id) {
      issues.push({ severity: 'ERROR', titleId: id, item: sessionPath, problem: 'Closed Eden session with last_session_id lacks matching remote_close_session_id proof' });
    }
  } catch (error) {
    issues.push({ severity: 'ERROR', titleId: id, item: sessionPath, problem: `Cannot parse SESSION.json: ${error.message}` });
  }

  const manifestPath = path.join(edenRoot, 'ARTIFACT_MANIFEST.tsv');
  try {
    const lines = (await fs.readFile(manifestPath, 'utf8')).split(/\r?\n/).filter(Boolean);
    const header = lines.shift()?.split('\t') ?? [];
    const keyIndex = header.indexOf('artifact_key');
    const pathIndex = header.indexOf('path');
    if (keyIndex === -1) {
      issues.push({ severity: 'ERROR', titleId: id, item: manifestPath, problem: 'Artifact manifest must contain an artifact_key column' });
      return;
    }
    const seen = new Set();
    const seenPaths = new Set();
    for (const line of lines) {
      const cells = line.split('\t');
      const key = (cells[keyIndex] ?? '').trim();
      const artifactPath = (cells[pathIndex] ?? '').trim();
      if (!key) {
        issues.push({ severity: 'ERROR', titleId: id, item: manifestPath, problem: 'Artifact manifest contains an empty artifact_key' });
      } else if (seen.has(key)) {
        issues.push({ severity: 'ERROR', titleId: id, item: manifestPath, problem: `Duplicate artifact_key: ${key}` });
      } else {
        seen.add(key);
      }
      if (pathIndex !== -1 && artifactPath) {
        if (seenPaths.has(artifactPath)) issues.push({ severity: 'ERROR', titleId: id, item: manifestPath, problem: `Duplicate artifact path: ${artifactPath}` });
        seenPaths.add(artifactPath);
        if (/(?:^|[\\/])(sessions?|runs?)(?:[\\/]|$)|(?:\(\d+\)|[-_.](?:copy|backup))\./i.test(artifactPath)) {
          issues.push({ severity: 'ERROR', titleId: id, item: manifestPath, problem: `Non-canonical session/copy artifact path: ${artifactPath}` });
        }
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
    if (await isType(path.join(project, 'PROJECT.md'), 'file')) {
      try {
        const policies = await readProjectPolicies(project);
        validateProjectPolicies(policies, id, project, issues);
        await validateStageArtifacts(policies, id, project, issues);
      } catch (error) {
        issues.push({ severity: 'ERROR', titleId: id, item: path.join(project, 'PROJECT.md'), problem: `Cannot read project policies: ${error.message}` });
      }
    }
    await validateEdenState(project, id, issues);

    const layeredFsRoot = path.join(project, '40_build', 'layeredfs');
    if (!(await isType(path.join(layeredFsRoot, id, 'romfs'), 'directory'))) {
      issues.push({ severity: 'ERROR', titleId: id, item: path.join(layeredFsRoot, id, 'romfs'), problem: 'Canonical LayeredFS folder for this Title ID is missing' });
    }
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
