#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { artifactIndexHeader, artifactLayoutDirectories } from './lib/project-artifacts.mjs';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';
import { normalizeProjectId } from './lib/project-identity.mjs';
import { sha256File } from './lib/nsw-release-zip.mjs';
import { steamPatchManifestHeader } from './lib/steam-release-zip.mjs';

const imageGenerationManifestHeader = [
  'stable_key', 'source_path', 'source_sha256', 'reference_path', 'reference_sha256',
  'candidate_path', 'candidate_sha256', 'source_rgba_path', 'source_rgba_sha256',
  'candidate_rgba_path', 'candidate_rgba_sha256', 'source_width', 'source_height',
  'candidate_width', 'candidate_height', 'source_format', 'candidate_format',
  'source_color_mode', 'candidate_color_mode', 'alpha_policy', 'edit_regions', 'source_anchors',
  'candidate_anchors', 'atlas_page', 'source_atlas_rect', 'candidate_atlas_rect',
  'origin', 'generator', 'tool', 'model', 'quality', 'generation_mode', 'prompt_path', 'prompt_sha256',
  'receipt_path', 'receipt_sha256', 'style_contract', 'atmosphere_contract',
  'style_status', 'atmosphere_status', 'original_feel_status', 'source_text_removal_status',
  'alpha_status', 'layout_status', 'korean_text_status', 'roundtrip_status', 'status', 'notes',
].join('\t');

function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function regularFile(target, label) {
  const stats = await fs.lstat(target).catch(() => null);
  if (!stats?.isFile() || stats.isSymbolicLink()) throw new Error(`${label} must be a regular non-link file: ${target}`);
  return stats;
}

async function regularDirectory(target, label) {
  const stats = await fs.lstat(target).catch(() => null);
  if (!stats?.isDirectory() || stats.isSymbolicLink()) throw new Error(`${label} must be a regular non-link directory: ${target}`);
}

async function writeIfMissing(target, content) {
  try { await fs.access(target); } catch { await fs.writeFile(target, content, 'utf8'); }
}

function parseSteamManifest(text) {
  const appId = text.match(/"appid"\s+"([0-9]+)"/i)?.[1] ?? null;
  const buildId = text.match(/"buildid"\s+"([0-9]+)"/i)?.[1] ?? null;
  const installDir = text.match(/"installdir"\s+"([^"]+)"/i)?.[1] ?? null;
  return { appId, buildId, installDir };
}

function usage() {
  console.log(`Usage: npm run project:new:steam -- --install-root <game-folder> --game-executable <relative.exe> --game-name <name> [identity]

Identity:
  Steam: --app-id <digits> --steam-manifest <appmanifest_APPID.acf>
  Other PC store: --project-id <pc-safe-slug> --build-id <distribution-build-id>

The project is created only at <install-root>/_work/<steam-APPID|pc-slug>.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flag(args, 'help')) return usage();
  const installRoot = path.resolve(requiredOption(args, 'install-root'));
  await regularDirectory(installRoot, '--install-root');
  const gameName = requiredOption(args, 'game-name');
  const executableRelative = requiredOption(args, 'game-executable').replaceAll('\\', '/');
  if (path.isAbsolute(executableRelative) || executableRelative.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('--game-executable must be an install-root-relative path');
  }
  const executablePath = path.resolve(installRoot, ...executableRelative.split('/'));
  for (const [label, value] of [['--install-root', installRoot], ['--game-name', gameName], ['--game-executable', executableRelative]]) {
    if (/[\t\r\n]/.test(value)) throw new Error(`${label} must not contain tabs or line breaks`);
  }
  if (!isWithin(installRoot, executablePath) || path.extname(executablePath).toLowerCase() !== '.exe') {
    throw new Error('--game-executable must resolve to an .exe inside --install-root');
  }
  const executableStats = await regularFile(executablePath, '--game-executable');

  const appIdOption = option(args, 'app-id');
  const projectIdOption = option(args, 'project-id');
  if (appIdOption && projectIdOption) throw new Error('Use --app-id for Steam or --project-id for another PC store, not both');
  if (!appIdOption && !projectIdOption) throw new Error('Pass either --app-id or --project-id');

  let distribution;
  let projectId;
  let appId = null;
  let manifestPath = null;
  let manifestStats = null;
  let manifestSha = 'N/A';
  let buildId;
  if (appIdOption) {
    appId = String(appIdOption);
    if (!/^[1-9][0-9]{0,9}$/.test(appId)) throw new Error('--app-id must be 1-10 digits and must not start with zero');
    distribution = 'steam';
    projectId = normalizeProjectId(`steam-${appId}`);
    manifestPath = path.resolve(requiredOption(args, 'steam-manifest'));
    if (/[\t\r\n]/.test(manifestPath)) throw new Error('--steam-manifest must not contain tabs or line breaks');
    manifestStats = await regularFile(manifestPath, '--steam-manifest');
    const manifest = parseSteamManifest(await fs.readFile(manifestPath, 'utf8'));
    if (manifest.appId !== appId) throw new Error(`Steam manifest appid ${manifest.appId ?? 'missing'} does not match --app-id ${appId}`);
    buildId = manifest.buildId;
    if (!buildId) throw new Error('Steam manifest does not contain a concrete buildid');
    manifestSha = await sha256File(manifestPath);
  } else {
    distribution = 'other-pc';
    projectId = normalizeProjectId(projectIdOption);
    if (!projectId.startsWith('pc-')) throw new Error('--project-id for a non-Steam PC game must start with pc-');
    buildId = requiredOption(args, 'build-id');
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(buildId)) throw new Error('--build-id must be a concrete safe identifier');
  }

  const projectRoot = path.join(installRoot, '_work', projectId);
  const folders = [
    ['00_source'],
    ['10_extract', 'source_snapshot'],
    ['10_extract', 'decompiled'],
    ['20_reference', 'external_patches'],
    ['20_reference', 'fonts'],
    ['20_reference', 'documents'],
    ['30_translation', 'text', 'translation_batches'],
    ['30_translation', 'text', 'reports'],
    ['30_translation', 'text', 'reviews'],
    ['30_translation', 'image_translation', 'for_translation', 'attempts'],
    ['30_translation', 'image_translation', 'reference'],
    ['30_translation', 'image_translation', 'prompts'],
    ['30_translation', 'image_translation', 'receipts'],
    ['30_translation', 'image_translation', 'probes'],
    ['30_translation', 'image_translation', 'reports'],
    ['40_build', 'overlay'],
    ['40_build', 'staging'],
    ['40_build', 'releases'],
    ['50_test', 'screenshots'],
    ['50_test', 'logs'],
    ['50_test', 'release-runtime'],
    ['90_tools', 'scripts'],
    ['90_tools', 'environment'],
    ['90_tools', 'cleanup'],
    ...artifactLayoutDirectories,
  ];
  for (const folder of folders) await fs.mkdir(path.join(projectRoot, ...folder), { recursive: true });

  const manifestDisplay = manifestPath ?? 'N/A';
  await writeIfMissing(path.join(projectRoot, 'PROJECT.md'), `# ${gameName}

- platform: steam
- distribution: ${distribution}
- project_id: ${projectId}
- steam_app_id: ${appId ?? 'N/A'}
- distribution_build_id: ${buildId}
- source_install_root: ${installRoot}
- source_manifest_path: ${manifestDisplay}
- game_executable: ${executableRelative}
- project_status: registered
- text_status: pending
- image_status: pending
- font_status: pending
- qa_status: pending
- release_status: pending
- image_scope: pending
- image_model: provider-selected
- image_quality: provider-managed
- image_input_fidelity: provider-managed
- text_review_policy: prepare-only
- image_review_policy: prepare-only
- text_review_approval: not_required
- image_review_approval: not_required
- batch_size: 80
- batch_size_override_reason: none (canonical default)
- glossary_path: 30_translation/text/glossary.tsv
- runtime_policy: static-first
- runtime_authorization: pending
- basic_test_backend: direct-native
- mcp_session_scope: none
- final_qa_runtime: official-distribution-release
- final_qa_mcp_allowed: false
- release_runtime_receipt: 50_test/RELEASE_RUNTIME_QA.json
- target_language_slot: pending
- release_contract: Steam-PC overlay — \`40_build/releases/${projectId}.zip\`, ZIP root \`patch/\`

## Safety boundary

The installed game is authoritative source input. Do not edit it during extraction or build. All generated files stay under this \`_work/${projectId}\` project. Runtime deployment is a separate, hash-recorded operation and requires a game restart.

## Stage status

| Stage | Status | Evidence |
|---|---|---|
| overall-analyze | pending | |
| text-analyze | pending | |
| text-translate | pending | |
| text-qa | pending | |
| text-review | pending | |
| image-analyze | pending | |
| image-translate | pending | |
| image-qa | pending | |
| image-review | pending | |
| integrated-qa | pending | |
| release | pending | |
`);
  await writeIfMissing(path.join(projectRoot, 'WORK_LOG.md'), `# Work log\n\n- Project registered for \`${projectId}\`, distribution build \`${buildId}\`.\n`);
  await writeIfMissing(path.join(projectRoot, 'HANDOFF.md'), '# Handoff\n\n| date | type | observed | impact | decision | evidence | status |\n|---|---|---|---|---|---|---|\n');
  await writeIfMissing(path.join(projectRoot, '00_source', 'SOURCE_INVENTORY.tsv'), [
    'role\tpath\tdistribution_id\tbuild_id\tsize_bytes\tsha256\tnotes',
    `game_executable\t${executableRelative}\t${appId ?? projectId}\t${buildId}\t${executableStats.size}\t${await sha256File(executablePath)}\tinstalled source; do not modify`,
    ...(manifestPath ? [`distribution_manifest\t${manifestPath}\t${appId}\t${buildId}\t${manifestStats.size}\t${manifestSha}\tSteam appmanifest source evidence`] : []),
    '',
  ].join('\n'));
  await writeIfMissing(path.join(projectRoot, '20_reference', 'REFERENCE_INDEX.tsv'), 'type\tpath\tsha256\tusage\tlicense_or_source\tnotes\n');
  await writeIfMissing(path.join(projectRoot, '30_translation', 'text', 'glossary.tsv'), 'source\treading\tko\tcategory\tevidence\tnotes\n');
  await writeIfMissing(path.join(projectRoot, '30_translation', 'text', 'translation_manifest.tsv'), 'id\tsource_file\tsource_key\tja\ten\ttarget_ko\tstatus\tnotes\n');
  await writeIfMissing(path.join(projectRoot, '30_translation', 'text', 'CODEX_TRANSLATION_WORKFLOW.md'), `# ${gameName} translation configuration\n\nUse \`$GT_HOME/common/glossary-rules.md\`, the Steam/PC adapter, and the identified engine module. Runtime maps such as XUnity translations remain engine-specific overlay payloads and require exact key/control preservation.\n`);
  await writeIfMissing(path.join(projectRoot, '30_translation', 'image_translation', 'reference', 'image_manifest.tsv'), 'relative_path\twidth\theight\tformat\talpha\ttext_present\ttranslation_required\tstatus\tnotes\n');
  await writeIfMissing(path.join(projectRoot, '30_translation', 'image_translation', 'IMAGE_GENERATION_MANIFEST.tsv'), `${imageGenerationManifestHeader}\n`);
  await writeIfMissing(path.join(projectRoot, '40_build', 'PATCH_MANIFEST.tsv'), `${steamPatchManifestHeader}\n`);
  await writeIfMissing(path.join(projectRoot, '40_build', 'BUILD_MANIFEST.tsv'), 'build_id\tdate\tscope\tsource_clean_path\toutput_path\tsize_bytes\tsha256\tdevice_result\tnotes\n');
  await writeIfMissing(path.join(projectRoot, '50_test', 'TEST_LOG.md'), '# Native runtime test log\n\n| Date | Build ID | Distribution build ID | Executable SHA-256 | Patch manifest SHA-256 | Test area | Result | Evidence |\n|---|---|---|---|---|---|---|---|\n');
  await writeIfMissing(path.join(projectRoot, '90_tools', 'PROJECT_ARTIFACT_MANIFEST.tsv'), `${artifactIndexHeader.join('\t')}\n`);
  process.stdout.write(`${projectRoot}\n`);
}

main().catch((error) => {
  process.stderr.write(`Steam/PC project creation failed: ${error.message}\n`);
  process.exitCode = 1;
});
