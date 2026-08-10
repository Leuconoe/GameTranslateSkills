#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';
import {
  archiveApprovedFiles,
  atomicWrite,
  generateArchiveReview,
  isWithin,
  lstatSafe,
  samePath,
  sha256File,
  sha256Text,
  trashArchive,
} from './lib/cleanup-archive.mjs';

const titleIdPattern = /^[0-9A-Fa-f]{16}$/;
const canonicalFiles = new Set([
  'PROJECT.md',
  'WORK_LOG.md',
  'HANDOFF.md',
  path.join('00_source', 'SOURCE_INVENTORY.tsv'),
  path.join('20_reference', 'REFERENCE_INDEX.tsv'),
  path.join('30_translation', 'text', 'translation_manifest.tsv'),
  path.join('30_translation', 'text', 'glossary.tsv'),
  path.join('30_translation', 'text', 'STYLE.md'),
  path.join('40_build', 'BUILD_MANIFEST.tsv'),
  path.join('50_test', 'TEST_LOG.md'),
  path.join('50_test', 'eden', 'SESSION.json'),
  path.join('50_test', 'eden', 'ARTIFACT_MANIFEST.tsv'),
  path.join('90_tools', 'CLEANUP_PLAN.json'),
  path.join('90_tools', 'CLEANUP_INSTRUCTIONS.md'),
]);
const cleanupArchiveRelative = path.join('90_tools', 'cleanup-archive');

function isTemporaryName(name) {
  return /^tmp[-_.].+/i.test(name) || /\.tmp(?:$|[.])/i.test(name);
}

function isDuplicateLikeName(name) {
  return /(?:^|[-_.])(session|run)[-_.]/i.test(name)
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
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Cannot parse ${target}: ${error.message}`);
  }
}

async function collectFiles(root, current = root, output = []) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(current, entry.name);
    const archiveRoot = path.join(root, cleanupArchiveRelative);
    if (samePath(target, archiveRoot) || isWithin(archiveRoot, target)) continue;
    const stats = await fs.lstat(target);
    if (stats.isSymbolicLink()) {
      output.push({ path: target, kind: 'link' });
      continue;
    }
    if (stats.isDirectory()) {
      output.push({ path: target, kind: 'directory' });
      await collectFiles(root, target, output);
    } else {
      output.push({ path: target, kind: 'file', size: stats.size });
    }
  }
  return output;
}

function extractPathReferences(text, projectRoot) {
  const references = new Set();
  const pattern = /(?:[A-Za-z]:[\\/][^\s|)>'"`]+|[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+)/g;
  for (const raw of text.match(pattern) ?? []) {
    const cleaned = raw.replace(/[.,;:]+$/g, '').replaceAll('\\', path.sep);
    const absolute = path.isAbsolute(cleaned) ? path.resolve(cleaned) : path.resolve(projectRoot, cleaned);
    if (isWithin(projectRoot, absolute)) references.add(absolute);
  }
  return references;
}

async function readHandoffEvidence(projectRoot) {
  const handoffPath = path.join(projectRoot, 'HANDOFF.md');
  const text = await readText(handoffPath);
  const evidence = extractPathReferences(text, projectRoot);
  const statuses = { open: 0, applied: 0, rejected: 0, unknown: 0 };
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split('|').map((cell) => cell.trim().toLowerCase());
    const bulletStatus = line.match(/(?:상태|status)\s*:\s*(open|applied|rejected)\b/i)?.[1]?.toLowerCase();
    const status = bulletStatus ?? cells.at(-1);
    if (Object.hasOwn(statuses, status)) statuses[status] += 1;
    else if (cells.length >= 4 && !line.startsWith('#')) statuses.unknown += 1;
  }
  return { path: handoffPath, exists: Boolean(text), evidence, statuses };
}

async function readManifestReferences(projectRoot) {
  const references = new Set();
  const documents = [];
  const files = (await collectFiles(projectRoot)).filter((entry) => entry.kind === 'file' && /(?:MANIFEST|REPORT|LOG|PROJECT|HANDOFF|REFERENCE|STYLE)/i.test(entry.path));
  for (const file of files) {
    const text = await readText(file.path);
    for (const reference of extractPathReferences(text, projectRoot)) references.add(reference);
    documents.push({
      path: path.relative(projectRoot, file.path),
      sha256: sha256Text(text),
    });
  }
  return { references, documents: documents.sort((left, right) => left.path.localeCompare(right.path)) };
}

function pathProtected(projectRoot, target, protectedPaths) {
  const relative = path.relative(projectRoot, target);
  if (!relative || canonicalFiles.has(relative)) return true;
  for (const anchor of protectedPaths) {
    if (samePath(target, anchor) || isWithin(anchor, target) || isWithin(target, anchor)) return true;
  }
  return false;
}

function candidateReason(relativePath, isEdenEntry) {
  const reasons = [];
  const base = path.basename(relativePath);
  if (isTemporaryName(base)) reasons.push('temporary-name');
  if (isDuplicateLikeName(base)) reasons.push('duplicate-like-name');
  if (isEdenEntry) reasons.push('non-canonical-eden-entry');
  return reasons;
}

async function readArtifactManifest(projectRoot) {
  const manifestPath = path.join(projectRoot, '50_test', 'eden', 'ARTIFACT_MANIFEST.tsv');
  const text = await readText(manifestPath);
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.shift()?.split('\t') ?? [];
  const keyIndex = header.indexOf('artifact_key');
  const pathIndex = header.indexOf('path');
  const keys = new Map();
  const paths = new Map();
  for (const line of lines) {
    const cells = line.split('\t');
    const key = (cells[keyIndex] ?? '').trim();
    const artifactPath = (cells[pathIndex] ?? '').trim();
    if (key) keys.set(key, (keys.get(key) ?? 0) + 1);
    if (artifactPath) paths.set(artifactPath, (paths.get(artifactPath) ?? 0) + 1);
  }
  return { path: manifestPath, duplicateKeys: [...keys].filter(([, count]) => count > 1).map(([key]) => key), duplicatePaths: [...paths].filter(([, count]) => count > 1).map(([artifactPath]) => artifactPath) };
}

async function buildPlan(projectRoot) {
  const handoff = await readHandoffEvidence(projectRoot);
  const manifestReview = await readManifestReferences(projectRoot);
  const sessionPath = path.join(projectRoot, '50_test', 'eden', 'SESSION.json');
  const session = await readJson(sessionPath);
  const artifactManifest = await readArtifactManifest(projectRoot);
  const protectedPaths = new Set([...handoff.evidence, ...manifestReview.references]);
  for (const relative of canonicalFiles) protectedPaths.add(path.join(projectRoot, relative));

  const activeSession = session && ['active', 'pending'].includes(session.status);
  const remoteCloseVerified = Boolean(session && session.status === 'closed' && session.last_session_id
    && session.remote_close_session_id === session.last_session_id);
  const allEntries = await collectFiles(projectRoot);
  const inventory = {
    files: allEntries.filter((entry) => entry.kind === 'file').length,
    directories: allEntries.filter((entry) => entry.kind === 'directory').length,
    links: allEntries.filter((entry) => entry.kind === 'link').length,
    bytes: allEntries.reduce((sum, entry) => sum + (entry.size ?? 0), 0),
  };
  const candidates = [];
  for (const entry of allEntries) {
    const relativePath = path.relative(projectRoot, entry.path);
    if (!relativePath || entry.kind === 'link') continue;
    const isEdenEntry = relativePath.toLowerCase().startsWith(`${path.join('50_test', 'eden')}${path.sep}`)
      && !['SESSION.json', 'ARTIFACT_MANIFEST.tsv'].includes(path.basename(relativePath));
    const reasons = candidateReason(relativePath, isEdenEntry);
    if (reasons.length === 0) continue;
    const protectedByReference = pathProtected(projectRoot, entry.path, [...protectedPaths]);
    const blocked = protectedByReference || activeSession || (isEdenEntry && !remoteCloseVerified) || entry.kind === 'directory';
    const stats = entry.kind === 'file' ? await fs.lstat(entry.path) : null;
    candidates.push({
      path: relativePath,
      kind: entry.kind,
      size: stats?.size ?? null,
      sha256: entry.kind === 'file' ? await sha256File(entry.path) : null,
      reason: reasons.join(', '),
      evidence: protectedByReference
        ? 'Referenced by Handoff, project documentation, or manifest; preserve until references are reconciled.'
        : activeSession
          ? `SESSION.json status=${session.status}; reconcile and close the owned remote session first.`
          : isEdenEntry && !remoteCloseVerified
            ? 'Eden entry has no exact remote-close proof in canonical SESSION.json; reconcile ownership and remote status first.'
          : entry.kind === 'directory'
            ? 'Directory requires a child-level allowlist before removal.'
            : 'Candidate requires explicit review against Handoff and manifest evidence.',
      risk: isEdenEntry ? 'high' : 'medium',
      blocked,
      approved: false,
    });
  }

  if (artifactManifest.duplicateKeys.length || artifactManifest.duplicatePaths.length) {
    candidates.push({
      path: path.relative(projectRoot, artifactManifest.path),
      kind: 'file',
      reason: 'duplicate-artifact-manifest-entry',
      evidence: `duplicate artifact_key=${artifactManifest.duplicateKeys.join(',') || '-'}; duplicate path=${artifactManifest.duplicatePaths.join(',') || '-'}`,
      risk: 'high',
      blocked: true,
      approved: false,
    });
  }

  return {
    schema_version: 3,
    kind: 'project-cleanup',
    generated_at: new Date().toISOString(),
    project_root: path.resolve(projectRoot),
    handoff,
    session: session ? {
      status: session.status ?? null,
      session_id: session.session_id ?? null,
      last_session_id: session.last_session_id ?? null,
      remote_close_session_id: session.remote_close_session_id ?? null,
      session_key: session.session_key ?? null,
    } : null,
    protected_paths: [...protectedPaths].map((target) => path.relative(projectRoot, target)).filter(Boolean).sort(),
    review_inputs: {
      documents: manifestReview.documents,
    },
    inventory,
    candidates: candidates.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

function renderInstructions(plan) {
  const lines = [
    '# Cleanup instructions',
    '',
    `- Project: \`${plan.project_root}\``,
    `- Generated: \`${plan.generated_at}\``,
    `- Handoff: open=${plan.handoff.statuses.open}, applied=${plan.handoff.statuses.applied}, rejected=${plan.handoff.statuses.rejected}, unknown=${plan.handoff.statuses.unknown}`,
    `- Active/pending session: \`${plan.session?.status ?? 'missing'}\``,
    '',
    '이 문서는 삭제 명령이 아니다. 각 후보의 근거·참조·세션 소유권을 확인한 뒤 아카이브로 이동할 exact 경로만 `approved=true`로 표시한다.',
    '',
    '| 승인 | 위험 | 경로 | 바이트 | SHA-256 | 이유 | 차단/확인 근거 |',
    '|---|---|---|---:|---|---|---|',
  ];
  for (const candidate of plan.candidates) {
    lines.push(`| ${candidate.approved ? 'yes' : 'no'} | ${candidate.risk} | \`${candidate.path}\` | ${candidate.size ?? '-'} | ${candidate.sha256 ? `\`${candidate.sha256}\`` : '-'} | ${candidate.reason} | ${candidate.blocked ? candidate.evidence : 'review Handoff, manifest, hash, and active process before approval'} |`);
  }
  lines.push('', '아카이브 적용 전 확인:', '', '- [ ] remote 세션 close와 local `SESSION.json` 상태가 일치함', '- [ ] `ARTIFACT_MANIFEST.tsv`의 key/path가 유일함', '- [ ] Handoff·PROJECT·WORK_LOG·보고서·릴리스 증거의 참조가 보존됨', '- [ ] 계획에 없는 경로와 link/reparse point가 없음', '- [ ] 계획 파일의 현재 SHA-256을 기록함', '', '`--apply`는 승인 파일을 `90_tools/cleanup-archive/`로 이동하고 전수 재검토 보고서와 별도 휴지통 이동 계획을 만든다. 이 단계에서는 영구 삭제하거나 휴지통으로 보내지 않는다.', '');
  return `${lines.join('\n')}\n`;
}

function reviewState(plan) {
  return {
    handoff: {
      exists: plan.handoff.exists,
      statuses: plan.handoff.statuses,
    },
    session: plan.session,
    protected_paths: plan.protected_paths,
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
    `- Handoff file present: \`${state.handoff.exists}\``,
    `- Handoff states: open=${state.handoff.statuses.open}, applied=${state.handoff.statuses.applied}, rejected=${state.handoff.statuses.rejected}, unknown=${state.handoff.statuses.unknown}`,
    `- Session status: \`${state.session?.status ?? 'missing'}\``,
    `- Protected paths rechecked: ${state.protected_paths.length}`,
    `- Control documents rehashed: ${state.review_inputs.documents.length}`,
    `- Full tree inventory: files=${state.inventory.files}, directories=${state.inventory.directories}, links=${state.inventory.links}, bytes=${state.inventory.bytes}`,
    `- Remaining cleanup candidates: ${state.candidates.length}`,
    `- Remaining blocked candidates: ${state.candidates.filter((candidate) => candidate.blocked).length}`,
  ];
  lines.push('', '### Rehashed control documents', '', '| Path | SHA-256 |', '|---|---|');
  if (state.review_inputs.documents.length === 0) lines.push('| 없음 | - |');
  else for (const document of state.review_inputs.documents) lines.push(`| \`${document.path}\` | \`${document.sha256}\` |`);
  lines.push('', '### Protected paths', '');
  if (state.protected_paths.length === 0) lines.push('- 없음');
  else for (const protectedPath of state.protected_paths) lines.push(`- \`${protectedPath}\``);
  lines.push('', '### Remaining cleanup candidates', '', '| Blocked | Risk | Path | Reason | Evidence |', '|---|---|---|---|---|');
  if (state.candidates.length === 0) lines.push('| - | - | 없음 | - | - |');
  else for (const candidate of state.candidates) lines.push(`| ${candidate.blocked ? 'yes' : 'no'} | ${candidate.risk} | \`${candidate.path}\` | ${candidate.reason} | ${candidate.evidence} |`);
  return lines;
}

async function generateReview(projectRoot, archiveManifestPath, expectedManifestSha256) {
  const currentState = reviewState(await buildPlan(projectRoot));
  return generateArchiveReview({
    cleanupKind: 'project-cleanup',
    sourceRoot: projectRoot,
    archiveManifestPath,
    expectedManifestSha256,
    reviewState: currentState,
    reviewStateLines: renderReviewState(currentState),
  });
}

async function archivePlan(planPath, projectRoot, expectedSha) {
  const raw = await fs.readFile(planPath, 'utf8');
  const actualSha = sha256Text(raw);
  if (expectedSha && actualSha.toLowerCase() !== expectedSha.toLowerCase()) throw new Error(`Cleanup plan SHA-256 mismatch: expected ${expectedSha}, actual ${actualSha}`);
  const plan = JSON.parse(raw);
  if (plan.kind !== 'project-cleanup' || !samePath(plan.project_root, projectRoot)) throw new Error('Cleanup plan does not belong to this project');
  const current = await buildPlan(projectRoot);
  const currentByPath = new Map(current.candidates.map((candidate) => [candidate.path, candidate]));
  const approved = plan.candidates.filter((candidate) => candidate.approved === true);
  if (approved.length === 0) throw new Error('No approved exact cleanup candidates to archive in plan');
  for (const candidate of approved) {
    const currentCandidate = currentByPath.get(candidate.path);
    if (!currentCandidate || currentCandidate.blocked || currentCandidate.kind !== candidate.kind
      || currentCandidate.size !== candidate.size || currentCandidate.sha256 !== candidate.sha256) {
      throw new Error(`Candidate changed, is no longer safe, or is blocked: ${candidate.path}`);
    }
    const target = path.resolve(projectRoot, candidate.path);
    if (!isWithin(projectRoot, target)) throw new Error(`Cleanup candidate escaped project root: ${candidate.path}`);
    const stats = await lstatSafe(target);
    if (!stats || stats.isSymbolicLink()) throw new Error(`Cleanup candidate is missing or a link: ${candidate.path}`);
    if (!stats.isFile()) throw new Error(`Archive requires a child-level file allowlist; refusing: ${candidate.path}`);
  }
  const archived = await archiveApprovedFiles({
    cleanupKind: 'project-cleanup',
    sourceRoot: projectRoot,
    planPath,
    planSha256: actualSha,
    generatedAt: plan.generated_at,
    archiveBase: path.join(projectRoot, cleanupArchiveRelative),
    candidates: approved,
  });
  const review = await generateReview(projectRoot, archived.manifestPath, archived.manifestSha256);
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
  console.log(`Usage: npm run project:cleanup -- --project-root <title/_work/<16-hex-title-id>> [options]

Default: generate a Handoff-based cleanup plan; never move or delete.

Options:
  --project-root <path>  Exact project root under a title's _work folder
  --report <path>        Instruction markdown path (default: 90_tools/CLEANUP_INSTRUCTIONS.md)
  --plan <path>          Reviewed plan JSON path for --apply
  --apply                Move approved=true files into the project-local cleanup archive
  --plan-sha256 <sha256> Required with --apply; SHA-256 of the reviewed plan
  --review-archive       Re-run the full post-archive review and reset Trash approvals
  --archive-manifest <path>
                        Completed ARCHIVE_MANIFEST.json for --review-archive
  --archive-manifest-sha256 <sha256>
                        Required with --review-archive
  --trash                Move a fully reviewed and separately approved archive transaction to the OS Trash
  --trash-plan <path>    TRASH_PLAN.json with report/user/item approvals recorded
  --trash-plan-sha256 <sha256>
                        Required with --trash; current reviewed trash-plan hash
  --user-confirmed-trash Required with --trash after a separate explicit user request
  --purge                Legacy alias for --trash; never permanently deletes
  --delete-plan <path>   Legacy alias accepting a prior DELETE_PLAN.json
  --delete-plan-sha256 <sha256>
                        Legacy alias for --trash-plan-sha256
  --user-confirmed-delete
                        Legacy alias for --user-confirmed-trash; still sends only to Trash
  --help                 Show this help`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flag(args, 'help')) return usage();
  const projectRoot = path.resolve(requiredOption(args, 'project-root'));
  const workRoot = path.dirname(projectRoot);
  if (path.basename(workRoot) !== '_work' || !titleIdPattern.test(path.basename(projectRoot))) throw new Error('--project-root must be an exact title project under <title>/_work/<16-hex-title-id>');
  if (!(await isDirectory(projectRoot))) throw new Error(`Project root does not exist: ${projectRoot}`);
  const primaryTrash = flag(args, 'trash');
  const legacyPurge = flag(args, 'purge');
  if (primaryTrash && legacyPurge) throw new Error('Use only --trash or legacy --purge, not both');
  const wantsTrash = primaryTrash || legacyPurge;
  const modeCount = [flag(args, 'apply'), flag(args, 'review-archive'), wantsTrash].filter(Boolean).length;
  if (modeCount > 1) throw new Error('Choose exactly one of --apply, --review-archive, or --trash');
  if (flag(args, 'review-archive')) {
    const review = await generateReview(
      projectRoot,
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
    const currentState = reviewState(await buildPlan(projectRoot));
    const result = await trashArchive({
      cleanupKind: 'project-cleanup',
      sourceRoot: projectRoot,
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
  const defaultReport = path.join(projectRoot, '90_tools', 'CLEANUP_INSTRUCTIONS.md');
  const reportPath = path.resolve(option(args, 'report') ?? defaultReport);
  const defaultPlan = path.join(path.dirname(reportPath), 'CLEANUP_PLAN.json');
  const planPath = path.resolve(option(args, 'plan') ?? defaultPlan);
  if (flag(args, 'apply')) {
    if (!option(args, 'plan')) throw new Error('--apply requires the reviewed --plan path');
    const expectedSha = requiredOption(args, 'plan-sha256');
    await archivePlan(planPath, projectRoot, expectedSha);
    return;
  }
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.mkdir(path.dirname(planPath), { recursive: true });
  const plan = await buildPlan(projectRoot);
  await atomicWrite(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  await atomicWrite(reportPath, renderInstructions(plan));
  const planSha = await sha256File(planPath);
  console.log(`Plan: ${planPath}`);
  console.log(`Instructions: ${reportPath}`);
  console.log(`Plan SHA-256: ${planSha}`);
  console.log(`Candidates: ${plan.candidates.length}; Blocked: ${plan.candidates.filter((candidate) => candidate.blocked).length}`);
  console.log('No files were moved or deleted. Review Handoff-based instructions and approve exact candidates before archiving.');
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exitCode = 1;
});
