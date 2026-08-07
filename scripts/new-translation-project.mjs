#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePackageExtensions = new Set(['.nsp', '.xci']);

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
    ['30_translation', 'image_translation', 'for_translation'],
    ['30_translation', 'image_translation', 'reference'],
    ['40_build', 'layeredfs', id, 'romfs'],
    ['40_build', 'staging'],
    ['40_build', 'releases'],
    ['50_test', 'screenshots'],
    ['50_test', 'logs'],
    ['50_test', 'eden'],
    ['90_tools', 'scripts'],
    ['90_tools', 'environment'],
  ];
  for (const folder of folders) await fs.mkdir(path.join(project, ...folder), { recursive: true });

  await writeIfMissing(path.join(project, 'PROJECT.md'), `# ${gameName}

- Base Title ID: \`${id}\`
- Title root: \`${path.relative(titlesRoot, gameRoot) || '.'}\` (the folder containing the source NSP/XCI)
- Update Title ID: unknown
- Version: unknown
- Engine: unknown
- Default Korean font: undecided — inspect the actual files under \`$GT_TOOLS/_fonts/\`, choose one, and record its exact filename and SHA-256 here
- Image scope: undecided — set \`required\` or \`N/A\` after complete image inventory and record the evidence
- Temporary artifacts: project-local only under this \`_work\` root; use \`tmp-<stage>-<purpose>\` or \`*.tmp\` for disposable files
- Canonical QA state: \`50_test/eden/SESSION.json\` and \`50_test/eden/ARTIFACT_MANIFEST.tsv\`; reuse them instead of creating session/copy files
- Status: registered; extraction not started

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

  await writeIfMissing(path.join(project, '50_test', 'TEST_LOG.md'), `# Device test log

| Date | Build | Game version | System region | System language | UI language | Subtitle | Secondary subtitle | Emulator/MCP | Session key | Session ID | Test area | Result | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
`);
  await writeIfMissing(path.join(project, '50_test', 'eden', 'SESSION.json'), `{
  "schema_version": 1,
  "project_id": "${id}",
  "backend": "eden-mcp",
  "session_key": null,
  "session_id": null,
  "last_session_id": null,
  "status": "closed",
  "title_id": null,
  "profile_path": null,
  "profile_sha256": null,
  "emulator_version": null,
  "current_build_id": null,
  "updated_at": null,
  "closed_at": null
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
- Image scope: undecided; set \`required\` or \`N/A\` after analysis. If \`N/A\`, record the 0-item inventory and reason before skipping image stages.
- Temporary artifacts: keep all disposable outputs under the project \`_work\` root and name them \`tmp-<stage>-<purpose>\` or \`*.tmp\`; clean them with the project cleanup CLI after release.
- Eden QA: reuse the single \`50_test/eden/SESSION.json\` state and \`ARTIFACT_MANIFEST.tsv\`; do not create timestamped session/copy files.
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
  await writeIfMissing(path.join(project, '40_build', 'BUILD_MANIFEST.tsv'), 'build_id\tdate\tscope\tsource_clean_path\toutput_path\tsize_bytes\tsha256\tdevice_result\tnotes\n');

  console.log(project);
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exitCode = 1;
});
