#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsRoot = path.join(repositoryRoot, 'skills');
const contractPath = path.join(repositoryRoot, 'common', 'pipeline-contract.json');
const imageContractPath = path.join(repositoryRoot, 'common', 'image-translation-contract.md');
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
  const expectedSkills = new Set([...expectedStageSkills, 'game-translate', 'gt-workspace-cleanup', 'gt-project-cleanup']);
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
    'Python/Pillow/OpenCV',
    'source/reference/candidate',
    'alpha byte',
    'decoded RGBA diff',
    'validate-image-translation.mjs',
  ]) if (!imageContract.includes(phrase)) add(issues, `image contract: missing fail-closed phrase ${phrase}`);
  const imageAnalyze = contents.get('gt-image-analyze') ?? '';
  for (const phrase of ['image-translation-contract', '분위기', 'edit_regions', 'byte-exact reference']) if (!imageAnalyze.includes(phrase)) add(issues, `gt-image-analyze: missing image preservation phrase ${phrase}`);
  const imageTranslate = contents.get('gt-image-translate') ?? '';
  for (const phrase of [
    'image-translation-contract',
    '$imagegen',
    'image_gen.imagegen',
    'view_image',
    'Python/Pillow/OpenCV',
    'IMAGE_GENERATION_MANIFEST.tsv',
    'validate-image-translation.mjs',
    '원본, reference, 기존 candidate',
    'hold-for-imagegen',
  ]) if (!imageTranslate.includes(phrase)) add(issues, `gt-image-translate: missing imagegen-only gate ${phrase}`);
  const imageQa = contents.get('gt-image-qa') ?? '';
  for (const phrase of [
    'image-translation-contract',
    'IMAGE_GENERATION_MANIFEST.tsv',
    'image_gen.imagegen',
    'Python/Pillow/OpenCV',
    'validate-image-translation.mjs',
    '기본은 전 픽셀 exact',
    '영역 밖 decoded RGBA는 diff 0',
  ]) if (!imageQa.includes(phrase)) add(issues, `gt-image-qa: missing image harness gate ${phrase}`);
  const imageReview = contents.get('gt-image-review') ?? '';
  for (const phrase of ['IMAGE_GENERATION_MANIFEST.tsv', 'image_gen.imagegen', 'alpha policy', 'RGBA diff 0']) if (!imageReview.includes(phrase)) add(issues, `gt-image-review: missing image evidence phrase ${phrase}`);
  const imagePipeline = contract?.image_generation_contract;
  for (const [field, expected] of Object.entries({
    document: 'common/image-translation-contract.md',
    manifest: '30_translation/image_translation/IMAGE_GENERATION_MANIFEST.tsv',
    validator: 'scripts/validate-image-translation.mjs',
    agent_generator: 'imagegen',
    tool: 'image_gen.imagegen',
    operation: 'edit',
  })) if (imagePipeline?.[field] !== expected) add(issues, `contract: image_generation_contract.${field} must equal ${expected}`);
  try {
    const scaffold = await read(path.join(repositoryRoot, 'scripts', 'new-translation-project.mjs'));
    for (const phrase of ['imageGenerationManifestHeader', "'prompts'", "'receipts'", "'probes'", 'IMAGE_GENERATION_MANIFEST.tsv']) {
      if (!scaffold.includes(phrase)) add(issues, `project scaffold: missing image harness phrase ${phrase}`);
    }
    const projectValidator = await read(path.join(repositoryRoot, 'scripts', 'validate-translation-projects.mjs'));
    for (const phrase of ['validate-image-translation.mjs', 'imageHarnessRequired', 'Image harness validation failed', 'await isType']) {
      if (!projectValidator.includes(phrase)) add(issues, `project validator: missing image harness phrase ${phrase}`);
    }
  } catch (error) {
    add(issues, `project image harness: cannot inspect scaffold/validator (${error.message})`);
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
    ]) if (!text.includes(phrase)) add(issues, `${cleanup}: missing archive-first cleanup phrase ${phrase}`);
  }
  const pluginFiles = ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json'];
  for (const pluginFile of pluginFiles) {
    try {
      const raw = await read(path.join(repositoryRoot, pluginFile));
      const plugin = JSON.parse(raw);
      if (/seven-stage|7-stage|7단계/i.test(raw)) add(issues, `${pluginFile}: stale seven-stage description`);
      if (pluginFile !== '.claude-plugin/marketplace.json' && plugin.version !== '1.4.0') add(issues, `${pluginFile}: version must match current 1.4.0 bundle`);
      if (pluginFile === '.claude-plugin/marketplace.json' && plugin.metadata?.version !== '1.4.0') add(issues, `${pluginFile}: metadata.version must match current 1.4.0 bundle`);
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
