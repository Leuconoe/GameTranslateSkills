#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsRoot = path.join(repositoryRoot, 'skills');
const contractPath = path.join(repositoryRoot, 'common', 'pipeline-contract.json');
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
  for (const cleanup of ['gt-workspace-cleanup', 'gt-project-cleanup']) {
    const text = contents.get(cleanup) ?? '';
    for (const phrase of ['cleanup-contract', 'CLEANUP_INSTRUCTIONS.md', 'approved=true', 'HANDOFF']) if (!text.includes(phrase)) add(issues, `${cleanup}: missing cleanup harness phrase ${phrase}`);
  }
  const pluginFiles = ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json'];
  for (const pluginFile of pluginFiles) {
    try {
      const raw = await read(path.join(repositoryRoot, pluginFile));
      const plugin = JSON.parse(raw);
      if (/seven-stage|7-stage|7단계/i.test(raw)) add(issues, `${pluginFile}: stale seven-stage description`);
      if (pluginFile !== '.claude-plugin/marketplace.json' && plugin.version !== '1.3.0') add(issues, `${pluginFile}: version must match current 1.3.0 bundle`);
      if (pluginFile === '.claude-plugin/marketplace.json' && plugin.metadata?.version !== '1.3.0') add(issues, `${pluginFile}: metadata.version must match current 1.3.0 bundle`);
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
