import fs from 'node:fs/promises';
import path from 'node:path';
import { createDeterministicZip, inspectDeterministicZip, sha256File } from './nsw-release-zip.mjs';
import { normalizeProjectId, projectPlatformFromId } from './project-identity.mjs';

export const steamPatchManifestHeader = [
  'relative_path',
  'target_path',
  'payload_kind',
  'redistribution_status',
  'source_license',
  'sha256',
  'size_bytes',
].join('\t');

const allowedPayloadKinds = new Set([
  'translation-map', 'plugin', 'font', 'config', 'binary-delta', 'documentation',
]);
const forbiddenExtensions = new Set([
  '.nsp', '.xci', '.iso', '.img', '.cue', '.assets', '.resource', '.ress', '.bundle',
  '.unity3d', '.pak', '.cpk', '.arc', '.vpk', '.cab', '.msi',
]);
const forbiddenBasenames = new Set([
  'assembly-csharp.dll', 'gameassembly.dll', 'unityplayer.dll', 'globalgamemanagers',
  'resources.assets', 'steam_api.dll', 'steam_api64.dll',
]);

function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function normalizeRelative(value, label) {
  const text = String(value ?? '');
  if (!text || text.includes('\\') || path.isAbsolute(text) || /^[A-Za-z]:/.test(text)) {
    throw new Error(`${label} must be a forward-slash install-relative path: ${text}`);
  }
  const parts = text.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`Invalid ${label}: ${text}`);
  if (parts[0].toLowerCase() === '_work') throw new Error(`${label} must not target the project workspace: ${text}`);
  const basename = parts.at(-1).toLowerCase();
  const extension = path.posix.extname(basename).toLowerCase();
  if (forbiddenExtensions.has(extension) || forbiddenBasenames.has(basename) || /^sharedassets.*\.assets$/i.test(basename)) {
    throw new Error(`Original-game or installer payload is forbidden in a Steam/PC release: ${text}`);
  }
  return parts.join('/');
}

function normalizeSteamProjectId(value) {
  const id = normalizeProjectId(value);
  if (!['steam', 'pc'].includes(projectPlatformFromId(id))) throw new Error(`Steam/PC project ID required: ${value}`);
  return id;
}

async function regularDirectory(target, label) {
  const stats = await fs.lstat(target).catch(() => null);
  if (!stats?.isDirectory() || stats.isSymbolicLink()) throw new Error(`${label} must be a regular directory: ${target}`);
  return fs.realpath(target);
}

async function walkFiles(root) {
  const realRoot = await regularDirectory(root, 'Steam/PC overlay root');
  const output = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      const stats = await fs.lstat(target);
      if (entry.isSymbolicLink() || stats.isSymbolicLink()) throw new Error(`Links/reparse paths are forbidden in Steam/PC overlay: ${target}`);
      const realTarget = await fs.realpath(target);
      if (!isWithin(realRoot, realTarget)) throw new Error(`Steam/PC overlay entry resolves outside its root: ${target}`);
      if (stats.isDirectory()) await walk(target);
      else if (stats.isFile()) {
        const relativePath = normalizeRelative(path.relative(root, target).split(path.sep).join('/'), 'relative_path');
        output.push({ absolutePath: target, relativePath, size: stats.size });
      } else throw new Error(`Unsupported Steam/PC overlay entry type: ${target}`);
    }
  }
  await walk(root);
  if (output.length === 0) throw new Error(`Steam/PC overlay contains no patch files: ${root}`);
  const folded = new Set();
  for (const file of output) {
    const key = file.relativePath.toLowerCase();
    if (folded.has(key)) throw new Error(`Case-colliding Steam/PC overlay paths are forbidden: ${file.relativePath}`);
    folded.add(key);
  }
  return output;
}

async function readPatchManifest(manifestPath) {
  const text = await fs.readFile(manifestPath, 'utf8');
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines[0] !== steamPatchManifestHeader || lines.length < 2) {
    throw new Error(`PATCH_MANIFEST.tsv must use the exact header and contain at least one row: ${steamPatchManifestHeader}`);
  }
  const rows = [];
  const seen = new Set();
  for (const [index, line] of lines.slice(1).entries()) {
    const cells = line.split('\t');
    if (cells.length !== 7) throw new Error(`PATCH_MANIFEST.tsv line ${index + 2} must contain exactly 7 columns`);
    const [rawRelative, rawTarget, payloadKind, redistributionStatus, sourceLicense, sha256, sizeBytes] = cells;
    const relativePath = normalizeRelative(rawRelative, 'relative_path');
    const targetPath = normalizeRelative(rawTarget, 'target_path');
    if (relativePath !== targetPath) throw new Error(`PATCH_MANIFEST.tsv line ${index + 2}: relative_path and target_path must match exactly`);
    if (seen.has(relativePath.toLowerCase())) throw new Error(`PATCH_MANIFEST.tsv duplicates ${relativePath}`);
    seen.add(relativePath.toLowerCase());
    if (!allowedPayloadKinds.has(payloadKind)) throw new Error(`PATCH_MANIFEST.tsv line ${index + 2}: unsupported payload_kind ${payloadKind}`);
    if (redistributionStatus !== 'cleared') throw new Error(`PATCH_MANIFEST.tsv line ${index + 2}: redistribution_status must be cleared`);
    if (!sourceLicense || /^(unknown|pending|unverified)$/i.test(sourceLicense)) {
      throw new Error(`PATCH_MANIFEST.tsv line ${index + 2}: source_license must record project authorship, a license, or permission evidence`);
    }
    if (!/^[0-9a-f]{64}$/i.test(sha256)) throw new Error(`PATCH_MANIFEST.tsv line ${index + 2}: invalid SHA-256`);
    if (!/^(0|[1-9][0-9]*)$/.test(sizeBytes)) throw new Error(`PATCH_MANIFEST.tsv line ${index + 2}: invalid size_bytes`);
    rows.push({
      relativePath, targetPath, payloadKind, redistributionStatus, sourceLicense,
      sha256: sha256.toUpperCase(), size: Number(sizeBytes),
    });
  }
  return { text, rows };
}

export async function inventorySteamPatch({ overlayRoot, manifestPath }) {
  const [files, manifest] = await Promise.all([walkFiles(overlayRoot), readPatchManifest(manifestPath)]);
  const rows = new Map(manifest.rows.map((row) => [row.relativePath.toLowerCase(), row]));
  for (const file of files) {
    const row = rows.get(file.relativePath.toLowerCase());
    if (!row) throw new Error(`Steam/PC overlay file is not declared in PATCH_MANIFEST.tsv: ${file.relativePath}`);
    const hash = await sha256File(file.absolutePath);
    if (hash !== row.sha256 || file.size !== row.size) throw new Error(`PATCH_MANIFEST.tsv bytes differ from overlay: ${file.relativePath}`);
    rows.delete(file.relativePath.toLowerCase());
  }
  if (rows.size > 0) throw new Error(`PATCH_MANIFEST.tsv declares missing overlay files: ${[...rows.values()].map((row) => row.relativePath).join(', ')}`);
  return { files, manifest };
}

export async function createDeterministicSteamZip({ projectId, overlayRoot, manifestPath, outputPath }) {
  normalizeSteamProjectId(projectId);
  const inventory = await inventorySteamPatch({ overlayRoot, manifestPath });
  const files = inventory.files.map((file) => ({ ...file, archivePath: `patch/${file.relativePath}` }));
  files.push({
    absolutePath: manifestPath,
    archivePath: 'PATCH_MANIFEST.tsv',
    size: Buffer.byteLength(inventory.manifest.text),
  });
  return createDeterministicZip({ files, outputPath });
}

export async function validateSteamRelease({ projectId, zipPath, overlayRoot, manifestPath, allowTemporaryName = false }) {
  const id = normalizeSteamProjectId(projectId);
  const resolvedZip = path.resolve(zipPath);
  if (!allowTemporaryName && path.basename(resolvedZip) !== `${id}.zip`) throw new Error(`Steam/PC release filename must be exactly ${id}.zip`);
  if (!allowTemporaryName && path.basename(path.dirname(resolvedZip)).toLowerCase() !== 'releases') {
    throw new Error('Steam/PC release ZIP must be directly under 40_build/releases');
  }
  const inventory = await inventorySteamPatch({ overlayRoot, manifestPath });
  const inspected = await inspectDeterministicZip(resolvedZip);
  const expected = new Map();
  for (const file of inventory.files) expected.set(`patch/${file.relativePath}`, {
    sha256: await sha256File(file.absolutePath), size: file.size,
  });
  expected.set('PATCH_MANIFEST.tsv', {
    sha256: await sha256File(manifestPath), size: Buffer.byteLength(inventory.manifest.text),
  });
  if (expected.size !== inspected.entries.length) throw new Error(`Steam/PC ZIP/source file count mismatch: ${inspected.entries.length} != ${expected.size}`);
  for (const entry of inspected.entries) {
    const source = expected.get(entry.path);
    if (!source) throw new Error(`Unexpected Steam/PC ZIP entry: ${entry.path}`);
    if (source.sha256 !== entry.sha256 || source.size !== entry.size) throw new Error(`Steam/PC ZIP/source payload mismatch: ${entry.path}`);
    expected.delete(entry.path);
  }
  if (expected.size > 0) throw new Error(`Steam/PC ZIP is missing source files: ${[...expected.keys()].join(', ')}`);
  return { projectId: id, ...inspected };
}
