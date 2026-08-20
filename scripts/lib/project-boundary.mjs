import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectProjectRoot, projectPlatformFromId, projectRootShapeDescription } from './project-identity.mjs';

const sourceExtensions = new Set(['.nsp', '.xci']);
const projectFiles = new Set(['PROJECT.md', 'WORK_LOG.md', 'HANDOFF.md']);
const projectDirectories = new Set(['00_source', '10_extract', '20_reference', '30_translation', '40_build', '50_test', '90_tools']);
const titleFiles = new Set(['HANDOFF.md']);
const stageRoots = new Map([
  ['source', ['00_source/']],
  ['extract', ['10_extract/', '90_tools/work/extract/']],
  ['reference', ['20_reference/']],
  ['translation', ['30_translation/', '90_tools/work/translation/']],
  ['build', ['40_build/', '90_tools/work/build/']],
  ['test', ['50_test/', '90_tools/scripts/test/', '90_tools/work/test/']],
  ['tools', ['90_tools/']],
]);

function normalizedRelative(root, target) {
  return path.relative(path.resolve(root), path.resolve(target)).replaceAll('\\', '/');
}

function isContained(root, target) {
  const relative = normalizedRelative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith('../') && !path.posix.isAbsolute(relative);
}

async function directEntries(root) {
  try {
    return await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function collectLinks(root, current = root, output = []) {
  for (const entry of await directEntries(current)) {
    const target = path.join(current, entry.name);
    const stats = await fs.lstat(target);
    if (stats.isSymbolicLink()) {
      output.push(normalizedRelative(root, target));
    } else if (stats.isDirectory()) {
      await collectLinks(root, target, output);
    }
  }
  return output;
}

async function assertNoLinkedAncestor(projectRoot, target) {
  let current = path.resolve(target);
  while (isContained(projectRoot, current)) {
    try {
      const stats = await fs.lstat(current);
      if (stats.isSymbolicLink()) return normalizedRelative(projectRoot, current);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

async function configuredGameExecutable(projectRoot, titleRoot) {
  try {
    const project = await fs.readFile(path.join(projectRoot, 'PROJECT.md'), 'utf8');
    const raw = project.match(/^\s*-\s*game_executable\s*:\s*(.+?)\s*$/im)?.[1]?.trim();
    if (!raw || path.isAbsolute(raw) || raw.includes('\0')) return null;
    const target = path.resolve(titleRoot, ...raw.replaceAll('\\', '/').split('/'));
    if (!isContained(titleRoot, target)) return null;
    const stats = await fs.lstat(target);
    return stats.isFile() && !stats.isSymbolicLink() && path.extname(target).toLowerCase() === '.exe' ? target : null;
  } catch {
    return null;
  }
}

export async function validateProjectBoundary(projectRoot, { stage = null, outputs = [], scanLinks = true } = {}) {
  const identity = inspectProjectRoot(projectRoot);
  const {
    projectRoot: resolvedProject, workRoot, titleRoot, projectId, platform,
  } = identity;
  const issues = [];
  if (!identity.valid) {
    issues.push({ path: resolvedProject, problem: `Project root must be ${projectRootShapeDescription()}` });
    return { projectRoot: resolvedProject, titleRoot, projectId, platform, issues };
  }
  const projectStats = await fs.lstat(resolvedProject).catch(() => null);
  if (!projectStats?.isDirectory() || projectStats.isSymbolicLink()) {
    issues.push({ path: resolvedProject, problem: 'Project root must be a real directory, never a link/reparse path' });
    return { projectRoot: resolvedProject, titleRoot, projectId, platform, issues };
  }

  const titleEntries = await directEntries(titleRoot);
  if (platform === 'nsw') {
    if (!titleEntries.some((entry) => entry.isFile() && sourceExtensions.has(path.extname(entry.name).toLowerCase()))) {
      issues.push({ path: titleRoot, problem: 'Title root must directly contain a source NSP/XCI package' });
    }
    for (const entry of titleEntries) {
      if (entry.name === '_work') continue;
      if (entry.isFile() && (sourceExtensions.has(path.extname(entry.name).toLowerCase()) || titleFiles.has(entry.name))) continue;
      issues.push({ path: path.join(titleRoot, entry.name), problem: 'Generated/unclassified item is outside the title project workspace' });
    }
  } else if (!titleEntries.some((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.exe')
      && !(await configuredGameExecutable(resolvedProject, titleRoot))) {
    issues.push({ path: titleRoot, problem: 'Steam/PC title root must directly contain at least one game executable' });
  }
  for (const entry of await directEntries(workRoot)) {
    const siblingPlatform = entry.isDirectory() ? projectPlatformFromId(entry.name) : null;
    if (entry.name.toLowerCase() === projectId.toLowerCase() || siblingPlatform) continue;
    issues.push({ path: path.join(workRoot, entry.name), problem: 'Foreign or unclassified item exists beside the exact project ID under _work' });
  }
  for (const entry of await directEntries(resolvedProject)) {
    if (entry.isDirectory() && !entry.isSymbolicLink() && projectDirectories.has(entry.name)) continue;
    if (entry.isFile() && projectFiles.has(entry.name)) continue;
    issues.push({ path: entry.name, problem: 'Project-root item is outside the canonical functional roots' });
  }
  if (scanLinks) {
    for (const linkedPath of await collectLinks(resolvedProject)) {
      issues.push({ path: linkedPath, problem: 'Link/reparse point is forbidden inside the project workspace boundary' });
    }
  }
  if (stage !== null && !stageRoots.has(stage)) issues.push({ path: '-', problem: `Unsupported functional stage: ${stage}` });
  for (const rawOutput of outputs) {
    const absolute = path.isAbsolute(rawOutput) ? path.resolve(rawOutput) : path.resolve(resolvedProject, rawOutput);
    const relative = normalizedRelative(resolvedProject, absolute);
    if (!isContained(resolvedProject, absolute)) {
      issues.push({ path: rawOutput, problem: 'Output path escapes the exact title project workspace' });
      continue;
    }
    const linkedAncestor = await assertNoLinkedAncestor(resolvedProject, absolute);
    if (linkedAncestor) issues.push({ path: rawOutput, problem: `Output path crosses a link/reparse ancestor: ${linkedAncestor}` });
    if (stage && stageRoots.has(stage) && !stageRoots.get(stage).some((prefix) => relative.startsWith(prefix))) {
      issues.push({ path: rawOutput, problem: `Output for stage=${stage} must stay under ${stageRoots.get(stage).join(' or ')}` });
    }
  }
  return { projectRoot: resolvedProject, titleRoot, projectId, platform, issues };
}
