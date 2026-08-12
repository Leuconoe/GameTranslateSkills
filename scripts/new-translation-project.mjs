#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePackageExtensions = new Set(['.nsp', '.xci']);
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

function samePath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

async function isDirectory(target) {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(target) {
  try {
    return (await fs.stat(target)).isFile();
  } catch {
    return false;
  }
}

async function isSymbolicLink(target) {
  try {
    return (await fs.lstat(target)).isSymbolicLink();
  } catch {
    return false;
  }
}

async function directSourcePackages(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && sourcePackageExtensions.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(root, entry.name))
    .sort();
}

async function findSourcePackages(root, current = root, results = []) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(current, entry.name);
    if (entry.isFile() && sourcePackageExtensions.has(path.extname(entry.name).toLowerCase())) {
      results.push(target);
      continue;
    }
    if (!entry.isDirectory() || entry.isSymbolicLink() || ['_work', '_tools'].includes(entry.name)) continue;
    await findSourcePackages(root, target, results);
  }
  return results.sort();
}

async function writeIfMissing(target, content) {
  try {
    await fs.access(target);
  } catch {
    await fs.writeFile(target, content, 'utf8');
  }
}

async function findWorkFolders(root, depth = 0, results = []) {
  if (depth > 3) return results;
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.name === '_work') {
      results.push(fullPath);
      continue;
    }
    await findWorkFolders(fullPath, depth + 1, results);
  }
  return results;
}

function usage() {
  console.log(`Usage: npm run project:new -- (--game-folder <relative-path> | --source-package <path>) --title-id <16-hex> --game-name <name> [options]

Options:
  --titles-root <path>  Titles container (default: existing <repository>/_titles or <repository>/_title)
  --game-folder <path>  Exact title folder that directly contains an NSP/XCI package
  --source-package <path>  Exact NSP/XCI path; its parent becomes the title folder
  --help                Show this help`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flag(args, 'help')) {
    usage();
    return;
  }

  const gameFolderOption = option(args, 'game-folder');
  const sourcePackageOption = option(args, 'source-package');
  if (typeof gameFolderOption !== 'string' && typeof sourcePackageOption !== 'string') {
    throw new Error('Pass either --game-folder or --source-package; do not create a new generic title folder');
  }
  if (typeof gameFolderOption === 'string' && typeof sourcePackageOption === 'string') {
    throw new Error('Pass only one of --game-folder and --source-package');
  }
  const titleIdInput = requiredOption(args, 'title-id');
  const gameName = requiredOption(args, 'game-name');
  if (!/^[0-9A-Fa-f]{16}$/.test(titleIdInput)) {
    throw new Error('--title-id must contain exactly 16 hexadecimal characters');
  }

  const explicitTitlesRoot = option(args, 'titles-root');
  let titlesRoot;
  if (typeof explicitTitlesRoot === 'string') {
    titlesRoot = path.resolve(explicitTitlesRoot);
  } else {
    const candidates = [path.join(repositoryRoot, '_titles'), path.join(repositoryRoot, '_title')];
    const existing = [];
    for (const candidate of candidates) if (await isDirectory(candidate)) existing.push(candidate);
    if (existing.length > 1) {
      throw new Error(`Both title containers exist; pass an explicit --titles-root: ${existing.join(', ')}`);
    }
    titlesRoot = existing[0] ?? candidates[0];
  }
  if (!(await isDirectory(titlesRoot))) {
    throw new Error(`Title container does not exist: ${titlesRoot} (pass --titles-root to an existing _title/_titles folder)`);
  }

  let sourcePackagePath = null;
  let gameRoot;
  if (typeof sourcePackageOption === 'string') {
    sourcePackagePath = path.resolve(titlesRoot, sourcePackageOption);
    if (!isWithin(titlesRoot, sourcePackagePath)) throw new Error(`--source-package must be under ${titlesRoot}`);
    if (!sourcePackageExtensions.has(path.extname(sourcePackagePath).toLowerCase()) || !(await isFile(sourcePackagePath))) {
      throw new Error(`--source-package must be an existing .nsp or .xci file: ${sourcePackagePath}`);
    }
    gameRoot = path.dirname(sourcePackagePath);
  } else {
    gameRoot = path.resolve(titlesRoot, gameFolderOption);
    if (!isWithin(titlesRoot, gameRoot)) throw new Error(`--game-folder must be under ${titlesRoot}`);
  }
  if (await isSymbolicLink(gameRoot)) throw new Error(`Title folder must not be a symbolic link: ${gameRoot}`);
  if (!(await isDirectory(gameRoot))) throw new Error(`Game folder does not exist: ${gameRoot}`);

  const sourcePackages = await directSourcePackages(gameRoot);
  if (sourcePackages.length === 0) {
    const nestedPackages = await findSourcePackages(gameRoot);
    const hint = nestedPackages.length > 0
      ? ` Found package(s) below this folder; pass --game-folder "${path.dirname(nestedPackages[0])}" or the exact --source-package path.`
      : '';
    throw new Error(`The title folder must directly contain at least one .nsp or .xci; refusing to create a nested generic title folder: ${gameRoot}.${hint}`);
  }
  if (sourcePackagePath && !sourcePackages.some((candidate) => samePath(candidate, sourcePackagePath))) {
    throw new Error(`The source package parent changed or is not a direct child of the title folder: ${sourcePackagePath}`);
  }

  const id = titleIdInput.toUpperCase();
  const project = path.join(gameRoot, '_work', id);
  const workFolders = await findWorkFolders(titlesRoot);
  for (const workFolder of workFolders) {
    const candidate = path.join(workFolder, id);
    if (await isDirectory(candidate) && path.resolve(candidate).toLowerCase() !== path.resolve(project).toLowerCase()) {
      throw new Error(`Title ID ${id} is already registered at ${candidate}`);
    }
  }

  const registryPath = path.join(titlesRoot, 'GAME_REGISTRY.tsv');
  if (await fs.access(registryPath).then(() => true).catch(() => false)) {
    const rows = (await fs.readFile(registryPath, 'utf8')).split(/\r?\n/).filter(Boolean);
    if (rows.length > 1) {
      const headers = rows[0].split('\t');
      const titleIndex = headers.indexOf('base_title_id');
      const releaseIndex = headers.indexOf('release_folder');
      for (const line of rows.slice(1)) {
        const columns = line.split('\t');
        if ((columns[titleIndex] ?? '').trim().toUpperCase() !== id) continue;
        const releaseFolder = (columns[releaseIndex] ?? '').trim();
        const registeredRoot = releaseFolder ? path.resolve(titlesRoot, releaseFolder) : '';
        if (!registeredRoot || registeredRoot.toLowerCase() !== gameRoot.toLowerCase()) {
          throw new Error(`Title ID ${id} is already registered in GAME_REGISTRY.tsv (release_folder: ${releaseFolder})`);
        }
      }
    }
  }

  const folders = [
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
    ['30_translation', 'image_translation', 'for_translation', 'attempts'],
    ['30_translation', 'image_translation', 'reference'],
    ['30_translation', 'image_translation', 'prompts'],
    ['30_translation', 'image_translation', 'receipts'],
    ['30_translation', 'image_translation', 'probes'],
    ['30_translation', 'image_translation', 'reports'],
    ['40_build', 'layeredfs', id, 'romfs'],
    ['40_build', 'staging'],
    ['40_build', 'releases'],
    ['50_test', 'screenshots'],
    ['50_test', 'logs'],
    ['50_test', 'eden'],
    ['50_test', 'release-runtime'],
    ['90_tools', 'scripts'],
    ['90_tools', 'environment'],
    ['90_tools', 'cleanup'],
  ];
  for (const folder of folders) await fs.mkdir(path.join(project, ...folder), { recursive: true });

  await writeIfMissing(path.join(project, 'PROJECT.md'), `# ${gameName}

- Base Title ID: \`${id}\`
- Title root: \`${path.relative(titlesRoot, gameRoot) || '.'}\` (the folder containing the source NSP/XCI)
- Update Title ID: unknown
- Version: unknown
- Engine: unknown
- Default Korean font: undecided — inspect the actual files under \`$GT_TOOLS/_fonts/\`, choose one, and record its exact filename and SHA-256 here
- Pipeline contract: \`$GT_HOME/common/pipeline-contract.json\`
- Image generation contract: \`$GT_HOME/common/image-translation-contract.md\` — use the no-API built-in \`image_gen.imagegen\` edit path, generate at least three independent candidates, and select only a fully verified result; never local Python/Pillow/OpenCV drawing or compositing
- project_status: registered
- text_status: pending
- image_status: pending
- image_model: provider-selected — the built-in tool does not expose model selection
- image_quality: provider-managed — enforce output acceptance, not an unverifiable request setting
- image_input_fidelity: provider-managed — preserve inputs through prompt invariants and decoded-pixel QA
- qa_status: pending
- release_status: pending
- font_status: pending — do not mark text review-ready until FONT_ATLAS_MANIFEST.tsv and render probes pass
- image_scope: pending — set \`required\` or \`N/A\` after complete image inventory and record the evidence
- text_review_policy: prepare-only — use \`user-gate\` only when this project explicitly requires user approval
- image_review_policy: prepare-only — use \`user-gate\` only when this project explicitly requires user approval
- text_review_approval: not_required — set \`pending\`/\`approved\` only when text_review_policy is \`user-gate\`
- image_review_approval: not_required — set \`pending\`/\`approved\` only when image_review_policy is \`user-gate\`
- batch_size: 80
- batch_size_override_reason: none (canonical default)
- glossary_path: 30_translation/text/glossary.tsv
- runtime_policy: static-first
- runtime_authorization: pending
- basic_test_backend: eden-mcp
- mcp_session_scope: one-per-title
- final_qa_runtime: official-distribution-release
- final_qa_mcp_allowed: false
- release_runtime_receipt: 50_test/RELEASE_RUNTIME_QA.json
- target_language_slot: pending
- release_contract: platform-adapter
- Temporary artifacts: project-local only under this \`_work\` root; use \`tmp-<stage>-<purpose>\` or \`*.tmp\` for disposable files
- Canonical MCP QA state: \`50_test/eden/SESSION.json\` and \`50_test/eden/ARTIFACT_MANIFEST.tsv\`; despite the historical folder name this is the one shared title ledger for Eden-MCP/Ryubing-MCP, and routine QA reuses it instead of creating session/copy files
- Final QA: separately run an allowlisted official-site distribution release directly without MCP and validate \`50_test/RELEASE_RUNTIME_QA.json\`; MCP smoke evidence never qualifies as final PASS
- Status: registered; extraction not started

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

## Source packages

Record package filenames and sizes here: ${sourcePackages.map((sourcePackage) => `\`${path.relative(titlesRoot, sourcePackage)}\``).join(', ')}.

## Current resume point

Identify the effective RomFS and engine before producing translation files.
`);

  await writeIfMissing(path.join(project, 'WORK_LOG.md'), `# Work log

## Created

- Project registered for \`${id}\`.
- Extraction and analysis have not started.
`);
  await writeIfMissing(path.join(project, 'HANDOFF.md'), `# Handoff

Append-only evidence for document drift, blocked steps, workarounds, and cleanup decisions.

| date | type | observed | impact | decision | evidence | status |
|---|---|---|---|---|---|---|
`);

  await writeIfMissing(path.join(project, '50_test', 'TEST_LOG.md'), `# Device test log

| Date | Build | Game version | System region | System language | UI language | Subtitle | Secondary subtitle | Execution surface | Emulator/version | Session key | Session ID | Test area | Result | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
`);
  await writeIfMissing(path.join(project, '50_test', 'eden', 'SESSION.json'), `{
  "schema_version": 2,
  "project_id": "${id}",
  "backend": null,
  "session_key": null,
  "session_id": null,
  "last_session_id": null,
  "remote_close_session_id": null,
  "status": "closed",
  "title_id": null,
  "profile_path": null,
  "profile_sha256": null,
  "emulator_version": null,
  "current_build_id": null,
  "session_generation": 0,
  "exception_count": 0,
  "last_exception_reason": null,
  "observed_title_sessions": [],
  "remote_inventory_checked_at": null,
  "updated_at": null,
  "closed_at": null,
  "closed_reason": null
}
`);
  await writeIfMissing(path.join(project, '50_test', 'eden', 'ARTIFACT_MANIFEST.tsv'), 'artifact_key\tpath\tbuild_id\tsession_id\tsha256\tstatus\tnotes\n');
  await writeIfMissing(path.join(project, '30_translation', 'text', 'glossary.tsv'), 'source\treading\tko\tcategory\tevidence\tnotes\n');
  await writeIfMissing(path.join(project, '30_translation', 'text', 'translation_manifest.tsv'), 'id\tsource_file\tsource_key\tja\ten\ttarget_ko\tstatus\tnotes\n');
  await writeIfMissing(path.join(project, '30_translation', 'text', 'CODEX_TRANSLATION_WORKFLOW.md'), `# ${gameName} Codex translation configuration

The mandatory common procedure is \`$GT_HOME/common/glossary-rules.md\` (batch construction, translation, and independent second-pass review rules).

## Project settings

- Base Title ID: \`${id}\`
- Authoritative source language: Japanese unless analysis proves otherwise
- Secondary reference language: English when available
- Replacement language slot: undecided; confirm on device before full injection
- Image scope: pending; set \`required\` or \`N/A\` after analysis. If \`N/A\`, record the 0-item inventory and reason before skipping image stages.
- Text review policy: prepare-only (default); set \`user-gate\` only with an explicit project decision.
- Image review policy: prepare-only (default); set \`user-gate\` only with an explicit project decision.
- Image generation: no-API built-in \`image_gen.imagegen\` edits only; use the same byte-exact reference and prompt for at least three independent candidates, then select only a technical-and-visual pass. Preserve the original typography, atmosphere, material, lighting, color, spacing, layout, alpha, atlas, and source bytes through \`IMAGE_GENERATION_MANIFEST.tsv\`.
- Korean raster style: remove the full source glyph/outline/shadow before rendering; never overlay Korean; preserve the original type impression, stroke weight, color/gradient, outline/shadow/glow, material/lighting, spacing, baseline, alignment, and atmosphere.
- Font status: pending; \`gt-text-qa\` must produce \`30_translation/text/FONT_ATLAS_MANIFEST.tsv\`, \`FONT_COVERAGE.tsv\`, and \`FONT_ATLAS_QA_REPORT.md\` before review-ready.
- Pipeline order: \`gt-analyze\` → \`gt-text-analyze\` → \`gt-text-translate\` → \`gt-text-qa\` → \`gt-text-review\` → conditional image branch → \`gt-qa\` → \`gt-release\`
- Temporary artifacts: keep all disposable outputs under the project \`_work\` root and name them \`tmp-<stage>-<purpose>\` or \`*.tmp\`; clean them with the project cleanup CLI after release.
- MCP smoke QA: use Eden-MCP by default and reuse the shared, single-title \`50_test/eden/SESSION.json\` ledger across Eden-MCP/Ryubing-MCP; query both inventories before creation and do not create timestamped session/copy files.
- Final QA: MCP is forbidden. Download an allowlisted official-site distribution release, execute its binary directly, and pass \`$GT_HOME/common/release-runtime-contract.md\` with current build/mod/binary/log/screenshot hashes before release.
- Batch size: fixed 80 editable rows (canonical rule: \`$GT_HOME/common/glossary-rules.md\` section 3); combined source/reference/draft text at most 48,000 characters
- Codex reasoning effort: high
- First-pass status: not started
- Independent second-pass status: not started

## Context and voice

Record the cast voice rules, route chronology, special terminology, and ambiguous source notes here before batch translation.

## Project-specific controls

Record placeholders, ruby syntax, link markers, line-break representation, and non-visible identifiers here before merging any output.
`);
  await writeIfMissing(path.join(project, '00_source', 'SOURCE_INVENTORY.tsv'), 'role\tfile_name\ttitle_id\tversion\tregion\tsize_bytes\tsha256\tnotes\n');
  await writeIfMissing(path.join(project, '20_reference', 'REFERENCE_INDEX.tsv'), 'type\tpath\torigin\tlicense_or_usage\tpurpose\tnotes\n');
  await writeIfMissing(path.join(project, '30_translation', 'image_translation', 'reference', 'image_manifest.tsv'), 'id\tsource_archive\ttexture_key\tx\ty\twidth\theight\tlanguage\thash\tsource_text\ttarget_ko\tstatus\tnotes\n');
  await writeIfMissing(path.join(project, '30_translation', 'image_translation', 'IMAGE_GENERATION_MANIFEST.tsv'), `${imageGenerationManifestHeader}\n`);
  await writeIfMissing(path.join(project, '40_build', 'BUILD_MANIFEST.tsv'), 'build_id\tdate\tscope\tsource_clean_path\toutput_path\tsize_bytes\tsha256\tdevice_result\tnotes\n');

  console.log(project);
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exitCode = 1;
});
