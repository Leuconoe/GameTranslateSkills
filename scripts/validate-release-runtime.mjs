#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const titleIdPattern = /^[0-9A-Fa-f]{16}$/;
const shaPattern = /^[0-9a-f]{64}$/i;
const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const requiredChecks = new Set([
  'boot', 'title_screen', 'gameplay_entry', 'korean_text', 'font_glyphs', 'save_load', 'image_assets',
]);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function isWithinRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function pathKey(target) {
  const resolved = path.resolve(target);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPng(buffer) {
  return buffer.length >= 24
    && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && buffer.subarray(12, 16).toString('ascii') === 'IHDR'
    && buffer.readUInt32BE(16) > 0
    && buffer.readUInt32BE(20) > 0;
}

function validProjectRelative(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes('\\')
      || value.includes('\0') || /^[A-Za-z]:/.test(value)) return false;
  return value.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

async function regularFile(target, label, issues, { projectRoot = null, projectRealRoot = null } = {}) {
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      issues.push(`${label} must be a regular non-link file`);
      return null;
    }
    const realPath = await fs.realpath(target);
    if (projectRoot && projectRealRoot && !isWithinRoot(projectRealRoot, realPath)) {
      issues.push(`${label} resolves outside project root`);
      return null;
    }
    const buffer = await fs.readFile(target);
    return { target, realPath, stat, buffer, sha256: sha256(buffer) };
  } catch (error) {
    issues.push(`cannot read ${label}: ${error.message}`);
    return null;
  }
}

async function projectEvidence(projectRoot, projectRealRoot, value, label, issues) {
  if (!validProjectRelative(value)) {
    issues.push(`${label} must be a forward-slash project-relative path`);
    return null;
  }
  const target = path.resolve(projectRoot, ...value.split('/'));
  if (!isWithinRoot(projectRoot, target)) {
    issues.push(`${label} escapes project root`);
    return null;
  }
  return regularFile(target, label, issues, { projectRoot, projectRealRoot });
}

function compareHash(evidence, declared, label, issues) {
  if (!shaPattern.test(declared ?? '')) {
    issues.push(`${label} must be a 64-hex SHA-256 value`);
  } else if (evidence && evidence.sha256 !== declared.toLowerCase()) {
    issues.push(`${label} does not match current file bytes`);
  }
}

function exact(receipt, key, expected, issues) {
  if (receipt?.[key] !== expected) issues.push(`${key} must equal ${JSON.stringify(expected)}`);
}

async function readProjectPolicies(projectRoot, issues) {
  let text;
  try {
    text = await fs.readFile(path.join(projectRoot, 'PROJECT.md'), 'utf8');
  } catch (error) {
    issues.push(`cannot read PROJECT.md runtime policies: ${error.message}`);
    return {};
  }
  const policies = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*([a-z][a-z0-9_]*)\s*:\s*([^\r\n]+)$/i);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (Object.hasOwn(policies, key)) issues.push(`PROJECT.md duplicates runtime policy ${key}`);
    policies[key] = match[2].trim().split(/\s+[—#]/, 1)[0].trim().replace(/^`|`$/g, '');
  }
  return policies;
}

function parseHttpsUrl(value, label, issues) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      issues.push(`${label} must be a credential-free HTTPS URL`);
      return null;
    }
    return parsed;
  } catch {
    issues.push(`${label} must be a valid HTTPS URL`);
    return null;
  }
}

function validateOfficialSource(receipt, config, issues) {
  const sources = config?.final_qa?.sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    issues.push('platform runtime contract has no official release sources');
    return;
  }
  const source = sources.find((entry) => entry.emulator_name === receipt.emulator_name);
  if (!source) {
    issues.push(`emulator_name is not an allowlisted official release source: ${receipt.emulator_name}`);
    return;
  }
  const page = parseHttpsUrl(receipt.official_release_page, 'official_release_page', issues);
  const download = parseHttpsUrl(receipt.official_download_url, 'official_download_url', issues);
  if (page && !source.release_page_prefixes.some((prefix) => receipt.official_release_page === prefix
      || receipt.official_release_page.startsWith(`${prefix}/`))) {
    issues.push('official_release_page is outside the configured official release pages');
  }
  if (page) {
    const segments = page.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
    const tagIndex = segments.lastIndexOf('tag');
    if (tagIndex < 0 || segments[tagIndex + 1] !== receipt.emulator_version || tagIndex + 2 !== segments.length) {
      issues.push('official_release_page must be the exact tag page for emulator_version');
    }
  }
  if (download && !source.allowed_download_hosts.includes(download.hostname.toLowerCase())) {
    issues.push(`official_download_url host is not allowlisted: ${download.hostname}`);
  }
}

function validateBuildManifest(evidence, buildId, issues) {
  if (!evidence) return;
  const lines = evidence.buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    issues.push('final build manifest must contain a header and at least one build row');
    return;
  }
  const header = lines[0].split('\t');
  const buildIndex = header.indexOf('build_id');
  const resultIndex = header.indexOf('device_result');
  if (buildIndex < 0) {
    issues.push('final build manifest is missing build_id');
    return;
  }
  if (resultIndex < 0) issues.push('final build manifest is missing device_result');
  const matches = lines.slice(1).filter((line) => line.split('\t')[buildIndex] === buildId);
  if (matches.length !== 1) issues.push(`final_build_id must identify exactly one build manifest row; found ${matches.length}`);
  if (matches.length === 1 && resultIndex >= 0
      && matches[0].split('\t')[resultIndex] !== 'PASS (official-release-runtime)') {
    issues.push('final build manifest device_result must be PASS (official-release-runtime)');
  }
}

async function validateActiveMod(receipt, projectRoot, projectRealRoot, issues) {
  const manifest = await projectEvidence(
    projectRoot, projectRealRoot, receipt.active_mod_manifest_path, 'active_mod_manifest_path', issues,
  );
  compareHash(manifest, receipt.active_mod_manifest_sha256, 'active_mod_manifest_sha256', issues);

  if (typeof receipt.active_mod_root !== 'string' || !path.isAbsolute(receipt.active_mod_root)) {
    issues.push('active_mod_root must be the absolute external emulator mod directory');
    return;
  }
  const modRoot = path.resolve(receipt.active_mod_root);
  let modRealRoot;
  try {
    const stat = await fs.lstat(modRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('not a regular directory');
    modRealRoot = await fs.realpath(modRoot);
    if (isWithinRoot(projectRealRoot, modRealRoot)) throw new Error('must remain outside the project root');
  } catch (error) {
    issues.push(`cannot use active_mod_root: ${error.message}`);
    return;
  }
  if (!manifest) return;

  const lines = manifest.buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
  if (lines[0] !== 'relative_path\tsha256\tsize_bytes' || lines.length < 2) {
    issues.push('active mod manifest must have the exact header and at least one data row');
    return;
  }
  const declared = new Map();
  for (const [index, line] of lines.slice(1).entries()) {
    const cells = line.split('\t');
    if (cells.length !== 3 || !validProjectRelative(cells[0])) {
      issues.push(`active mod manifest line ${index + 2} must be relative_path, sha256, size_bytes`);
      continue;
    }
    if (declared.has(cells[0])) {
      issues.push(`active mod manifest line ${index + 2} duplicates ${cells[0]}`);
      continue;
    }
    if (!shaPattern.test(cells[1])) issues.push(`active mod manifest line ${index + 2} has an invalid SHA-256`);
    if (!/^\d+$/.test(cells[2])) issues.push(`active mod manifest line ${index + 2} has an invalid size_bytes`);
    declared.set(cells[0], { sha256: cells[1].toLowerCase(), size: Number(cells[2]), line: index + 2 });
  }

  const observed = new Map();
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        issues.push(`active mod contains a symbolic link: ${path.relative(modRoot, target)}`);
      } else if (entry.isDirectory()) {
        await walk(target);
      } else if (entry.isFile()) {
        const realPath = await fs.realpath(target);
        if (!isWithinRoot(modRealRoot, realPath)) {
          issues.push(`active mod file resolves outside its root: ${path.relative(modRoot, target)}`);
          continue;
        }
        const relative = path.relative(modRoot, target).split(path.sep).join('/');
        const buffer = await fs.readFile(target);
        observed.set(relative, { sha256: sha256(buffer), size: buffer.length });
      }
    }
  }
  await walk(modRoot);
  for (const [relative, expected] of declared) {
    const actual = observed.get(relative);
    if (!actual) issues.push(`active mod is missing declared file: ${relative}`);
    else if (actual.sha256 !== expected.sha256 || actual.size !== expected.size) {
      issues.push(`active mod bytes differ from manifest: ${relative}`);
    }
  }
  for (const relative of observed.keys()) if (!declared.has(relative)) issues.push(`active mod has an undeclared file: ${relative}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flag(args, 'help')) {
    console.log('Usage: npm run runtime:validate -- --project-root <project> [--receipt <50_test/RELEASE_RUNTIME_QA.json>]');
    return;
  }
  const projectRoot = path.resolve(requiredOption(args, 'project-root'));
  const projectRealRoot = await fs.realpath(projectRoot);
  const projectId = path.basename(projectRoot).toUpperCase();
  if (path.basename(path.dirname(projectRoot)) !== '_work' || !titleIdPattern.test(projectId)) {
    throw new Error('--project-root must be an exact <title>/_work/<16-hex-title-id> project');
  }
  const receiptPath = path.resolve(option(args, 'receipt') ?? path.join(projectRoot, '50_test', 'RELEASE_RUNTIME_QA.json'));
  if (!isWithinRoot(projectRoot, receiptPath)) throw new Error('--receipt must remain inside the project root');
  const issues = [];
  const canonicalReceiptPath = path.join(projectRoot, '50_test', 'RELEASE_RUNTIME_QA.json');
  if (pathKey(receiptPath) !== pathKey(canonicalReceiptPath)) issues.push('release runtime receipt must use 50_test/RELEASE_RUNTIME_QA.json');
  const projectPolicies = await readProjectPolicies(projectRoot, issues);
  const receiptEvidence = await regularFile(receiptPath, 'release runtime receipt', issues, { projectRoot, projectRealRoot });
  let receipt;
  if (receiptEvidence) {
    try {
      receipt = JSON.parse(receiptEvidence.buffer.toString('utf8'));
    } catch (error) {
      issues.push(`release runtime receipt is invalid JSON: ${error.message}`);
    }
  }
  if (receipt) {
    exact(receipt, 'schema_version', 1, issues);
    exact(receipt, 'stage', 'final-qa', issues);
    exact(receipt, 'title_id', projectId, issues);
    exact(receipt, 'execution_surface', 'official-distribution-release', issues);
    exact(receipt, 'launch_mode', 'direct', issues);
    exact(receipt, 'mcp_used', false, issues);
    exact(receipt, 'release_channel', 'official-release', issues);
    exact(receipt, 'result', 'pass', issues);
    if (typeof receipt.final_build_id !== 'string' || receipt.final_build_id.trim().length < 3) issues.push('final_build_id must be a concrete build identifier');
    if (typeof receipt.emulator_version !== 'string' || receipt.emulator_version.trim().length < 2) issues.push('emulator_version must be exact and non-empty');
    if (!['한국', '대한민국'].includes(receipt.system_region)) issues.push('system_region must be 한국 or 대한민국');
    if (receipt.system_language !== '한국어') issues.push('system_language must be 한국어');
    if (typeof receipt.tested_at !== 'string' || !isoTimestampPattern.test(receipt.tested_at)
        || !Number.isFinite(Date.parse(receipt.tested_at))) issues.push('tested_at must be an ISO-8601 timestamp with timezone');
    if (!['approved', 'not_required'].includes(projectPolicies.runtime_authorization)) {
      issues.push('PROJECT.md runtime_authorization must be approved or not_required for final QA');
    }
    if (!['required', 'N/A'].includes(projectPolicies.image_scope)) {
      issues.push('PROJECT.md image_scope must be resolved to required or N/A before final QA');
    }

    const platform = typeof receipt.platform === 'string' ? receipt.platform.toLowerCase() : '';
    if (!/^[a-z0-9_-]+$/.test(platform)) issues.push('platform must be a safe platform adapter name');
    let config = null;
    if (platform) {
      try {
        config = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'platforms', platform, 'runtime-emulators.json'), 'utf8'));
      } catch (error) {
        issues.push(`cannot read platform runtime contract: ${error.message}`);
      }
    }
    if (config) {
      exact(config.final_qa, 'execution_surface', 'official-distribution-release', issues);
      exact(config.final_qa, 'launch_mode', 'direct', issues);
      exact(config.final_qa, 'mcp_allowed', false, issues);
      exact(config.final_qa, 'release_channel', 'official-release', issues);
      validateOfficialSource(receipt, config, issues);
    }

    const buildManifest = await projectEvidence(
      projectRoot, projectRealRoot, receipt.final_build_manifest_path, 'final_build_manifest_path', issues,
    );
    if (receipt.final_build_manifest_path !== '40_build/BUILD_MANIFEST.tsv') {
      issues.push('final_build_manifest_path must use 40_build/BUILD_MANIFEST.tsv');
    }
    compareHash(buildManifest, receipt.final_build_manifest_sha256, 'final_build_manifest_sha256', issues);
    validateBuildManifest(buildManifest, receipt.final_build_id, issues);

    if (typeof receipt.emulator_binary_path !== 'string' || !path.isAbsolute(receipt.emulator_binary_path)) {
      issues.push('emulator_binary_path must be an absolute path to the executed release binary');
    } else {
      const binaryPath = path.resolve(receipt.emulator_binary_path);
      const binary = await regularFile(binaryPath, 'emulator_binary_path', issues);
      if (binary && isWithinRoot(projectRealRoot, binary.realPath)) issues.push('emulator_binary_path must be external to the project root');
      if (binary && binary.buffer.length === 0) issues.push('emulator_binary_path must not be empty');
      compareHash(binary, receipt.emulator_binary_sha256, 'emulator_binary_sha256', issues);
    }

    if (receipt.active_mod_manifest_path !== '50_test/release-runtime/ACTIVE_MOD_MANIFEST.tsv') {
      issues.push('active_mod_manifest_path must use 50_test/release-runtime/ACTIVE_MOD_MANIFEST.tsv');
    }
    await validateActiveMod(receipt, projectRoot, projectRealRoot, issues);
    const runtimeEvidence = new Map();
    for (const pair of [
      ['emulator_log_path', 'emulator_log_sha256'],
      ['title_screen_evidence_path', 'title_screen_evidence_sha256'],
      ['gameplay_evidence_path', 'gameplay_evidence_sha256'],
    ]) {
      const evidence = await projectEvidence(projectRoot, projectRealRoot, receipt[pair[0]], pair[0], issues);
      compareHash(evidence, receipt[pair[1]], pair[1], issues);
      runtimeEvidence.set(pair[0], evidence);
    }
    if (typeof receipt.emulator_log_path !== 'string' || !receipt.emulator_log_path.startsWith('50_test/logs/')) {
      issues.push('emulator_log_path must remain under 50_test/logs/');
    }
    for (const field of ['title_screen_evidence_path', 'gameplay_evidence_path']) {
      if (typeof receipt[field] !== 'string' || !receipt[field].startsWith('50_test/screenshots/') || !receipt[field].endsWith('.png')) {
        issues.push(`${field} must be a PNG under 50_test/screenshots/`);
      }
      const evidence = runtimeEvidence.get(field);
      if (evidence && !isPng(evidence.buffer)) issues.push(`${field} must contain valid PNG header and dimensions`);
    }
    const titleEvidence = runtimeEvidence.get('title_screen_evidence_path');
    const gameplayEvidence = runtimeEvidence.get('gameplay_evidence_path');
    if (titleEvidence && gameplayEvidence
        && (pathKey(titleEvidence.realPath) === pathKey(gameplayEvidence.realPath)
          || titleEvidence.sha256 === gameplayEvidence.sha256)) {
      issues.push('title and gameplay evidence must be distinct screenshots with distinct bytes');
    }
    const logEvidence = runtimeEvidence.get('emulator_log_path');
    if (logEvidence && logEvidence.buffer.length === 0) issues.push('emulator_log_path must not be empty');

    const checkKeys = receipt.checks && typeof receipt.checks === 'object' && !Array.isArray(receipt.checks)
      ? Object.keys(receipt.checks) : [];
    if (checkKeys.length !== requiredChecks.size || checkKeys.some((key) => !requiredChecks.has(key))) {
      issues.push(`checks must contain exactly: ${[...requiredChecks].join(', ')}`);
    }
    for (const check of requiredChecks) {
      const allowed = check === 'image_assets' ? ['pass', 'not-applicable'] : ['pass'];
      if (!allowed.includes(receipt.checks?.[check])) issues.push(`checks.${check} must be ${allowed.join(' or ')}`);
    }
    if (receipt.checks?.image_assets === 'not-applicable' && projectPolicies.image_scope !== 'N/A') {
      issues.push('checks.image_assets=not-applicable requires PROJECT.md image_scope=N/A');
    }
  }

  console.log(`Receipt: ${receiptPath}`);
  console.log(`Issues: ${issues.length}`);
  for (const issue of issues) console.log(`ERROR\t${issue}`);
  if (issues.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exitCode = 1;
});
