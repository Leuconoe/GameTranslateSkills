#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsRoot = path.join(repositoryRoot, 'skills');
const contractPath = path.join(repositoryRoot, 'common', 'pipeline-contract.json');
const imageContractPath = path.join(repositoryRoot, 'common', 'image-translation-contract.md');
const runtimeContractPath = path.join(repositoryRoot, 'common', 'release-runtime-contract.md');
const artifactLayoutContractPath = path.join(repositoryRoot, 'common', 'artifact-layout-contract.md');
const workspaceBoundaryContractPath = path.join(repositoryRoot, 'common', 'workspace-boundary-contract.md');
const packagePath = path.join(repositoryRoot, 'package.json');
const forbiddenSkillText = [
  '7단계',
  '7-stage',
  'STOP for mandatory explicit user approval',
  '사용자 승인 필수',
];

async function read(target) {
  return fs.readFile(target, 'utf8');
}

function frontmatter(text, file) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`${file}: YAML frontmatter is missing or malformed`);
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) throw new Error(`${file}: unsupported frontmatter line: ${line}`);
    fields[field[1]] = field[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return { fields, body: text.slice(match[0].length) };
}

function add(issues, message) {
  issues.push(message);
}

async function main() {
  const issues = [];
  let bundleVersion;
  try {
    const packageManifest = JSON.parse(await read(packagePath));
    bundleVersion = packageManifest.version;
    if (!/^\d+\.\d+\.\d+$/.test(bundleVersion ?? '')) add(issues, 'package.json: version must use strict semver');
  } catch (error) {
    add(issues, `package.json: cannot read/parse (${error.message})`);
  }
  let contract;
  try {
    contract = JSON.parse(await read(contractPath));
  } catch (error) {
    add(issues, `contract: cannot read/parse ${contractPath}: ${error.message}`);
  }
  const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
  const skillDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const expectedStageSkills = new Set(contract?.stages?.map((stage) => stage.skill) ?? []);
  const stageById = new Map((contract?.stages ?? []).map((stage) => [stage.id, stage]));
  const expectedSkills = new Set([
    ...expectedStageSkills,
    contract?.nsw_release_package_contract?.skill,
    'game-translate',
    'gt-workspace-cleanup',
    'gt-project-cleanup',
  ].filter(Boolean));
  for (const expected of expectedSkills) if (!skillDirs.includes(expected)) add(issues, `missing expected skill directory: ${expected}`);
  for (const actual of skillDirs) if (!expectedSkills.has(actual)) add(issues, `unexpected skill directory not present in contract: ${actual}`);

  const contents = new Map();
  for (const skillName of skillDirs) {
    const skillPath = path.join(skillsRoot, skillName);
    const skillFile = path.join(skillPath, 'SKILL.md');
    const agentsFile = path.join(skillPath, 'agents', 'openai.yaml');
    let text;
    try {
      text = await read(skillFile);
    } catch (error) {
      add(issues, `${skillName}: missing SKILL.md (${error.message})`);
      continue;
    }
    contents.set(skillName, text);
    try {
      const parsed = frontmatter(text, skillFile);
      if (parsed.fields.name !== skillName) add(issues, `${skillName}: frontmatter name must equal folder name`);
      if (!parsed.fields.description || parsed.fields.description.length < 40) add(issues, `${skillName}: description must explain what and when to use the skill`);
      if (Object.keys(parsed.fields).some((key) => !['name', 'description'].includes(key))) add(issues, `${skillName}: frontmatter may contain only name and description`);
      if (parsed.body.split(/\r?\n/).length > 500) add(issues, `${skillName}: SKILL.md body exceeds 500 lines`);
    } catch (error) {
      add(issues, error.message);
    }
    if (/TODO/i.test(text)) add(issues, `${skillName}: placeholder TODO remains`);
    for (const forbidden of forbiddenSkillText) if (text.includes(forbidden)) add(issues, `${skillName}: stale/contradictory workflow text: ${forbidden}`);
    let yaml;
    try {
      yaml = await read(agentsFile);
    } catch (error) {
      add(issues, `${skillName}: missing agents/openai.yaml (${error.message})`);
      continue;
    }
    for (const key of ['display_name', 'short_description', 'default_prompt']) if (!new RegExp(`^\\s+${key}:`, 'm').test(yaml)) add(issues, `${skillName}: agents/openai.yaml is missing interface.${key}`);
    const shortDescription = yaml.match(/^\s+short_description:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim() ?? '';
    if (shortDescription.length < 25 || shortDescription.length > 64) add(issues, `${skillName}: short_description must be 25-64 characters`);
    if (!yaml.includes(`$${skillName}`)) add(issues, `${skillName}: default_prompt must explicitly mention $${skillName}`);
  }

  for (const stage of contract?.stages ?? []) {
    const text = contents.get(stage.skill) ?? '';
    if (!text) continue;
    for (const next of stage.next ?? []) {
      const nextSkill = stageById.get(next)?.skill ?? next;
      if (!text.includes(nextSkill) && !text.includes(next)) add(issues, `${stage.skill}: does not mention next contract stage ${nextSkill}`);
    }
    if (!text.includes('BLOCKED')) add(issues, `${stage.skill}: must define a BLOCKED/fail-closed path`);
    if (!text.includes('PROJECT.md')) add(issues, `${stage.skill}: must read/update PROJECT.md contract`);
  }
  const orchestrator = contents.get('game-translate') ?? '';
  for (const stage of contract?.stages ?? []) if (!orchestrator.includes(stage.skill)) add(issues, `game-translate: missing contract skill ${stage.skill}`);
  for (const phrase of ['pipeline-contract', 'prepare-only', 'user-gate', 'text_review_policy', 'image_review_policy']) if (!orchestrator.includes(phrase)) add(issues, `game-translate: missing control phrase ${phrase}`);
  const textQa = contents.get('gt-text-qa') ?? '';
  for (const phrase of ['font-atlas-contract', 'FONT_ATLAS_MANIFEST.tsv', 'FONT_COVERAGE.tsv', 'font_status=verified', 'gt-text-review']) if (!textQa.includes(phrase)) add(issues, `gt-text-qa: missing font/review gate ${phrase}`);
  let imageContract = '';
  try {
    imageContract = await read(imageContractPath);
  } catch (error) {
    add(issues, `image contract: cannot read ${imageContractPath} (${error.message})`);
  }
  for (const phrase of [
    'IMAGE_GENERATION_MANIFEST.tsv',
    'image_gen.imagegen',
    'chatgpt-built-in',
    'provider-selected',
    'provider-managed',
    'best-of-3-fail-closed',
    'minimum_candidates',
    'no_overlay',
    'Python/Pillow/OpenCV',
    'source/reference/candidate',
    'alpha byte',
    'decoded RGBA diff',
    'npm run image:validate',
  ]) if (!imageContract.includes(phrase)) add(issues, `image contract: missing fail-closed phrase ${phrase}`);
  const imageAnalyze = contents.get('gt-image-analyze') ?? '';
  for (const phrase of [
    'image-translation-contract', '분위기', 'preserve_typography', 'preserve_color',
    'preserve_outline_shadow', 'preserve_material_lighting', 'preserve_spacing_baseline',
    'edit_regions', 'byte-exact reference',
  ]) if (!imageAnalyze.includes(phrase)) add(issues, `gt-image-analyze: missing image preservation phrase ${phrase}`);
  const imageTranslate = contents.get('gt-image-translate') ?? '';
  for (const phrase of [
    'image-translation-contract',
    '$imagegen',
    'image_gen.imagegen',
    'best-of-3-fail-closed',
    'provider-managed',
    'view_image',
    'Python/Pillow/OpenCV',
    'IMAGE_GENERATION_MANIFEST.tsv',
    'validate-image-translation.mjs',
    'source/reference/기존 candidate',
    'hold-for-imagegen-review',
  ]) if (!imageTranslate.includes(phrase)) add(issues, `gt-image-translate: missing imagegen-only gate ${phrase}`);
  const imageQa = contents.get('gt-image-qa') ?? '';
  for (const phrase of [
    'image-translation-contract',
    'IMAGE_GENERATION_MANIFEST.tsv',
    'image_gen.imagegen',
    'best-of-3-fail-closed',
    'minimum_candidates=3',
    'original_feel_status',
    'Python/Pillow/OpenCV',
    'validate-image-translation.mjs',
    '기본 alpha는 전 픽셀 exact',
    '영역 밖 decoded RGBA는 diff 0',
  ]) if (!imageQa.includes(phrase)) add(issues, `gt-image-qa: missing image harness gate ${phrase}`);
  const imageReview = contents.get('gt-image-review') ?? '';
  for (const phrase of ['IMAGE_GENERATION_MANIFEST.tsv', 'image_gen.imagegen', 'best-of-3-fail-closed', 'schema 3', 'original-feel', 'alpha', 'RGBA diff 0']) if (!imageReview.includes(phrase)) add(issues, `gt-image-review: missing image evidence phrase ${phrase}`);
  const imagePipeline = contract?.image_generation_contract;
  for (const [field, expected] of Object.entries({
    document: 'common/image-translation-contract.md',
    manifest: '30_translation/image_translation/IMAGE_GENERATION_MANIFEST.tsv',
    validator: 'scripts/validate-image-translation.mjs',
    agent_generator: 'imagegen',
    tool: 'image_gen.imagegen',
    execution_surface: 'chatgpt-built-in',
    model: 'provider-selected',
    quality: 'provider-managed',
    input_fidelity: 'provider-managed',
    api_endpoint: 'N/A',
    candidate_policy: 'best-of-3-fail-closed',
    minimum_candidates: 3,
    operation: 'edit',
  })) if (imagePipeline?.[field] !== expected) add(issues, `contract: image_generation_contract.${field} must equal ${expected}`);
  let runtimeContract = '';
  try {
    runtimeContract = await read(runtimeContractPath);
  } catch (error) {
    add(issues, `runtime contract: cannot read ${runtimeContractPath} (${error.message})`);
  }
  for (const phrase of [
    'official-distribution-release',
    'mcp_used=false',
    '50_test/RELEASE_RUNTIME_QA.json',
    'ACTIVE_MOD_MANIFEST.tsv',
    'nightly',
    'npm run runtime:validate',
  ]) if (!runtimeContract.includes(phrase)) add(issues, `runtime contract: missing fail-closed phrase ${phrase}`);
  const runtimePipeline = contract?.runtime_qa_contract;
  for (const [field, expected] of Object.entries({
    document: 'common/release-runtime-contract.md',
    platform_adapter: 'platforms/<platform>/runtime-emulators.json',
    receipt: '50_test/RELEASE_RUNTIME_QA.json',
    validator: 'scripts/validate-release-runtime.mjs',
    basic_test_backend: 'eden-mcp',
    mcp_session_scope: 'one-per-title',
    final_execution_surface: 'official-distribution-release',
    final_launch_mode: 'direct',
    final_mcp_allowed: false,
    final_result: 'pass',
  })) if (runtimePipeline?.[field] !== expected) add(issues, `contract: runtime_qa_contract.${field} must equal ${expected}`);
  let artifactLayoutContract = '';
  try {
    artifactLayoutContract = await read(artifactLayoutContractPath);
  } catch (error) {
    add(issues, `artifact layout contract: cannot read ${artifactLayoutContractPath} (${error.message})`);
  }
  for (const phrase of [
    'PROJECT_ARTIFACT_MANIFEST.tsv',
    'source-export',
    'translation-output',
    'test-artifact',
    'test-script',
    'reproducible',
    'disposable',
    'project:artifacts',
    '미등록',
  ]) if (!artifactLayoutContract.includes(phrase)) add(issues, `artifact layout contract: missing harness phrase ${phrase}`);
  const artifactPipeline = contract?.artifact_layout_contract;
  for (const [field, expected] of Object.entries({
    document: 'common/artifact-layout-contract.md',
    manifest: '90_tools/PROJECT_ARTIFACT_MANIFEST.tsv',
    initializer_validator: 'scripts/artifact-harness.mjs',
  })) if (artifactPipeline?.[field] !== expected) add(issues, `contract: artifact_layout_contract.${field} must equal ${expected}`);
  let workspaceBoundaryContract = '';
  try {
    workspaceBoundaryContract = await read(workspaceBoundaryContractPath);
  } catch (error) {
    add(issues, `workspace boundary contract: cannot read ${workspaceBoundaryContractPath} (${error.message})`);
  }
  for (const phrase of [
    '<TITLE_ROOT>/_work/<PROJECT_ID>',
    'project:boundary',
    '--assert-output',
    '90_tools/work/extract/',
    '90_tools/work/translation/',
    '90_tools/work/build/',
    '90_tools/work/test/',
    'symlink/junction/reparse',
  ]) if (!workspaceBoundaryContract.includes(phrase)) add(issues, `workspace boundary contract: missing phrase ${phrase}`);
  const boundaryPipeline = contract?.workspace_boundary_contract;
  for (const [field, expected] of Object.entries({
    document: 'common/workspace-boundary-contract.md',
    validator: 'scripts/validate-project-boundary.mjs',
    root: '<TITLE_ROOT>/_work/<PROJECT_ID>/',
    project_root_escape_allowed: false,
    link_or_reparse_allowed: false,
  })) if (boundaryPipeline?.[field] !== expected) add(issues, `contract: workspace_boundary_contract.${field} must equal ${expected}`);
  const qaSkill = contents.get('gt-qa') ?? '';
  for (const phrase of ['Eden-MCP', 'Ryubing-MCP', 'RELEASE_RUNTIME_QA.json', 'mcp_used=false', 'runtime:validate']) {
    if (!qaSkill.includes(phrase)) add(issues, `gt-qa: missing final runtime gate ${phrase}`);
  }
  const releaseSkill = contents.get('gt-release') ?? '';
  for (const phrase of ['RELEASE_RUNTIME_QA.json', 'runtime:validate', 'MCP 없이 직접', 'PENDING_RUNTIME']) {
    if (!releaseSkill.includes(phrase)) add(issues, `gt-release: missing final runtime gate ${phrase}`);
  }
  for (const phrase of ['빌드 생성', '패치 생성', 'release:package:nsw', '<BASE_TITLE_ID>/romfs/<패치파일>', '*.gldelta']) {
    if (!releaseSkill.includes(phrase)) add(issues, `gt-release: missing canonical NSW package phrase ${phrase}`);
  }
  const nswRelease = contract?.nsw_release_package_contract;
  for (const [field, expected] of Object.entries({
    skill: 'gt-nsw-build',
    input: '40_build/layeredfs/<BASE_TITLE_ID>/romfs',
    output: '40_build/releases/<BASE_TITLE_ID>.zip',
    archive_root: '<BASE_TITLE_ID>/romfs/',
    packager: 'scripts/create-nsw-release.mjs',
    validator: 'scripts/validate-nsw-release.mjs',
  })) if (nswRelease?.[field] !== expected) add(issues, `contract: nsw_release_package_contract.${field} must equal ${expected}`);
  for (const trigger of ['빌드 생성', '패치 생성']) {
    if (!nswRelease?.trigger_phrases?.includes(trigger)) add(issues, `contract: missing NSW release trigger ${trigger}`);
  }
  const nswBuildSkill = contents.get('gt-nsw-build') ?? '';
  for (const phrase of [
    '빌드 생성',
    '패치 생성',
    '40_build/layeredfs/<BASE_TITLE_ID>/romfs/',
    '40_build/releases/<BASE_TITLE_ID>.zip',
    '<BASE_TITLE_ID>/romfs/<패치파일>',
    'release:package:nsw',
    'release:validate:nsw',
    '--replace',
    'apply_patch.py',
    '*.gldelta',
    'release_status=released',
    'BLOCKED',
    'HANDOFF.md',
  ]) if (!nswBuildSkill.includes(phrase)) add(issues, `gt-nsw-build: missing canonical package gate ${phrase}`);
  for (const phrase of ['gt-nsw-build', '빌드 생성', '패치 생성']) {
    if (!orchestrator.includes(phrase)) add(issues, `game-translate: missing NSW build route ${phrase}`);
  }
  try {
    const scaffold = await read(path.join(repositoryRoot, 'scripts', 'new-translation-project.mjs'));
    for (const phrase of ['imageGenerationManifestHeader', "'tool'", "'model'", "'quality'", "'original_feel_status'", "'attempts'", "'prompts'", "'receipts'", "'probes'", 'IMAGE_GENERATION_MANIFEST.tsv']) {
      if (!scaffold.includes(phrase)) add(issues, `project scaffold: missing image harness phrase ${phrase}`);
    }
    for (const phrase of ['basic_test_backend', 'mcp_session_scope', 'final_qa_runtime', 'final_qa_mcp_allowed', 'RELEASE_RUNTIME_QA.json', "'release-runtime'"]) {
      if (!scaffold.includes(phrase)) add(issues, `project scaffold: missing runtime harness phrase ${phrase}`);
    }
    for (const phrase of ['artifactIndexHeader', 'artifactLayoutDirectories', 'PROJECT_ARTIFACT_MANIFEST.tsv']) {
      if (!scaffold.includes(phrase)) add(issues, `project scaffold: missing artifact layout phrase ${phrase}`);
    }
    const projectValidator = await read(path.join(repositoryRoot, 'scripts', 'validate-translation-projects.mjs'));
    for (const phrase of ['validate-image-translation.mjs', 'imageHarnessRequired', 'Image harness validation failed', 'await isType']) {
      if (!projectValidator.includes(phrase)) add(issues, `project validator: missing image harness phrase ${phrase}`);
    }
    for (const phrase of ['validate-release-runtime.mjs', 'Official distribution runtime validation failed', 'final_qa_mcp_allowed', 'validateMcpSessionState']) {
      if (!projectValidator.includes(phrase)) add(issues, `project validator: missing runtime harness phrase ${phrase}`);
    }
    for (const phrase of ['validateArtifactLayout', 'artifactLayoutDirectories', 'Artifact layout validation failed']) {
      if (!projectValidator.includes(phrase)) add(issues, `project validator: missing artifact layout phrase ${phrase}`);
    }
    const artifactHarness = await read(path.join(repositoryRoot, 'scripts', 'artifact-harness.mjs'));
    for (const phrase of ['ensureArtifactLayout', 'validateArtifactLayout', 'PROJECT_ARTIFACT_MANIFEST.tsv', '--init']) {
      if (!artifactHarness.includes(phrase)) add(issues, `artifact harness: missing phrase ${phrase}`);
    }
    const boundaryValidator = await read(path.join(repositoryRoot, 'scripts', 'validate-project-boundary.mjs'));
    for (const phrase of ['validateProjectBoundary', 'assert-output', 'project-root', 'stage']) {
      if (!boundaryValidator.includes(phrase)) add(issues, `project boundary validator: missing phrase ${phrase}`);
    }
    const sessionGuard = await read(path.join(repositoryRoot, 'scripts', 'qa-session.mjs'));
    for (const phrase of ['eden-mcp', 'ryubing-mcp', 'inventory-backend', 'session_generation', 'exception-reason']) {
      if (!sessionGuard.includes(phrase)) add(issues, `QA session guard: missing single-title session phrase ${phrase}`);
    }
    const runtimeValidator = await read(path.join(repositoryRoot, 'scripts', 'validate-release-runtime.mjs'));
    for (const phrase of ['official-distribution-release', 'mcp_used', 'official_download_url', 'emulator_binary_sha256', 'active mod has an undeclared file']) {
      if (!runtimeValidator.includes(phrase)) add(issues, `runtime validator: missing final QA phrase ${phrase}`);
    }
    const releasePackager = await read(path.join(repositoryRoot, 'scripts', 'create-nsw-release.mjs'));
    for (const phrase of ['40_build', 'layeredfs', 'releases', '--replace', 'validateNswRelease']) {
      if (!releasePackager.includes(phrase)) add(issues, `NSW release packager: missing canonical phrase ${phrase}`);
    }
    const releaseValidator = await read(path.join(repositoryRoot, 'scripts', 'validate-nsw-release.mjs'));
    for (const phrase of ['validateNswRelease', 'project-root', 'romfs-root']) {
      if (!releaseValidator.includes(phrase)) add(issues, `NSW release validator: missing canonical phrase ${phrase}`);
    }
    const runtimeAdapters = JSON.parse(await read(path.join(repositoryRoot, 'platforms', 'nsw', 'runtime-emulators.json')));
    if (runtimeAdapters?.basic_qa?.backend !== 'eden-mcp') add(issues, 'NSW runtime adapter: basic backend must be eden-mcp');
    if (runtimeAdapters?.basic_qa?.session_scope !== 'one-per-title') add(issues, 'NSW runtime adapter: session scope must be one-per-title');
    if (runtimeAdapters?.final_qa?.mcp_allowed !== false) add(issues, 'NSW runtime adapter: final QA must forbid MCP');
    if (!Array.isArray(runtimeAdapters?.final_qa?.sources) || runtimeAdapters.final_qa.sources.length === 0) add(issues, 'NSW runtime adapter: official sources must not be empty');
    const steamAdapterFiles = ['PLATFORM.md', 'extract.md', 'build-test.md', 'release.md', 'runtime-emulators.json'];
    for (const file of steamAdapterFiles) await read(path.join(repositoryRoot, 'platforms', 'steam', file));
    const steamRuntime = JSON.parse(await read(path.join(repositoryRoot, 'platforms', 'steam', 'runtime-emulators.json')));
    if (steamRuntime?.basic_qa?.backend !== 'direct-native') add(issues, 'Steam runtime adapter: basic backend must be direct-native');
    if (steamRuntime?.basic_qa?.session_scope !== 'none') add(issues, 'Steam runtime adapter: native QA must not create MCP sessions');
    if (steamRuntime?.final_qa?.runtime_kind !== 'native-game') add(issues, 'Steam runtime adapter: final runtime kind must be native-game');
    if (steamRuntime?.final_qa?.mcp_allowed !== false) add(issues, 'Steam runtime adapter: final QA must forbid MCP');
    for (const script of ['new-steam-translation-project.mjs', 'validate-steam-project.mjs', 'create-steam-release.mjs', 'validate-steam-release.mjs']) {
      await read(path.join(repositoryRoot, 'scripts', script));
    }
  } catch (error) {
    add(issues, `project harness: cannot inspect scaffold/validators (${error.message})`);
  }
  for (const cleanup of ['gt-workspace-cleanup', 'gt-project-cleanup']) {
    const text = contents.get(cleanup) ?? '';
    for (const phrase of [
      'cleanup-contract',
      'CLEANUP_INSTRUCTIONS.md',
      'ARCHIVE_MANIFEST.json',
      'CLEANUP_ARCHIVE_REVIEW.md',
      'TRASH_PLAN.json',
      'approved=true',
      'user_trash_approval=true',
      '--review-archive',
      '--trash',
      '--user-confirmed-trash',
      'TRASH_RECEIPT.json',
      '영구 삭제로 폴백하지',
      'HANDOFF',
      'PROJECT_ARTIFACT_MANIFEST.tsv',
    ]) if (!text.includes(phrase)) add(issues, `${cleanup}: missing archive-first cleanup phrase ${phrase}`);
  }
  const pluginFiles = ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json'];
  for (const pluginFile of pluginFiles) {
    try {
      const raw = await read(path.join(repositoryRoot, pluginFile));
      const plugin = JSON.parse(raw);
      if (/seven-stage|7-stage|7단계/i.test(raw)) add(issues, `${pluginFile}: stale seven-stage description`);
      const expectedPluginVersion = pluginFile === '.codex-plugin/plugin.json'
        ? new RegExp(`^${bundleVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\+codex\\.[A-Za-z0-9._-]+)?$`)
        : null;
      if (pluginFile === '.codex-plugin/plugin.json' && !expectedPluginVersion.test(plugin.version)) add(issues, `${pluginFile}: version must match package ${bundleVersion} with at most one Codex cachebuster suffix`);
      if (pluginFile === '.claude-plugin/plugin.json' && plugin.version !== bundleVersion) add(issues, `${pluginFile}: version must match package ${bundleVersion}`);
      if (pluginFile === '.claude-plugin/marketplace.json' && plugin.metadata?.version !== bundleVersion) add(issues, `${pluginFile}: metadata.version must match package ${bundleVersion}`);
    } catch (error) {
      add(issues, `${pluginFile}: cannot read/parse (${error.message})`);
    }
  }
  console.log(`Skills: ${skillDirs.length}`);
  console.log(`Contract stages: ${contract?.stages?.length ?? 0}`);
  console.log(`Issues: ${issues.length}`);
  for (const issue of issues) console.log(`ERROR\t${issue}`);
  if (issues.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exitCode = 1;
});
