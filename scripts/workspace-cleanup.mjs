#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';
import {
  archiveApprovedFiles,
  atomicWrite,
  generateArchiveReview,
  isWithin,
  samePath,
  sha256File,
  sha256Text,
  trashArchive,
} from './lib/cleanup-archive.mjs';

const titleIdPattern = /^[0-9A-Fa-f]{16}$/;
const suspiciousNames = new Set(['data', 'output', 'temp', 'romfs', 'image_translation', '.codex_m2_probe']);

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

async function inventoryTree(current, summary = { files: 0, directories: 0, links: 0, bytes: 0 }) {
  for (const entry of await directEntries(current)) {
    if (entry.kind === 'link') {
      summary.links += 1;
      continue;
    }
    if (entry.kind === 'directory') {
      summary.directories += 1;
      await inventoryTree(entry.path, summary);
      continue;
    }
    const stats = await fs.lstat(entry.path);
    summary.files += 1;
    summary.bytes += stats.size;
  }
  return summary;
}

async function collectHandoffReferences(workspaceRoot) {
  const refs = new Set();
  const statuses = { open: 0, applied: 0, rejected: 0, unknown: 0 };
  const documents = [];
  for (const workRoot of await findWorkFolders(workspaceRoot)) {
    for (const project of await directEntries(workRoot)) {
      if (project.kind !== 'directory' || !titleIdPattern.test(project.name)) continue;
      for (const file of await nestedFiles(project.path)) {
        const base = path.basename(file);
        if (!/^(HANDOFF|PROJECT|WORK_LOG|TEST_LOG|.*MANIFEST|.*REPORT|.*REFERENCE|STYLE).*$/i.test(base)) continue;
        const text = await readText(file);
        for (const reference of extractReferences(text, project.path, workspaceRoot)) refs.add(reference);
        documents.push({
          path: path.relative(workspaceRoot, file),
          sha256: sha256Text(text),
        });
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
  return {
    references: refs,
    statuses,
    documents: documents.sort((left, right) => left.path.localeCompare(right.path)),
  };
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
  const inventory = await inventoryTree(workspaceRoot);
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
    const stats = entry.kind === 'file' ? await fs.lstat(entry.path) : null;
    candidates.push({
      path: entry.name,
      kind: entry.kind,
      size: stats?.size ?? null,
      sha256: entry.kind === 'file' ? await sha256File(entry.path) : null,
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
    schema_version: 2,
    kind: 'workspace-cleanup',
    generated_at: new Date().toISOString(),
    workspace_root: path.resolve(workspaceRoot),
    handoff,
    projects: inspection.projects.map(({ id, path: projectPath, session }) => ({ id, path: projectPath, session_status: session?.status ?? 'missing' })),
    findings: {
      duplicate_title_ids: inspection.duplicateIds,
      active_or_pending_sessions: inspection.active.map(({ id, path: projectPath, session }) => ({ id, path: projectPath, status: session.status })),
    },
    review_inputs: {
      documents: handoff.documents,
    },
    inventory,
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
    '이 문서는 삭제 명령이 아니다. 루트 항목의 실제 내용과 각 프로젝트 Handoff·세션 소유권을 확인한 뒤 외부 아카이브로 이동할 exact 경로만 승인한다.',
    '',
    '| 승인 | 위험 | 루트 항목 | 바이트 | SHA-256 | 이유 | 근거/차단 조건 |',
    '|---|---|---|---:|---|---|---|',
  ];
  for (const candidate of plan.candidates) lines.push(`| ${candidate.approved ? 'yes' : 'no'} | ${candidate.risk} | \`${candidate.path}\` | ${candidate.size ?? '-'} | ${candidate.sha256 ? `\`${candidate.sha256}\`` : '-'} | ${candidate.reason} | ${candidate.blocked ? candidate.evidence : 'review contents, ownership, and Handoff before approval'} |`);
  lines.push('', '발견된 구조 문제:', '', `- 중복 Title ID: ${plan.findings.duplicate_title_ids.length || '없음'}`, `- active/pending 세션: ${plan.findings.active_or_pending_sessions.length || '없음'}`, '', '아카이브 적용 전 체크:', '', '- [ ] active/pending/소유권 불명 세션을 정리 후보로 사용하지 않음', '- [ ] Handoff evidence와 canonical manifest를 보존함', '- [ ] 계획의 exact path만 승인함', '- [ ] 계획 파일 SHA-256을 기록함', '', '`--apply`는 승인 파일을 작업장 밖 전용 아카이브로 이동하고 전수 재검토 보고서와 별도 휴지통 이동 계획을 만든다. 이 단계에서는 영구 삭제하거나 휴지통으로 보내지 않는다.', '');
  return `${lines.join('\n')}\n`;
}

function reviewState(plan) {
  return {
    handoff_statuses: plan.handoff.statuses,
    projects: [...plan.projects]
      .map(({ id, path: projectPath, session_status }) => ({ id, path: projectPath, session_status }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    findings: {
      duplicate_title_ids: plan.findings.duplicate_title_ids
        .map(({ id, paths }) => ({ id, paths: [...paths].sort() }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      active_or_pending_sessions: [...plan.findings.active_or_pending_sessions]
        .map(({ id, path: projectPath, status }) => ({ id, path: projectPath, status }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    },
    review_inputs: plan.review_inputs,
    inventory: plan.inventory,
    candidates: plan.candidates.map(({ path: candidatePath, kind, size, sha256, reason, evidence, risk, blocked }) => ({
      path: candidatePath,
      kind,
      size,
      sha256,
      reason,
      evidence,
      risk,
      blocked,
    })),
  };
}

function renderReviewState(state) {
  const lines = [
    `- Projects re-inventoried: ${state.projects.length}`,
    `- Handoff states: open=${state.handoff_statuses.open}, applied=${state.handoff_statuses.applied}, rejected=${state.handoff_statuses.rejected}, unknown=${state.handoff_statuses.unknown}`,
    `- Control documents rehashed: ${state.review_inputs.documents.length}`,
    `- Full tree inventory: files=${state.inventory.files}, directories=${state.inventory.directories}, links=${state.inventory.links}, bytes=${state.inventory.bytes}`,
    `- Duplicate Title IDs: ${state.findings.duplicate_title_ids.length}`,
    `- Active/pending sessions: ${state.findings.active_or_pending_sessions.length}`,
    `- Remaining root cleanup candidates: ${state.candidates.length}`,
    `- Remaining blocked candidates: ${state.candidates.filter((candidate) => candidate.blocked).length}`,
  ];
  lines.push('', '### Projects and session states', '', '| Project ID | Project path | Session |', '|---|---|---|');
  if (state.projects.length === 0) lines.push('| 없음 | - | - |');
  else for (const project of state.projects) lines.push(`| \`${project.id}\` | \`${project.path}\` | \`${project.session_status}\` |`);
  lines.push('', '### Duplicate Title IDs', '');
  if (state.findings.duplicate_title_ids.length === 0) lines.push('- 없음');
  else for (const duplicate of state.findings.duplicate_title_ids) lines.push(`- \`${duplicate.id}\`: ${duplicate.paths.map((candidatePath) => `\`${candidatePath}\``).join(', ')}`);
  lines.push('', '### Active or pending sessions', '');
  if (state.findings.active_or_pending_sessions.length === 0) lines.push('- 없음');
  else for (const session of state.findings.active_or_pending_sessions) lines.push(`- \`${session.id}\` at \`${session.path}\`: \`${session.status}\``);
  lines.push('', '### Rehashed control documents', '', '| Path | SHA-256 |', '|---|---|');
  if (state.review_inputs.documents.length === 0) lines.push('| 없음 | - |');
  else for (const document of state.review_inputs.documents) lines.push(`| \`${document.path}\` | \`${document.sha256}\` |`);
  lines.push('', '### Remaining root cleanup candidates', '', '| Blocked | Risk | Path | Reason | Evidence |', '|---|---|---|---|---|');
  if (state.candidates.length === 0) lines.push('| - | - | 없음 | - | - |');
  else for (const candidate of state.candidates) lines.push(`| ${candidate.blocked ? 'yes' : 'no'} | ${candidate.risk} | \`${candidate.path}\` | ${candidate.reason} | ${candidate.evidence} |`);
  return lines;
}

async function generateReview(workspaceRoot, archiveManifestPath, expectedManifestSha256) {
  const currentState = reviewState(await buildPlan(workspaceRoot));
  return generateArchiveReview({
    cleanupKind: 'workspace-cleanup',
    sourceRoot: workspaceRoot,
    archiveManifestPath,
    expectedManifestSha256,
    reviewState: currentState,
    reviewStateLines: renderReviewState(currentState),
  });
}

async function archivePlan(planPath, workspaceRoot, expectedSha) {
  const raw = await fs.readFile(planPath, 'utf8');
  const actualSha = sha256Text(raw);
  if (actualSha.toLowerCase() !== expectedSha.toLowerCase()) throw new Error(`Cleanup plan SHA-256 mismatch: expected ${expectedSha}, actual ${actualSha}`);
  const plan = JSON.parse(raw);
  if (plan.kind !== 'workspace-cleanup' || !samePath(plan.workspace_root, workspaceRoot)) throw new Error('Cleanup plan does not belong to this workspace');
  const approved = plan.candidates.filter((candidate) => candidate.approved === true);
  if (approved.length === 0) throw new Error('No approved exact workspace candidates to archive in plan');
  const current = await buildPlan(workspaceRoot);
  const currentByPath = new Map(current.candidates.map((candidate) => [candidate.path, candidate]));
  for (const candidate of approved) {
    const currentCandidate = currentByPath.get(candidate.path);
    if (!currentCandidate || currentCandidate.blocked || currentCandidate.kind !== candidate.kind
      || currentCandidate.size !== candidate.size || currentCandidate.sha256 !== candidate.sha256) {
      throw new Error(`Candidate changed, is no longer safe, or is blocked: ${candidate.path}`);
    }
    const target = path.resolve(workspaceRoot, candidate.path);
    if (!isWithin(workspaceRoot, target)) throw new Error(`Candidate escaped workspace root: ${candidate.path}`);
    const stats = await fs.lstat(target);
    if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`Only explicitly inventoried files may be archived; refusing ${candidate.path}`);
  }
  const archiveBase = path.join(path.dirname(path.resolve(planPath)), 'workspace-cleanup-archive');
  if (samePath(workspaceRoot, archiveBase) || isWithin(workspaceRoot, archiveBase)) throw new Error('Workspace archive root must be outside the workspace');
  const archived = await archiveApprovedFiles({
    cleanupKind: 'workspace-cleanup',
    sourceRoot: workspaceRoot,
    planPath,
    planSha256: actualSha,
    generatedAt: plan.generated_at,
    archiveBase,
    candidates: approved,
  });
  const review = await generateReview(workspaceRoot, archived.manifestPath, archived.manifestSha256);
  for (const candidate of approved) console.log(`ARCHIVED\t${candidate.path}`);
  console.log(`Plan SHA-256: ${actualSha}`);
  console.log(`Archive manifest: ${archived.manifestPath}`);
  console.log(`Archive manifest SHA-256: ${archived.manifestSha256}`);
  console.log(`Detailed review: ${review.reviewReportPath}`);
  console.log(`Detailed review SHA-256: ${review.reviewReportSha256}`);
  console.log(`Trash plan: ${review.trashPlanPath}`);
  console.log(`Trash plan SHA-256: ${review.trashPlanSha256}`);
  console.log(`Archived: ${approved.length}; moved to OS Trash: 0; permanently deleted: 0`);
  if (!review.fullReinspectionComplete) throw new Error('Post-archive full reinspection is blocked; do not request --trash');
}

function requiredAliasedOption(args, primary, legacy) {
  const primaryValue = option(args, primary);
  const legacyValue = option(args, legacy);
  if (primaryValue !== undefined && legacyValue !== undefined) {
    throw new Error(`Use only --${primary} or legacy --${legacy}, not both`);
  }
  const value = primaryValue ?? legacyValue;
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Missing required option: --${primary}`);
  return value.trim();
}

function usage() {
  console.log(`Usage: npm run workspace:cleanup -- --workspace-root <path> [options]

Default: generate a Handoff-based root cleanup plan; never move or delete.

Options:
  --workspace-root <path>  Exact translation workspace root (not a system root or project root)
  --report <path>          Required in planning mode; instruction markdown outside the workspace
  --plan <path>            Reviewed plan JSON path for --apply
  --apply                  Move approved=true files into an external cleanup archive
  --plan-sha256 <sha256>   Required with --apply; SHA-256 of reviewed plan
  --review-archive         Re-run the full post-archive review and reset Trash approvals
  --archive-manifest <path>
                          Completed ARCHIVE_MANIFEST.json for --review-archive
  --archive-manifest-sha256 <sha256>
                          Required with --review-archive
  --trash                  Move a fully reviewed and separately approved archive transaction to the OS Trash
  --trash-plan <path>      TRASH_PLAN.json with report/user/item approvals recorded
  --trash-plan-sha256 <sha256>
                          Required with --trash; current reviewed trash-plan hash
  --user-confirmed-trash   Required with --trash after a separate explicit user request
  --purge                  Legacy alias for --trash; never permanently deletes
  --delete-plan <path>     Legacy alias accepting a prior DELETE_PLAN.json
  --delete-plan-sha256 <sha256>
                          Legacy alias for --trash-plan-sha256
  --user-confirmed-delete  Legacy alias for --user-confirmed-trash; still sends only to Trash
  --help                   Show this help`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flag(args, 'help')) return usage();
  const workspaceRoot = path.resolve(requiredOption(args, 'workspace-root'));
  if (path.parse(workspaceRoot).root === workspaceRoot) throw new Error('Refusing to inspect a filesystem root');
  if (!(await isDirectory(workspaceRoot))) throw new Error(`Workspace root does not exist: ${workspaceRoot}`);
  if (path.basename(workspaceRoot) === '_work' || titleIdPattern.test(path.basename(workspaceRoot))) throw new Error('Pass the workspace root, not a project _work or project directory');
  const primaryTrash = flag(args, 'trash');
  const legacyPurge = flag(args, 'purge');
  if (primaryTrash && legacyPurge) throw new Error('Use only --trash or legacy --purge, not both');
  const wantsTrash = primaryTrash || legacyPurge;
  const modeCount = [flag(args, 'apply'), flag(args, 'review-archive'), wantsTrash].filter(Boolean).length;
  if (modeCount > 1) throw new Error('Choose exactly one of --apply, --review-archive, or --trash');
  if (flag(args, 'review-archive')) {
    const review = await generateReview(
      workspaceRoot,
      requiredOption(args, 'archive-manifest'),
      requiredOption(args, 'archive-manifest-sha256'),
    );
    console.log(`Detailed review: ${review.reviewReportPath}`);
    console.log(`Detailed review SHA-256: ${review.reviewReportSha256}`);
    console.log(`Trash plan: ${review.trashPlanPath}`);
    console.log(`Trash plan SHA-256: ${review.trashPlanSha256}`);
    console.log('Trash approvals were reset. Report the full review to the user and stop.');
    if (!review.fullReinspectionComplete) throw new Error('Full archive reinspection is blocked; --trash remains unavailable');
    return;
  }
  if (wantsTrash) {
    if (legacyPurge) console.log('Compatibility notice: --purge now moves files to the OS Trash and never permanently deletes them.');
    const currentState = reviewState(await buildPlan(workspaceRoot));
    const result = await trashArchive({
      cleanupKind: 'workspace-cleanup',
      sourceRoot: workspaceRoot,
      trashPlanPath: requiredAliasedOption(args, 'trash-plan', 'delete-plan'),
      expectedTrashPlanSha256: requiredAliasedOption(args, 'trash-plan-sha256', 'delete-plan-sha256'),
      userConfirmedTrash: flag(args, 'user-confirmed-trash') || flag(args, 'user-confirmed-delete'),
      currentReviewState: currentState,
    });
    console.log(`Trash receipt: ${result.receiptPath}`);
    console.log(`Trash receipt SHA-256: ${result.receiptSha256}`);
    console.log(`Moved from archive to OS Recycle Bin/Trash: ${result.trashed}; permanently deleted: 0`);
    return;
  }
  if (flag(args, 'apply')) {
    const planPath = path.resolve(requiredOption(args, 'plan'));
    if (samePath(workspaceRoot, planPath) || isWithin(workspaceRoot, planPath)) throw new Error('--plan must be outside the workspace root');
    const expectedSha = requiredOption(args, 'plan-sha256');
    await archivePlan(planPath, workspaceRoot, expectedSha);
    return;
  }
  const reportPath = path.resolve(requiredOption(args, 'report'));
  if (samePath(workspaceRoot, reportPath) || isWithin(workspaceRoot, reportPath)) throw new Error('--report must be outside the workspace root so the report is not treated as a workspace artifact');
  const planPath = path.resolve(option(args, 'plan') ?? path.join(path.dirname(reportPath), 'CLEANUP_PLAN.json'));
  if (samePath(workspaceRoot, planPath) || isWithin(workspaceRoot, planPath)) throw new Error('--plan must be outside the workspace root');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.mkdir(path.dirname(planPath), { recursive: true });
  const plan = await buildPlan(workspaceRoot);
  await atomicWrite(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  await atomicWrite(reportPath, renderInstructions(plan));
  const planSha = await sha256File(planPath);
  console.log(`Plan: ${planPath}`);
  console.log(`Instructions: ${reportPath}`);
  console.log(`Plan SHA-256: ${planSha}`);
  console.log(`Candidates: ${plan.candidates.length}; Blocked: ${plan.candidates.filter((candidate) => candidate.blocked).length}`);
  console.log('No files were moved or deleted. Review and approve exact candidates before archiving.');
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exitCode = 1;
});
