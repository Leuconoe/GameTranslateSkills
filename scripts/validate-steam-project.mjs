#!/usr/bin/env node
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { flag, parseArgs, requiredOption } from './lib/args.mjs';
import { inspectProjectRoot } from './lib/project-identity.mjs';
import { validateProjectBoundary } from './lib/project-boundary.mjs';
import { validateArtifactLayout } from './lib/project-artifacts.mjs';
import { validateSteamRelease } from './lib/steam-release-zip.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredDirectories = [
  '00_source', '10_extract/source_snapshot', '10_extract/decompiled', '20_reference/external_patches',
  '20_reference/fonts', '20_reference/documents', '30_translation/text/translation_batches',
  '30_translation/text/reports', '30_translation/text/reviews',
  '30_translation/image_translation/for_translation/attempts',
  '30_translation/image_translation/reference', '30_translation/image_translation/prompts',
  '30_translation/image_translation/receipts', '30_translation/image_translation/probes',
  '30_translation/image_translation/reports', '40_build/overlay', '40_build/staging',
  '40_build/releases', '50_test/screenshots', '50_test/logs', '50_test/release-runtime',
  '90_tools/scripts', '90_tools/environment', '90_tools/cleanup',
];
const requiredFiles = [
  'PROJECT.md', 'WORK_LOG.md', 'HANDOFF.md', '00_source/SOURCE_INVENTORY.tsv',
  '20_reference/REFERENCE_INDEX.tsv', '30_translation/text/glossary.tsv',
  '30_translation/text/translation_manifest.tsv', '30_translation/text/CODEX_TRANSLATION_WORKFLOW.md',
  '30_translation/image_translation/reference/image_manifest.tsv',
  '30_translation/image_translation/IMAGE_GENERATION_MANIFEST.tsv',
  '40_build/PATCH_MANIFEST.tsv', '40_build/BUILD_MANIFEST.tsv', '50_test/TEST_LOG.md',
  '90_tools/PROJECT_ARTIFACT_MANIFEST.tsv',
];

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function isType(target, type) {
  try {
    const stats = await fs.lstat(target);
    return !stats.isSymbolicLink() && (type === 'file' ? stats.isFile() : stats.isDirectory());
  } catch { return false; }
}

async function policies(projectRoot) {
  const text = await fs.readFile(path.join(projectRoot, 'PROJECT.md'), 'utf8');
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*([a-z][a-z0-9_]*)\s*:\s*(.+?)\s*$/i);
    if (match) values[match[1].toLowerCase()] = match[2].trim().replace(/^`|`$/g, '');
  }
  return values;
}

function parseSteamManifest(text) {
  return {
    appId: text.match(/"appid"\s+"([0-9]+)"/i)?.[1] ?? null,
    buildId: text.match(/"buildid"\s+"([0-9]+)"/i)?.[1] ?? null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flag(args, 'help')) {
    console.log('Usage: npm run project:validate:steam -- --project-root <install-root/_work/steam-APPID|pc-slug> [--strict]');
    return;
  }
  const projectRoot = path.resolve(requiredOption(args, 'project-root'));
  const identity = inspectProjectRoot(projectRoot);
  if (!identity.valid || !['steam', 'pc'].includes(identity.platform)) throw new Error('--project-root must be a canonical Steam/PC project');
  const issues = [];
  for (const relative of requiredDirectories) {
    if (!(await isType(path.join(projectRoot, ...relative.split('/')), 'directory'))) issues.push(`${relative}: required directory is missing`);
  }
  for (const relative of requiredFiles) {
    if (!(await isType(path.join(projectRoot, ...relative.split('/')), 'file'))) issues.push(`${relative}: required file is missing`);
  }

  let projectPolicies = {};
  try { projectPolicies = await policies(projectRoot); } catch (error) { issues.push(`cannot read PROJECT.md: ${error.message}`); }
  if (projectPolicies.platform !== 'steam') issues.push('PROJECT.md platform must select the steam adapter');
  const expectedDistribution = identity.platform === 'steam' ? 'steam' : 'other-pc';
  if (projectPolicies.distribution !== expectedDistribution) issues.push(`PROJECT.md distribution must be ${expectedDistribution}`);
  if (projectPolicies.project_id !== identity.projectId) issues.push(`PROJECT.md project_id must be ${identity.projectId}`);
  if (!samePath(projectPolicies.source_install_root ?? '', identity.titleRoot)) issues.push('PROJECT.md source_install_root must equal the exact title root');
  if (projectPolicies.basic_test_backend !== 'direct-native') issues.push('PROJECT.md basic_test_backend must be direct-native');
  if (projectPolicies.mcp_session_scope !== 'none') issues.push('PROJECT.md mcp_session_scope must be none');
  if (projectPolicies.final_qa_runtime !== 'official-distribution-release') issues.push('PROJECT.md final_qa_runtime must be official-distribution-release');
  if (projectPolicies.final_qa_mcp_allowed !== 'false') issues.push('PROJECT.md final_qa_mcp_allowed must be false');
  if (projectPolicies.release_runtime_receipt !== '50_test/RELEASE_RUNTIME_QA.json') issues.push('PROJECT.md release_runtime_receipt must use the canonical path');
  if (!projectPolicies.release_contract?.includes(`40_build/releases/${identity.projectId}.zip`) || !projectPolicies.release_contract.includes('patch/')) {
    issues.push('PROJECT.md release_contract must name the canonical Steam/PC ZIP and patch/ root');
  }

  const executableRelative = projectPolicies.game_executable?.replaceAll('\\', '/');
  if (!executableRelative || path.isAbsolute(executableRelative)) issues.push('PROJECT.md game_executable must be install-root-relative');
  else {
    const executable = path.resolve(identity.titleRoot, ...executableRelative.split('/'));
    if (!isWithin(identity.titleRoot, executable) || !(await isType(executable, 'file')) || path.extname(executable).toLowerCase() !== '.exe') {
      issues.push('PROJECT.md game_executable does not resolve to a regular .exe inside the title root');
    }
  }

  if (identity.platform === 'steam') {
    const appId = identity.projectId.slice('steam-'.length);
    if (projectPolicies.steam_app_id !== appId) issues.push(`PROJECT.md steam_app_id must be ${appId}`);
    if (!path.isAbsolute(projectPolicies.source_manifest_path ?? '')) issues.push('PROJECT.md source_manifest_path must be an absolute Steam appmanifest path');
    else {
      try {
        const manifestStats = await fs.lstat(projectPolicies.source_manifest_path);
        if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) throw new Error('not a regular file');
        const manifest = parseSteamManifest(await fs.readFile(projectPolicies.source_manifest_path, 'utf8'));
        if (manifest.appId !== appId) issues.push(`Steam appmanifest appid differs from ${appId}`);
        if (manifest.buildId !== projectPolicies.distribution_build_id) issues.push('Steam appmanifest buildid differs from PROJECT.md distribution_build_id');
      } catch (error) { issues.push(`cannot validate Steam appmanifest: ${error.message}`); }
    }
  }

  const boundary = await validateProjectBoundary(projectRoot);
  for (const issue of boundary.issues) issues.push(`boundary ${issue.path}: ${issue.problem}`);
  const artifacts = await validateArtifactLayout(projectRoot);
  for (const issue of artifacts.issues) issues.push(`artifact ${issue.path}: ${issue.problem}`);

  const zipPath = path.join(projectRoot, '40_build', 'releases', `${identity.projectId}.zip`);
  if (await isType(zipPath, 'file')) {
    try {
      await validateSteamRelease({
        projectId: identity.projectId,
        zipPath,
        overlayRoot: path.join(projectRoot, '40_build', 'overlay'),
        manifestPath: path.join(projectRoot, '40_build', 'PATCH_MANIFEST.tsv'),
      });
    } catch (error) { issues.push(`release package: ${error.message}`); }
  }

  if (['passed'].includes(projectPolicies.qa_status) || projectPolicies.release_status === 'released') {
    try {
      await execFileAsync(process.execPath, [path.join(repositoryRoot, 'scripts', 'validate-release-runtime.mjs'), '--project-root', projectRoot]);
    } catch (error) { issues.push(`release runtime receipt: ${(error.stderr || error.stdout || error.message).trim()}`); }
  }
  if (projectPolicies.release_status === 'released' && projectPolicies.qa_status !== 'passed') issues.push('release_status=released requires qa_status=passed');
  if (flag(args, 'strict') && projectPolicies.release_status === 'released' && !(await isType(zipPath, 'file'))) issues.push('released project is missing the canonical ZIP');

  console.log(`Project: ${projectRoot}`);
  console.log(`Issues: ${issues.length}`);
  for (const issue of issues) console.log(`ERROR\t${issue}`);
  if (issues.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Steam/PC project validation failed: ${error.message}`);
  process.exitCode = 1;
});
