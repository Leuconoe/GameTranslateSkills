import path from 'node:path';

export const nswProjectIdPattern = /^[0-9A-Fa-f]{16}$/;
export const steamProjectIdPattern = /^steam-[1-9][0-9]{0,9}$/;
export const pcProjectIdPattern = /^pc-[a-z0-9](?:[a-z0-9_-]{0,46}[a-z0-9])?$/;

export function projectPlatformFromId(value) {
  const raw = String(value ?? '').trim();
  if (nswProjectIdPattern.test(raw)) return 'nsw';
  const lower = raw.toLowerCase();
  if (steamProjectIdPattern.test(lower)) return 'steam';
  if (pcProjectIdPattern.test(lower)) return 'pc';
  return null;
}

export function normalizeProjectId(value) {
  const platform = projectPlatformFromId(value);
  if (!platform) throw new Error(`Invalid project ID: ${value}`);
  const raw = String(value).trim();
  return platform === 'nsw' ? raw.toUpperCase() : raw.toLowerCase();
}

export function inspectProjectRoot(projectRoot) {
  const resolved = path.resolve(projectRoot);
  const workRoot = path.dirname(resolved);
  const titleRoot = path.dirname(workRoot);
  const rawId = path.basename(resolved);
  const platform = projectPlatformFromId(rawId);
  const projectId = platform ? normalizeProjectId(rawId) : rawId;
  const valid = path.basename(workRoot) === '_work' && platform !== null;
  return { projectRoot: resolved, workRoot, titleRoot, projectId, platform, valid };
}

export function projectRootShapeDescription() {
  return '<title-root>/_work/<16-hex-title-id|steam-app-id|pc-slug>';
}
