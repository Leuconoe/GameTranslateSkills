import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const artifactIndexHeader = [
  'artifact_key',
  'stage',
  'class',
  'lifecycle',
  'path',
  'producer',
  'reproduce_command',
  'sha256',
  'status',
  'notes',
];

export const artifactLayoutDirectories = [
  ['10_extract', 'exports'],
  ['30_translation', 'exports', 'source'],
  ['30_translation', 'exports', 'translated'],
  ['50_test', 'artifacts'],
  ['90_tools', 'scripts', 'test'],
  ['90_tools', 'work', 'extract'],
  ['90_tools', 'work', 'translation'],
  ['90_tools', 'work', 'build'],
  ['90_tools', 'work', 'test'],
];

export const artifactIndexRelative = path.join('90_tools', 'PROJECT_ARTIFACT_MANIFEST.tsv');

const stages = new Set(['extract', 'translation', 'build', 'test']);
const lifecycles = new Set(['canonical', 'evidence', 'reproducible', 'disposable']);
const statuses = new Set(['active', 'complete', 'failed', 'superseded', 'archived']);
const classRules = new Map([
  ['source-export', { stage: 'extract', prefix: '10_extract/exports/' }],
  ['translation-source', { stage: 'translation', prefix: '30_translation/exports/source/' }],
  ['translation-output', { stage: 'translation', prefix: '30_translation/exports/translated/' }],
  ['test-artifact', { stage: 'test', prefix: '50_test/artifacts/' }],
  ['test-script', { stage: 'test', prefix: '90_tools/scripts/test/' }],
  ['work', { stagePrefix: '90_tools/work/' }],
  ['cache', { stagePrefix: '90_tools/work/' }],
]);
const scriptExtensions = new Set(['.ps1', '.py', '.mjs', '.js', '.sh', '.bat', '.cmd']);
const canonicalProjectDirectories = new Set(['00_source', '10_extract', '20_reference', '30_translation', '40_build', '50_test', '90_tools']);
const canonicalTestDirectories = new Set(['screenshots', 'logs', 'eden', 'release-runtime', 'artifacts']);
const canonicalTestFiles = new Set(['TEST_LOG.md', 'RELEASE_RUNTIME_QA.json']);
const canonicalToolDirectories = new Set(['scripts', 'environment', 'cleanup', 'work', 'cleanup-archive']);
const canonicalToolFiles = new Set(['PROJECT_ARTIFACT_MANIFEST.tsv', 'CLEANUP_PLAN.json', 'CLEANUP_INSTRUCTIONS.md']);
const testLikeScript = /(?:^|[-_.])(test|qa|verify|probe|smoke|capture|audit)(?:[-_.]|$)/i;

function normalizeRelative(value) {
  return value.trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function isContained(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function sha256File(target) {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(target, 'r');
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk);
  } finally {
    await handle.close().catch(() => {});
  }
  return hash.digest('hex');
}

async function collectFiles(root, current = root, output = []) {
  let entries;
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return output;
    throw error;
  }
  for (const entry of entries) {
    const target = path.join(current, entry.name);
    const stats = await fs.lstat(target);
    if (stats.isSymbolicLink()) {
      output.push({ absolute: target, kind: 'link' });
    } else if (stats.isDirectory()) {
      await collectFiles(root, target, output);
    } else {
      output.push({ absolute: target, kind: 'file', size: stats.size });
    }
  }
  return output;
}

export function isArtifactHarnessPath(relativePath) {
  const normalized = normalizeRelative(relativePath);
  return artifactLayoutDirectories.some((parts) => {
    const prefix = `${parts.join('/')}/`;
    return normalized.startsWith(prefix);
  });
}

export async function ensureArtifactLayout(projectRoot) {
  for (const parts of artifactLayoutDirectories) {
    await fs.mkdir(path.join(projectRoot, ...parts), { recursive: true });
  }
  const indexPath = path.join(projectRoot, artifactIndexRelative);
  try {
    await fs.access(indexPath);
  } catch {
    await fs.mkdir(path.dirname(indexPath), { recursive: true });
    await fs.writeFile(indexPath, `${artifactIndexHeader.join('\t')}\n`, { flag: 'wx' });
  }
  return indexPath;
}

function assertTsvField(value, label, { required = true } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new Error(`${label} is required`);
  if (/[\t\r\n]/.test(text)) throw new Error(`${label} cannot contain tabs or newlines`);
  return text;
}

export async function registerArtifact(projectRoot, input) {
  await ensureArtifactLayout(projectRoot);
  const projectId = path.basename(path.resolve(projectRoot)).toUpperCase();
  const row = {
    artifact_key: assertTsvField(input.artifact_key, 'artifact_key'),
    stage: assertTsvField(input.stage, 'stage'),
    class: assertTsvField(input.class, 'class'),
    lifecycle: assertTsvField(input.lifecycle, 'lifecycle'),
    path: normalizeRelative(assertTsvField(input.path, 'path')),
    producer: assertTsvField(input.producer, 'producer'),
    reproduce_command: assertTsvField(input.reproduce_command, 'reproduce_command', { required: false }),
    sha256: '',
    status: assertTsvField(input.status, 'status'),
    notes: assertTsvField(input.notes, 'notes', { required: false }),
  };
  if (!stages.has(row.stage)) throw new Error(`Unsupported stage: ${row.stage}`);
  if (!classRules.has(row.class)) throw new Error(`Unsupported class: ${row.class}`);
  if (!lifecycles.has(row.lifecycle)) throw new Error(`Unsupported lifecycle: ${row.lifecycle}`);
  if (!statuses.has(row.status) || row.status === 'archived') throw new Error(`Unsupported registration status: ${row.status}`);
  if (!row.artifact_key.startsWith(`${projectId}/${row.stage}/`) || row.artifact_key.endsWith('/')) {
    throw new Error(`artifact_key must use ${projectId}/${row.stage}/<logical-name>`);
  }
  if (row.lifecycle === 'reproducible' && !row.reproduce_command) throw new Error('reproducible artifacts require reproduce_command');
  if (path.posix.isAbsolute(row.path) || /^[A-Za-z]:/.test(row.path) || row.path.split('/').includes('..')) {
    throw new Error(`Artifact path must be a contained project-relative path: ${row.path}`);
  }
  const rule = classRules.get(row.class);
  if (rule.stage && row.stage !== rule.stage) throw new Error(`${row.class} requires stage=${rule.stage}`);
  const requiredPrefix = rule.prefix ?? (rule.stagePrefix ? `${rule.stagePrefix}${row.stage}/` : '');
  if (!requiredPrefix || !row.path.startsWith(requiredPrefix) || !isArtifactHarnessPath(row.path)) {
    throw new Error(`${row.class} must be stored under ${requiredPrefix}`);
  }
  if (row.class === 'test-script' && !scriptExtensions.has(path.extname(row.path).toLowerCase())) {
    throw new Error('test-script must use a recognized script extension');
  }
  const absolute = path.resolve(projectRoot, ...row.path.split('/'));
  if (!isContained(projectRoot, absolute)) throw new Error(`Artifact path escaped project root: ${row.path}`);
  const stats = await fs.lstat(absolute);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error('Registered artifact must be a regular file, never a link or directory');
  row.sha256 = await sha256File(absolute);

  const loaded = await readArtifactIndex(projectRoot);
  if (loaded.issues.length > 0) throw new Error(`Cannot register against an invalid manifest: ${loaded.issues[0].problem}`);
  if (loaded.rows.some((existing) => existing.artifact_key === row.artifact_key)) throw new Error(`Duplicate artifact_key: ${row.artifact_key}`);
  if (loaded.rows.some((existing) => existing.path.toLowerCase() === row.path.toLowerCase())) throw new Error(`Duplicate artifact path: ${row.path}`);
  const existing = await fs.readFile(loaded.indexPath, 'utf8');
  const next = `${existing.trimEnd()}\n${artifactIndexHeader.map((column) => row[column]).join('\t')}\n`;
  const temp = path.join(path.dirname(loaded.indexPath), `tmp-artifact-manifest-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  await fs.writeFile(temp, next, 'utf8');
  try {
    await fs.rename(temp, loaded.indexPath);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
  return row;
}

export async function readArtifactIndex(projectRoot) {
  const indexPath = path.join(projectRoot, artifactIndexRelative);
  const issues = [];
  let text;
  try {
    text = await fs.readFile(indexPath, 'utf8');
  } catch (error) {
    return { indexPath, rows: [], issues: [{ path: artifactIndexRelative, problem: `Cannot read artifact index: ${error.message}` }] };
  }
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const header = lines.shift()?.split('\t') ?? [];
  if (header.join('\t') !== artifactIndexHeader.join('\t')) {
    issues.push({ path: artifactIndexRelative, problem: `Header must equal ${artifactIndexHeader.join(', ')}` });
    return { indexPath, rows: [], issues };
  }
  const rows = [];
  const keys = new Set();
  const paths = new Set();
  for (const [offset, line] of lines.entries()) {
    const cells = line.split('\t');
    const lineNumber = offset + 2;
    if (cells.length !== artifactIndexHeader.length) {
      issues.push({ path: `${artifactIndexRelative}:${lineNumber}`, problem: `Expected ${artifactIndexHeader.length} TSV columns, found ${cells.length}` });
      continue;
    }
    const row = Object.fromEntries(artifactIndexHeader.map((column, index) => [column, cells[index].trim()]));
    row.path = normalizeRelative(row.path);
    row.line = lineNumber;
    rows.push(row);
    if (!row.artifact_key) issues.push({ path: `${artifactIndexRelative}:${lineNumber}`, problem: 'artifact_key is required' });
    else if (keys.has(row.artifact_key)) issues.push({ path: `${artifactIndexRelative}:${lineNumber}`, problem: `Duplicate artifact_key: ${row.artifact_key}` });
    keys.add(row.artifact_key);
    if (!row.path) issues.push({ path: `${artifactIndexRelative}:${lineNumber}`, problem: 'path is required' });
    else if (paths.has(row.path.toLowerCase())) issues.push({ path: `${artifactIndexRelative}:${lineNumber}`, problem: `Duplicate artifact path: ${row.path}` });
    paths.add(row.path.toLowerCase());
  }
  return { indexPath, rows, issues };
}

export async function validateArtifactLayout(projectRoot) {
  const loaded = await readArtifactIndex(projectRoot);
  const issues = [...loaded.issues];
  const indexedPaths = new Set();
  for (const row of loaded.rows) {
    const item = `${artifactIndexRelative}:${row.line}`;
    if (!stages.has(row.stage)) issues.push({ path: item, problem: `Unsupported stage: ${row.stage}` });
    if (!classRules.has(row.class)) issues.push({ path: item, problem: `Unsupported class: ${row.class}` });
    if (!lifecycles.has(row.lifecycle)) issues.push({ path: item, problem: `Unsupported lifecycle: ${row.lifecycle}` });
    if (!statuses.has(row.status)) issues.push({ path: item, problem: `Unsupported status: ${row.status}` });
    if (!row.producer) issues.push({ path: item, problem: 'producer is required' });
    if (!/^[0-9a-f]{64}$/i.test(row.sha256)) issues.push({ path: item, problem: 'sha256 must be 64 hexadecimal characters' });
    if (row.lifecycle === 'reproducible' && !row.reproduce_command) {
      issues.push({ path: item, problem: 'reproducible artifacts require reproduce_command' });
    }
    if (!row.path || path.posix.isAbsolute(row.path) || /^[A-Za-z]:/.test(row.path) || row.path.split('/').includes('..')) {
      issues.push({ path: item, problem: `Artifact path must be a contained project-relative path: ${row.path}` });
      continue;
    }
    const rule = classRules.get(row.class);
    if (rule?.stage && row.stage !== rule.stage) issues.push({ path: item, problem: `${row.class} requires stage=${rule.stage}` });
    const requiredPrefix = rule?.prefix ?? (rule?.stagePrefix ? `${rule.stagePrefix}${row.stage}/` : '');
    if (requiredPrefix && !row.path.startsWith(requiredPrefix)) {
      issues.push({ path: item, problem: `${row.class} must be stored under ${requiredPrefix}` });
    }
    if (row.class === 'test-script' && !scriptExtensions.has(path.extname(row.path).toLowerCase())) {
      issues.push({ path: item, problem: 'test-script must use a recognized script extension' });
    }
    if (!isArtifactHarnessPath(row.path)) issues.push({ path: item, problem: `Path is outside artifact harness roots: ${row.path}` });
    const absolute = path.resolve(projectRoot, ...row.path.split('/'));
    if (!isContained(projectRoot, absolute)) {
      issues.push({ path: item, problem: `Artifact path escaped project root: ${row.path}` });
      continue;
    }
    indexedPaths.add(row.path.toLowerCase());
    try {
      const stats = await fs.lstat(absolute);
      if (row.status === 'archived') {
        issues.push({ path: row.path, problem: 'Artifact is status=archived but still exists at its managed source path' });
        continue;
      }
      if (stats.isSymbolicLink() || !stats.isFile()) {
        issues.push({ path: row.path, problem: 'Artifact index entries must resolve to regular files, never links or directories' });
      } else if (/^[0-9a-f]{64}$/i.test(row.sha256)) {
        const actualSha = await sha256File(absolute);
        if (actualSha.toLowerCase() !== row.sha256.toLowerCase()) issues.push({ path: row.path, problem: `SHA-256 mismatch: index=${row.sha256}, actual=${actualSha}` });
      }
    } catch (error) {
      if (!(row.status === 'archived' && error.code === 'ENOENT')) {
        issues.push({ path: row.path, problem: `Indexed artifact is missing or unreadable: ${error.message}` });
      }
    }
  }

  const files = [];
  for (const parts of artifactLayoutDirectories) {
    const root = path.join(projectRoot, ...parts);
    for (const entry of await collectFiles(root)) {
      const relative = normalizeRelative(path.relative(projectRoot, entry.absolute));
      files.push({ ...entry, path: relative });
      if (entry.kind === 'link') issues.push({ path: relative, problem: 'Links/reparse artifacts are forbidden in harness roots' });
      else if (!indexedPaths.has(relative.toLowerCase())) issues.push({ path: relative, problem: 'Unregistered artifact in a managed harness root' });
    }
  }
  const legacyEntries = await auditLegacyArtifactLayout(projectRoot);
  for (const entry of legacyEntries) issues.push({ path: entry.path, problem: entry.problem });
  return { ...loaded, issues, files, legacyEntries };
}

export function cleanupEligibleArtifactRows(rows) {
  return rows.filter((row) => ['disposable', 'reproducible'].includes(row.lifecycle)
    && ['complete', 'failed', 'superseded'].includes(row.status));
}

async function directEntries(root) {
  try {
    return await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function auditLegacyArtifactLayout(projectRoot) {
  const findings = [];
  for (const entry of await directEntries(projectRoot)) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || canonicalProjectDirectories.has(entry.name)) continue;
    findings.push({
      path: entry.name,
      kind: 'directory',
      reason: 'legacy-project-root',
      problem: 'Legacy/unscoped project-root directory must be inventoried and migrated by exact child files; do not delete the directory as a unit',
    });
  }
  const testRoot = path.join(projectRoot, '50_test');
  for (const entry of await directEntries(testRoot)) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && !canonicalTestDirectories.has(entry.name)) findings.push({
      path: `50_test/${entry.name}`,
      kind: 'directory',
      reason: 'legacy-test-tree',
      problem: 'Legacy test tree must be classified into screenshots, logs, release-runtime, artifacts, or an external emulator environment before cleanup',
    });
    if (entry.isFile() && !canonicalTestFiles.has(entry.name)) findings.push({
      path: `50_test/${entry.name}`,
      kind: 'file',
      reason: 'legacy-test-artifact',
      problem: 'Unscoped test artifact must move to a canonical test root and be registered before cleanup',
    });
  }
  const toolsRoot = path.join(projectRoot, '90_tools');
  for (const entry of await directEntries(toolsRoot)) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && !canonicalToolDirectories.has(entry.name)) findings.push({
      path: `90_tools/${entry.name}`,
      kind: 'directory',
      reason: 'legacy-tool-tree',
      problem: 'Unscoped tool directory must be inventoried and migrated by exact child files before cleanup',
    });
    if (entry.isFile() && !canonicalToolFiles.has(entry.name)) findings.push({
      path: `90_tools/${entry.name}`,
      kind: 'file',
      reason: 'legacy-tool-output',
      problem: 'Tool output must move to 90_tools/work/<stage> or another managed root and be registered before cleanup',
    });
  }
  const scriptsRoot = path.join(toolsRoot, 'scripts');
  for (const entry of await directEntries(scriptsRoot)) {
    if (entry.isFile() && testLikeScript.test(entry.name)) findings.push({
      path: `90_tools/scripts/${entry.name}`,
      kind: 'file',
      reason: 'legacy-test-script',
      problem: 'Test/QA/probe script must move to 90_tools/scripts/test and be registered before cleanup',
    });
  }
  return findings.sort((left, right) => left.path.localeCompare(right.path));
}
