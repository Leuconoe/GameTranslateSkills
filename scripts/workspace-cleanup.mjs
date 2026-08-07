#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';

const titleIdPattern = /^[0-9A-Fa-f]{16}$/;
const suspiciousNames = new Set(['data', 'output', 'temp', 'romfs', 'image_translation', '.codex_m2_probe']);

function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isDuplicateLikeName(name) {
  return /^tmp[-_.]/i.test(name) || /(?:^|[-_.])(session|run)[-_.]/i.test(name)
    || /(?:\(\d+\)|[-_.](?:copy|backup))(?:\.|$)/i.test(name);
}

async function isDirectory(target) {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function readText(target) {
  try {
    return await fs.readFile(target, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

async function readJson(target) {
  try {
    return JSON.parse(await fs.readFile(target, 'utf8'));
  } catch {
    return null;
  }
}

async function directEntries(root) {
  return (await fs.readdir(root, { withFileTypes: true })).map((entry) => ({
    name: entry.name,
    path: path.join(root, entry.name),
    kind: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'link' : 'file',
  }));
}

async function findWorkFolders(root, depth = 0, output = []) {
  if (depth > 5) return output;
  for (const entry of await directEntries(root)) {
    if (entry.kind !== 'directory' || entry.kind === 'link') continue;
    if (entry.name === '_work') {
      output.push(entry.path);
      continue;
    }
    await findWorkFolders(entry.path, depth + 1, output);
  }
  return output;
}

function extractReferences(text, baseRoot, containmentRoot = baseRoot) {
  const result = new Set();
  const pattern = /(?:[A-Za-z]:[\\/][^\s|)>'"`]+|[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+)/g;
  for (const raw of text.match(pattern) ?? []) {
    const cleaned = raw.replace(/[.,;:]+$/g, '').replaceAll('\\', path.sep);
    const target = path.isAbsolute(cleaned) ? path.resolve(cleaned) : path.resolve(baseRoot, cleaned);
    if (isWithin(containmentRoot, target)) result.add(target);
  }
  return result;
}

async function nestedFiles(root, current = root, output = []) {
  let entries;
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) await nestedFiles(root, target, output);
    else output.push(target);
  }
  return output;
}

async function collectHandoffReferences(workspaceRoot) {
  const refs = new Set();
  const statuses = { open: 0, applied: 0, rejected: 0, unknown: 0 };
  for (const workRoot of await findWorkFolders(workspaceRoot)) {
    for (const project of await directEntries(workRoot)) {
      if (project.kind !== 'directory' || !titleIdPattern.test(project.name)) continue;
      for (const file of await nestedFiles(project.path)) {
        const base = path.basename(file);
        if (!/^(HANDOFF|PROJECT|WORK_LOG|TEST_LOG|.*MANIFEST|.*REPORT|.*REFERENCE|STYLE).*$/i.test(base)) continue;
        const text = await readText(file);
        for (const reference of extractReferences(text, project.path, workspaceRoot)) refs.add(reference);
        if (base.toUpperCase() !== 'HANDOFF.MD') continue;
        for (const line of text.split(/\r?\n/)) {
          const bulletStatus = line.match(/(?:상태|status)\s*:\s*(open|applied|rejected)\b/i)?.[1]?.toLowerCase();
          const status = bulletStatus ?? line.split('|').at(-1)?.trim().toLowerCase();
          if (Object.hasOwn(statuses, status)) statuses[status] += 1;
          else if (line.includes('|') && !line.startsWith('#')) statuses.unknown += 1;
        }
      }
    }
  }
  return { references: refs, statuses };
}

async function inspectProjects(workspaceRoot) {
  const workRoots = await findWorkFolders(workspaceRoot);
  const projects = [];
  for (const workRoot of workRoots) {
    for (const project of await directEntries(workRoot)) {
      if (project.kind !== 'directory' || !titleIdPattern.test(project.name)) continue;
      const session = await readJson(path.join(project.path, '50_test', 'eden', 'SESSION.json'));
      projects.push({ id: project.name.toUpperCase(), path: project.path, session });
    }
  }
  const byId = new Map();
  for (const project of projects) byId.set(project.id, [...(byId.get(project.id) ?? []), project.path]);
  const duplicateIds = [...byId].filter(([, paths]) => paths.length > 1).map(([id, paths]) => ({ id, paths }));
  const active = projects.filter(({ session }) => ['active', 'pending'].includes(session?.status));
  return { projects, duplicateIds, active };
}

function protectedByReference(target, references) {
  return [...references].some((reference) => samePath(reference, target) || isWithin(reference, target) || isWithin(target, reference));
}

async function buildPlan(workspaceRoot) {
  const handoff = await collectHandoffReferences(workspaceRoot);
  const inspection = await inspectProjects(workspaceRoot);
  const entries = await directEntries(workspaceRoot);
  const protectedNames = new Set(['_title', '_titles', '_tools', 'AGENTS.md', 'README.md']);
  const candidates = [];
  for (const entry of entries) {
    const lower = entry.name.toLowerCase();
    const reasons = [];
    if (suspiciousNames.has(lower)) reasons.push('unscoped-root-name');
    if (isDuplicateLikeName(entry.name)) reasons.push('duplicate-like-name');
    if (entry.name.toLowerCase() === 'title') reasons.push('generic-title-folder');
    if (reasons.length === 0 || protectedNames.has(entry.name)) continue;
    const referenced = protectedByReference(entry.path, handoff.references);
    const activeTitle = inspection.active.some(({ path: projectPath }) => isWithin(entry.path, projectPath) || isWithin(projectPath, entry.path));
    candidates.push({
      path: entry.name,
      kind: entry.kind,
      reason: reasons.join(', '),
      evidence: referenced
        ? 'Referenced by a project Handoff; preserve and reconcile the reference first.'
        : activeTitle
          ? 'Contains an active or pending project session; do not remove.'
          : 'Unscoped root entry requires literal-content and ownership review.',
      risk: activeTitle || referenced ? 'high' : 'medium',
      blocked: referenced || activeTitle || entry.kind === 'link' || entry.kind === 'directory',
      approved: false,
    });
  }
  return {
    schema_version: 1,
    kind: 'workspace-cleanup',
    generated_at: new Date().toISOString(),
    workspace_root: path.resolve(workspaceRoot),
    handoff,
    projects: inspection.projects.map(({ id, path: projectPath, session }) => ({ id, path: projectPath, session_status: session?.status ?? 'missing' })),
    findings: {
      duplicate_title_ids: inspection.duplicateIds,
      active_or_pending_sessions: inspection.active.map(({ id, path: projectPath, session }) => ({ id, path: projectPath, status: session.status })),
    },
    candidates: candidates.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

function renderInstructions(plan) {
  const lines = [
    '# Workspace cleanup instructions',
    '',
    `- Workspace: \`${plan.workspace_root}\``,
    `- Generated: \`${plan.generated_at}\``,
    `- Projects: ${plan.projects.length}`,
    `- Handoff: open=${plan.handoff.statuses.open}, applied=${plan.handoff.statuses.applied}, rejected=${plan.handoff.statuses.rejected}, unknown=${plan.handoff.statuses.unknown}`,
    '',
    '이 문서는 삭제 명령이 아니다. 루트 항목의 실제 내용과 각 프로젝트 Handoff·세션 소유권을 확인한 뒤 exact 경로만 승인한다.',
    '',
    '| 승인 | 위험 | 루트 항목 | 이유 | 근거/차단 조건 |',
    '|---|---|---|---|---|',
  ];
  for (const candidate of plan.candidates) lines.push(`| ${candidate.approved ? 'yes' : 'no'} | ${candidate.risk} | \`${candidate.path}\` | ${candidate.reason} | ${candidate.blocked ? candidate.evidence : 'review contents, ownership, and Handoff before approval'} |`);
  lines.push('', '발견된 구조 문제:', '', `- 중복 Title ID: ${plan.findings.duplicate_title_ids.length || '없음'}`, `- active/pending 세션: ${plan.findings.active_or_pending_sessions.length || '없음'}`, '', '적용 전 체크:', '', '- [ ] active/pending/소유권 불명 세션을 삭제 후보로 사용하지 않음', '- [ ] Handoff evidence와 canonical manifest를 보존함', '- [ ] 계획의 exact path만 승인함', '- [ ] 계획 파일 SHA-256을 기록함', '');
  return `${lines.join('\n')}\n`;
}

async function atomicWrite(target, content) {
  const temp = `${target}.tmp-cleanup-${process.pid}`;
  await fs.writeFile(temp, content, 'utf8');
  try {
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

async function applyPlan(planPath, workspaceRoot, expectedSha) {
  const raw = await fs.readFile(planPath, 'utf8');
  const actualSha = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  if (actualSha.toLowerCase() !== expectedSha.toLowerCase()) throw new Error(`Cleanup plan SHA-256 mismatch: expected ${expectedSha}, actual ${actualSha}`);
  const plan = JSON.parse(raw);
  if (plan.kind !== 'workspace-cleanup' || !samePath(plan.workspace_root, workspaceRoot)) throw new Error('Cleanup plan does not belong to this workspace');
  const approved = plan.candidates.filter((candidate) => candidate.approved === true);
  if (approved.length === 0) throw new Error('No approved exact workspace candidates in plan');
  const current = await buildPlan(workspaceRoot);
  const currentByPath = new Map(current.candidates.map((candidate) => [candidate.path, candidate]));
  for (const candidate of approved) {
    const currentCandidate = currentByPath.get(candidate.path);
    if (!currentCandidate || currentCandidate.blocked || currentCandidate.kind !== candidate.kind) throw new Error(`Candidate is no longer safe or is blocked: ${candidate.path}`);
    const target = path.resolve(workspaceRoot, candidate.path);
    if (!isWithin(workspaceRoot, target)) throw new Error(`Candidate escaped workspace root: ${candidate.path}`);
    const stats = await fs.lstat(target);
    if (stats.isSymbolicLink() || stats.isDirectory()) throw new Error(`Only explicitly inventoried files may be applied; refusing ${candidate.path}`);
  }
  for (const candidate of approved) {
    await fs.rm(path.resolve(workspaceRoot, candidate.path), { force: false });
    console.log(`REMOVED\t${candidate.path}`);
  }
  console.log(`Plan SHA-256: ${actualSha}`);
  console.log(`Removed: ${approved.length}`);
}

function usage() {
  console.log(`Usage: npm run workspace:cleanup -- --workspace-root <path> --report <path> [options]

Default: generate a Handoff-based root cleanup plan; never delete.

Options:
  --workspace-root <path>  Exact translation workspace root (not a system root or project root)
  --report <path>          Instruction markdown path outside the workspace root
  --plan <path>            Plan JSON path for --apply (default: sibling CLEANUP_PLAN.json)
  --apply                  Apply only approved file candidates in --plan
  --plan-sha256 <sha256>   Required with --apply; SHA-256 of reviewed plan
  --help                   Show this help`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flag(args, 'help')) return usage();
  const workspaceRoot = path.resolve(requiredOption(args, 'workspace-root'));
  if (path.parse(workspaceRoot).root === workspaceRoot) throw new Error('Refusing to inspect a filesystem root');
  if (!(await isDirectory(workspaceRoot))) throw new Error(`Workspace root does not exist: ${workspaceRoot}`);
  if (path.basename(workspaceRoot) === '_work' || titleIdPattern.test(path.basename(workspaceRoot))) throw new Error('Pass the workspace root, not a project _work or project directory');
  const reportPath = path.resolve(requiredOption(args, 'report'));
  if (isWithin(workspaceRoot, reportPath)) throw new Error('--report must be outside the workspace root so the report is not treated as a workspace artifact');
  const planPath = path.resolve(option(args, 'plan') ?? path.join(path.dirname(reportPath), 'CLEANUP_PLAN.json'));
  if (isWithin(workspaceRoot, planPath)) throw new Error('--plan must be outside the workspace root');
  if (flag(args, 'apply')) {
    const expectedSha = requiredOption(args, 'plan-sha256');
    await applyPlan(planPath, workspaceRoot, expectedSha);
    return;
  }
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.mkdir(path.dirname(planPath), { recursive: true });
  const plan = await buildPlan(workspaceRoot);
  await atomicWrite(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  await atomicWrite(reportPath, renderInstructions(plan));
  const planSha = crypto.createHash('sha256').update(await fs.readFile(planPath)).digest('hex');
  console.log(`Plan: ${planPath}`);
  console.log(`Instructions: ${reportPath}`);
  console.log(`Plan SHA-256: ${planSha}`);
  console.log(`Candidates: ${plan.candidates.length}; Blocked: ${plan.candidates.filter((candidate) => candidate.blocked).length}`);
  console.log('No files were removed.');
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exitCode = 1;
});
