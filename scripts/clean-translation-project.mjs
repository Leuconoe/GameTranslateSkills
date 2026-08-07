#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';

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

function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

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

async function lstatSafe(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function collectFiles(root, current = root, output = []) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(current, entry.name);
    const stats = await fs.lstat(target);
    if (stats.isSymbolicLink()) {
      output.push({ path: target, kind: 'link' });
      continue;
    }
    if (stats.isDirectory()) {
      output.push({ path: target, kind: 'directory' });
      await collectFiles(root, target, output);
    } else {
      output.push({ path: target, kind: 'file' });
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
  const files = (await collectFiles(projectRoot)).filter((entry) => entry.kind === 'file' && /(?:MANIFEST|REPORT|LOG|PROJECT|HANDOFF|REFERENCE|STYLE)/i.test(entry.path));
  for (const file of files) {
    const text = await readText(file.path);
    for (const reference of extractPathReferences(text, projectRoot)) references.add(reference);
  }
  return references;
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
  const manifestReferences = await readManifestReferences(projectRoot);
  const sessionPath = path.join(projectRoot, '50_test', 'eden', 'SESSION.json');
  const session = await readJson(sessionPath);
  const artifactManifest = await readArtifactManifest(projectRoot);
  const protectedPaths = new Set([...handoff.evidence, ...manifestReferences]);
  for (const relative of canonicalFiles) protectedPaths.add(path.join(projectRoot, relative));

  const activeSession = session && ['active', 'pending'].includes(session.status);
  const remoteCloseVerified = Boolean(session && session.status === 'closed' && session.last_session_id
    && session.remote_close_session_id === session.last_session_id);
  const allEntries = await collectFiles(projectRoot);
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
    candidates.push({
      path: relativePath,
      kind: entry.kind,
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
    schema_version: 2,
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
    '이 문서는 삭제 명령이 아니다. 각 후보의 근거·참조·세션 소유권을 확인한 뒤 exact 경로만 `approved=true`로 표시한다.',
    '',
    '| 승인 | 위험 | 경로 | 이유 | 차단/확인 근거 |',
    '|---|---|---|---|---|',
  ];
  for (const candidate of plan.candidates) {
    lines.push(`| ${candidate.approved ? 'yes' : 'no'} | ${candidate.risk} | \`${candidate.path}\` | ${candidate.reason} | ${candidate.blocked ? candidate.evidence : 'review Handoff, manifest, hash, and active process before approval'} |`);
  }
  lines.push('', '적용 전 확인:', '', '- [ ] remote 세션 close와 local `SESSION.json` 상태가 일치함', '- [ ] `ARTIFACT_MANIFEST.tsv`의 key/path가 유일함', '- [ ] Handoff·PROJECT·WORK_LOG·보고서·릴리스 증거의 참조가 보존됨', '- [ ] 계획에 없는 경로와 link/reparse point가 없음', '- [ ] 계획 파일의 현재 SHA-256을 기록함', '');
  return `${lines.join('\n')}\n`;
}

async function atomicWrite(target, content) {
  const temp = path.join(path.dirname(target), `tmp-cleanup-${process.pid}-${path.basename(target)}`);
  await fs.writeFile(temp, content, 'utf8');
  try {
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

async function applyPlan(planPath, projectRoot, expectedSha) {
  const raw = await fs.readFile(planPath, 'utf8');
  const actualSha = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  if (expectedSha && actualSha.toLowerCase() !== expectedSha.toLowerCase()) throw new Error(`Cleanup plan SHA-256 mismatch: expected ${expectedSha}, actual ${actualSha}`);
  const plan = JSON.parse(raw);
  if (plan.kind !== 'project-cleanup' || !samePath(plan.project_root, projectRoot)) throw new Error('Cleanup plan does not belong to this project');
  const current = await buildPlan(projectRoot);
  const currentBlocked = new Map(current.candidates.map((candidate) => [candidate.path, candidate.blocked]));
  const approved = plan.candidates.filter((candidate) => candidate.approved === true);
  if (approved.length === 0) throw new Error('No approved exact cleanup candidates in plan');
  for (const candidate of approved) {
    if (currentBlocked.get(candidate.path) !== false) throw new Error(`Candidate is no longer safe or is blocked: ${candidate.path}`);
    const target = path.resolve(projectRoot, candidate.path);
    if (!isWithin(projectRoot, target)) throw new Error(`Cleanup candidate escaped project root: ${candidate.path}`);
    const stats = await lstatSafe(target);
    if (!stats || stats.isSymbolicLink()) throw new Error(`Cleanup candidate is missing or a link: ${candidate.path}`);
    if (stats.isDirectory()) throw new Error(`Directory cleanup requires child-level allowlist; refusing: ${candidate.path}`);
  }
  for (const candidate of approved) {
    await fs.rm(path.resolve(projectRoot, candidate.path), { force: false });
    console.log(`REMOVED\t${candidate.path}`);
  }
  console.log(`Plan SHA-256: ${actualSha}`);
  console.log(`Removed: ${approved.length}`);
}

function usage() {
  console.log(`Usage: npm run project:cleanup -- --project-root <title/_work/<16-hex-title-id>> [options]

Default: generate a Handoff-based cleanup plan; never delete.

Options:
  --project-root <path>  Exact project root under a title's _work folder
  --report <path>        Instruction markdown path (default: 90_tools/CLEANUP_INSTRUCTIONS.md)
  --plan <path>          Plan JSON path for --apply (default: sibling CLEANUP_PLAN.json)
  --apply                Apply only candidates with approved=true in --plan
  --plan-sha256 <sha256> Required with --apply; SHA-256 of the reviewed plan
  --help                 Show this help`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flag(args, 'help')) return usage();
  const projectRoot = path.resolve(requiredOption(args, 'project-root'));
  const workRoot = path.dirname(projectRoot);
  if (path.basename(workRoot) !== '_work' || !titleIdPattern.test(path.basename(projectRoot))) throw new Error('--project-root must be an exact title project under <title>/_work/<16-hex-title-id>');
  if (!(await isDirectory(projectRoot))) throw new Error(`Project root does not exist: ${projectRoot}`);
  const defaultReport = path.join(projectRoot, '90_tools', 'CLEANUP_INSTRUCTIONS.md');
  const reportPath = path.resolve(option(args, 'report') ?? defaultReport);
  const defaultPlan = path.join(path.dirname(reportPath), 'CLEANUP_PLAN.json');
  const planPath = path.resolve(option(args, 'plan') ?? defaultPlan);
  if (flag(args, 'apply')) {
    if (!option(args, 'plan')) throw new Error('--apply requires the reviewed --plan path');
    const expectedSha = requiredOption(args, 'plan-sha256');
    await applyPlan(planPath, projectRoot, expectedSha);
    return;
  }
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.mkdir(path.dirname(planPath), { recursive: true });
  const plan = await buildPlan(projectRoot);
  await atomicWrite(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  await atomicWrite(reportPath, renderInstructions(plan));
  const planSha = crypto.createHash('sha256').update(await fs.readFile(planPath)).digest('hex');
  console.log(`Plan: ${planPath}`);
  console.log(`Instructions: ${reportPath}`);
  console.log(`Plan SHA-256: ${planSha}`);
  console.log(`Candidates: ${plan.candidates.length}; Blocked: ${plan.candidates.filter((candidate) => candidate.blocked).length}`);
  console.log('No files were removed. Review Handoff-based instructions and approve exact candidates before applying.');
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exitCode = 1;
});
