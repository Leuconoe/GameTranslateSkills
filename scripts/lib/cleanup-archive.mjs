import crypto from 'node:crypto';
import { constants as fsConstants, createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function sha256Text(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export async function sha256File(target) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(target);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function lstatSafe(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function atomicWrite(target, content) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `tmp-cleanup-write-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  await fs.writeFile(temp, content, 'utf8');
  try {
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

function archiveId(cleanupKind, generatedAt, planSha256) {
  const stamp = String(generatedAt ?? new Date().toISOString()).replace(/[^0-9]/g, '').slice(0, 14);
  return `${cleanupKind}-${stamp || 'undated'}-${planSha256.slice(0, 12)}`;
}

function markdownCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

async function assertPlainDirectory(target, label) {
  const existing = await lstatSafe(target);
  if (existing && (existing.isSymbolicLink() || !existing.isDirectory())) {
    throw new Error(`${label} must be a real directory, not a link or file: ${target}`);
  }
  if (!existing) await fs.mkdir(target, { recursive: true });
  const created = await fs.lstat(target);
  if (created.isSymbolicLink() || !created.isDirectory()) throw new Error(`${label} is not a real directory: ${target}`);
  const real = await fs.realpath(target);
  if (!samePath(real, target)) throw new Error(`${label} resolves through a link or reparse point: ${target} -> ${real}`);
}

async function copyThenRemove(source, destination, expectedSha256, stats) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  if (await lstatSafe(destination)) throw new Error(`Archive destination already exists: ${destination}`);
  const temp = path.join(path.dirname(destination), `tmp-archive-copy-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  try {
    await fs.copyFile(source, temp, fsConstants.COPYFILE_EXCL);
    const copiedSha256 = await sha256File(temp);
    if (copiedSha256 !== expectedSha256) throw new Error(`Archive copy hash mismatch for ${source}`);
    await fs.rename(temp, destination);
    await fs.chmod(destination, stats.mode).catch(() => {});
    await fs.utimes(destination, stats.atime, stats.mtime).catch(() => {});
    const archivedSha256 = await sha256File(destination);
    if (archivedSha256 !== expectedSha256) throw new Error(`Final archive hash mismatch for ${source}`);
    await fs.unlink(source);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

export async function archiveApprovedFiles({ cleanupKind, sourceRoot, planPath, planSha256, generatedAt, archiveBase, candidates }) {
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const resolvedArchiveBase = path.resolve(archiveBase);
  if (!Array.isArray(candidates) || candidates.length === 0) throw new Error('No approved exact cleanup candidates to archive');
  await assertPlainDirectory(resolvedArchiveBase, 'Archive root');

  const transactionRoot = path.join(resolvedArchiveBase, archiveId(cleanupKind, generatedAt, planSha256));
  if (await lstatSafe(transactionRoot)) throw new Error(`Archive transaction already exists: ${transactionRoot}`);
  const filesRoot = path.join(transactionRoot, 'files');
  await fs.mkdir(filesRoot, { recursive: true });

  const seen = new Set();
  const items = [];
  for (const candidate of candidates) {
    if (candidate.kind !== 'file') throw new Error(`Only exact files may be archived: ${candidate.path}`);
    const source = path.resolve(resolvedSourceRoot, candidate.path);
    if (!isWithin(resolvedSourceRoot, source)) throw new Error(`Archive candidate escaped source root: ${candidate.path}`);
    if (samePath(source, resolvedArchiveBase) || isWithin(resolvedArchiveBase, source)) {
      throw new Error(`Archive candidate is already inside the archive root: ${candidate.path}`);
    }
    const key = process.platform === 'win32' ? source.toLowerCase() : source;
    if (seen.has(key)) throw new Error(`Duplicate archive candidate: ${candidate.path}`);
    seen.add(key);
    const stats = await lstatSafe(source);
    if (!stats || stats.isSymbolicLink() || !stats.isFile()) throw new Error(`Archive candidate is missing, linked, or not a file: ${candidate.path}`);
    const archivePath = path.resolve(filesRoot, candidate.path);
    if (!isWithin(filesRoot, archivePath)) throw new Error(`Archive destination escaped transaction root: ${candidate.path}`);
    items.push({
      original_path: candidate.path,
      archive_path: path.relative(transactionRoot, archivePath),
      kind: 'file',
      size: stats.size,
      mode: stats.mode,
      mtime: stats.mtime.toISOString(),
      sha256: await sha256File(source),
      status: 'pending',
    });
  }

  const manifestPath = path.join(transactionRoot, 'ARCHIVE_MANIFEST.json');
  const manifest = {
    schema_version: 1,
    kind: `${cleanupKind}-archive`,
    status: 'archiving',
    created_at: new Date().toISOString(),
    completed_at: null,
    source_root: resolvedSourceRoot,
    archive_root: transactionRoot,
    plan_path: path.resolve(planPath),
    plan_sha256: planSha256,
    items,
  };
  await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  for (const item of manifest.items) {
    const source = path.resolve(resolvedSourceRoot, item.original_path);
    const destination = path.resolve(transactionRoot, item.archive_path);
    try {
      const stats = await fs.lstat(source);
      const currentSha256 = await sha256File(source);
      if (stats.size !== item.size || currentSha256 !== item.sha256) {
        throw new Error(`Candidate changed after approval: ${item.original_path}`);
      }
      await copyThenRemove(source, destination, item.sha256, stats);
      item.status = 'archived';
      item.archived_at = new Date().toISOString();
    } catch (error) {
      item.status = 'blocked';
      item.error = error.message;
      manifest.status = 'blocked';
      await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      throw new Error(`Archive transaction stopped at ${item.original_path}: ${error.message}`);
    }
    await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  manifest.status = 'archived';
  manifest.completed_at = new Date().toISOString();
  await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    manifest,
    manifestPath,
    manifestSha256: await sha256File(manifestPath),
    transactionRoot,
  };
}

async function readArchiveManifest({ cleanupKind, sourceRoot, manifestPath, expectedSha256 }) {
  const resolvedManifestPath = path.resolve(manifestPath);
  const raw = await fs.readFile(resolvedManifestPath, 'utf8');
  const actualSha256 = sha256Text(raw);
  if (expectedSha256 && actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(`Archive manifest SHA-256 mismatch: expected ${expectedSha256}, actual ${actualSha256}`);
  }
  const manifest = JSON.parse(raw);
  if (path.basename(resolvedManifestPath) !== 'ARCHIVE_MANIFEST.json') throw new Error('Archive manifest must use the canonical filename ARCHIVE_MANIFEST.json');
  if (manifest.kind !== `${cleanupKind}-archive` || manifest.status !== 'archived') {
    throw new Error('Archive manifest is not a completed cleanup archive');
  }
  if (!samePath(manifest.source_root, sourceRoot)) throw new Error('Archive manifest does not belong to this cleanup root');
  if (!samePath(manifest.archive_root, path.dirname(resolvedManifestPath))) throw new Error('Archive manifest root does not match its location');
  if (!Array.isArray(manifest.items) || manifest.items.length === 0) throw new Error('Archive manifest has no files');
  if (!manifest.items.every((item) => item.status === 'archived')) throw new Error('Archive manifest contains an incomplete item');
  const originalPaths = new Set(manifest.items.map((item) => item.original_path));
  const archivePaths = new Set(manifest.items.map((item) => item.archive_path));
  if (originalPaths.size !== manifest.items.length || archivePaths.size !== manifest.items.length) {
    throw new Error('Archive manifest contains duplicate original or archive paths');
  }
  if (!manifest.items.every((item) => item.kind === 'file' && Number.isSafeInteger(item.size) && item.size >= 0 && /^[0-9a-f]{64}$/.test(item.sha256))) {
    throw new Error('Archive manifest contains invalid file metadata');
  }
  return { manifest, manifestPath: resolvedManifestPath, manifestSha256: actualSha256 };
}

async function inspectArchiveItems(manifest) {
  const sourceRoot = path.resolve(manifest.source_root);
  const archiveRoot = path.resolve(manifest.archive_root);
  const filesRoot = path.join(archiveRoot, 'files');
  const inspections = [];
  for (const item of manifest.items) {
    const original = path.resolve(sourceRoot, item.original_path);
    const archived = path.resolve(archiveRoot, item.archive_path);
    if (!isWithin(sourceRoot, original)) throw new Error(`Archived original path escaped source root: ${item.original_path}`);
    if (!isWithin(filesRoot, archived)) throw new Error(`Archived path escaped files root: ${item.archive_path}`);
    const originalStats = await lstatSafe(original);
    const archiveStats = await lstatSafe(archived);
    const archiveIsRegular = Boolean(archiveStats && !archiveStats.isSymbolicLink() && archiveStats.isFile());
    const currentSha256 = archiveIsRegular ? await sha256File(archived) : null;
    inspections.push({
      ...item,
      original_absent: originalStats === null,
      archive_regular_file: archiveIsRegular,
      size_match: archiveIsRegular && archiveStats.size === item.size,
      hash_match: currentSha256 === item.sha256,
    });
  }
  return inspections;
}

export async function generateArchiveReview({ cleanupKind, sourceRoot, archiveManifestPath, expectedManifestSha256, reviewState, reviewStateLines = [] }) {
  const loaded = await readArchiveManifest({
    cleanupKind,
    sourceRoot: path.resolve(sourceRoot),
    manifestPath: archiveManifestPath,
    expectedSha256: expectedManifestSha256,
  });
  const inspections = await inspectArchiveItems(loaded.manifest);
  const fullReinspectionComplete = inspections.every((item) => item.original_absent && item.archive_regular_file && item.size_match && item.hash_match);
  const stateJson = JSON.stringify(reviewState);
  const stateFingerprint = sha256Text(stateJson);
  const reviewCompletedAt = new Date().toISOString();
  const reviewReportPath = path.join(loaded.manifest.archive_root, 'CLEANUP_ARCHIVE_REVIEW.md');
  const deletePlanPath = path.join(loaded.manifest.archive_root, 'DELETE_PLAN.json');
  const totalBytes = inspections.reduce((sum, item) => sum + item.size, 0);
  const lines = [
    '# Cleanup archive review',
    '',
    `- Cleanup kind: \`${cleanupKind}\``,
    `- Source root: \`${path.resolve(sourceRoot)}\``,
    `- Archive root: \`${loaded.manifest.archive_root}\``,
    `- Original cleanup plan SHA-256: \`${loaded.manifest.plan_sha256}\``,
    `- Archive manifest SHA-256: \`${loaded.manifestSha256}\``,
    `- Full reinspection completed: \`${fullReinspectionComplete}\``,
    `- Source reinspection fingerprint: \`${stateFingerprint}\``,
    `- Archived files: ${inspections.length} (${totalBytes} bytes)`,
    '- Files permanently deleted in this stage: 0',
    '',
    '## Archived file verification',
    '',
    '| Original path | Archive path | Bytes | SHA-256 | Original absent | Archive verified |',
    '|---|---|---:|---|---|---|',
  ];
  for (const item of inspections) {
    lines.push(`| \`${markdownCell(item.original_path)}\` | \`${markdownCell(item.archive_path)}\` | ${item.size} | \`${item.sha256}\` | ${item.original_absent ? 'yes' : 'no'} | ${item.archive_regular_file && item.size_match && item.hash_match ? 'yes' : 'no'} |`);
  }
  lines.push('', '## Full cleanup-scope reinspection', '', ...reviewStateLines, '', '## User decision gate', '',
    '- 이 보고서를 사용자에게 상세히 전달한 뒤 현재 작업을 종료한다.',
    '- 같은 사용자 요청/turn에서 아카이브와 영구 삭제를 연속 실행하지 않는다.',
    '- 사용자가 이후 별도 요청으로 영구 삭제를 명시적으로 승인한 경우에만 `DELETE_PLAN.json`의 `review_reported_to_user`와 `user_delete_approval`을 `true`로 바꾼다.',
    '- 모든 파일을 다시 확인하고 각 exact 항목의 `approved`를 개별적으로 `true`로 바꾼 뒤 현재 delete-plan SHA-256과 `--user-confirmed-delete`를 사용한다.',
    '- 원본 위치 복원이 필요하면 영구 삭제를 승인하지 말고 archive path의 파일을 original path로 되돌린 뒤 해시를 확인한다.',
    '');
  await atomicWrite(reviewReportPath, `${lines.join('\n')}\n`);
  const reviewReportSha256 = await sha256File(reviewReportPath);
  const deletePlan = {
    schema_version: 1,
    kind: `${cleanupKind}-delete-plan`,
    status: fullReinspectionComplete ? 'awaiting-user-approval' : 'blocked',
    generated_at: reviewCompletedAt,
    source_root: path.resolve(sourceRoot),
    archive_root: loaded.manifest.archive_root,
    archive_manifest: loaded.manifestPath,
    archive_manifest_sha256: loaded.manifestSha256,
    review_report: reviewReportPath,
    review_report_sha256: reviewReportSha256,
    source_reinspection_fingerprint: stateFingerprint,
    full_reinspection_complete: fullReinspectionComplete,
    review_reported_to_user: false,
    user_delete_approval: false,
    candidates: inspections.map((item) => ({
      original_path: item.original_path,
      archive_path: item.archive_path,
      size: item.size,
      sha256: item.sha256,
      approved: false,
    })),
  };
  await atomicWrite(deletePlanPath, `${JSON.stringify(deletePlan, null, 2)}\n`);
  return {
    fullReinspectionComplete,
    reviewReportPath,
    reviewReportSha256,
    deletePlanPath,
    deletePlanSha256: await sha256File(deletePlanPath),
    stateFingerprint,
    inspections,
  };
}

function compareDeleteCandidates(deletePlan, manifest) {
  if (!Array.isArray(deletePlan.candidates) || deletePlan.candidates.length !== manifest.items.length) {
    throw new Error('Delete plan candidate set does not exactly match the archive manifest');
  }
  if (new Set(deletePlan.candidates.map((candidate) => candidate.original_path)).size !== deletePlan.candidates.length) {
    throw new Error('Delete plan contains duplicate candidates');
  }
  const archived = new Map(manifest.items.map((item) => [item.original_path, item]));
  for (const candidate of deletePlan.candidates) {
    const item = archived.get(candidate.original_path);
    if (!item || candidate.archive_path !== item.archive_path || candidate.size !== item.size || candidate.sha256 !== item.sha256) {
      throw new Error(`Delete plan candidate differs from archive manifest: ${candidate.original_path}`);
    }
  }
}

export async function purgeArchive({ cleanupKind, sourceRoot, deletePlanPath, expectedDeletePlanSha256, userConfirmedDelete, currentReviewState }) {
  if (!userConfirmedDelete) throw new Error('--purge requires --user-confirmed-delete after a separate explicit user approval');
  const resolvedDeletePlanPath = path.resolve(deletePlanPath);
  const raw = await fs.readFile(resolvedDeletePlanPath, 'utf8');
  const actualDeletePlanSha256 = sha256Text(raw);
  if (actualDeletePlanSha256.toLowerCase() !== expectedDeletePlanSha256.toLowerCase()) {
    throw new Error(`Delete plan SHA-256 mismatch: expected ${expectedDeletePlanSha256}, actual ${actualDeletePlanSha256}`);
  }
  const deletePlan = JSON.parse(raw);
  if (deletePlan.kind !== `${cleanupKind}-delete-plan` || !samePath(deletePlan.source_root, sourceRoot)) {
    throw new Error('Delete plan does not belong to this cleanup root');
  }
  if (deletePlan.status !== 'awaiting-user-approval' || deletePlan.full_reinspection_complete !== true) {
    throw new Error('Delete plan has no completed full reinspection');
  }
  if (!samePath(resolvedDeletePlanPath, path.join(deletePlan.archive_root, 'DELETE_PLAN.json'))) {
    throw new Error('Delete plan must remain at its canonical archive transaction path');
  }
  if (!samePath(deletePlan.archive_manifest, path.join(deletePlan.archive_root, 'ARCHIVE_MANIFEST.json'))
    || !samePath(deletePlan.review_report, path.join(deletePlan.archive_root, 'CLEANUP_ARCHIVE_REVIEW.md'))) {
    throw new Error('Delete plan references non-canonical archive evidence paths');
  }
  if (deletePlan.review_reported_to_user !== true || deletePlan.user_delete_approval !== true) {
    throw new Error('Detailed review reporting and explicit user deletion approval are not both recorded');
  }
  if (!deletePlan.candidates.every((candidate) => candidate.approved === true)) {
    throw new Error('Every archived file must be individually approved before this archive transaction can be purged');
  }

  const loaded = await readArchiveManifest({
    cleanupKind,
    sourceRoot: path.resolve(sourceRoot),
    manifestPath: deletePlan.archive_manifest,
    expectedSha256: deletePlan.archive_manifest_sha256,
  });
  if (!samePath(deletePlan.archive_root, loaded.manifest.archive_root)) throw new Error('Delete plan archive root mismatch');
  const reportSha256 = await sha256File(deletePlan.review_report);
  if (reportSha256 !== deletePlan.review_report_sha256) throw new Error('Detailed archive review report changed after review');
  compareDeleteCandidates(deletePlan, loaded.manifest);
  const inspections = await inspectArchiveItems(loaded.manifest);
  if (!inspections.every((item) => item.original_absent && item.archive_regular_file && item.size_match && item.hash_match)) {
    throw new Error('Archive contents or original paths changed; run a new full archive review and report it again');
  }
  const currentFingerprint = sha256Text(JSON.stringify(currentReviewState));
  if (currentFingerprint !== deletePlan.source_reinspection_fingerprint) {
    throw new Error('Cleanup scope changed after the detailed report; run --review-archive and obtain new user approval');
  }

  const receiptPath = path.join(loaded.manifest.archive_root, 'PURGE_RECEIPT.json');
  if (await lstatSafe(receiptPath)) throw new Error(`Purge receipt already exists; inspect the prior purge before retrying: ${receiptPath}`);
  const receipt = {
    schema_version: 1,
    kind: `${cleanupKind}-purge-receipt`,
    status: 'purging',
    started_at: new Date().toISOString(),
    completed_at: null,
    source_root: path.resolve(sourceRoot),
    archive_root: loaded.manifest.archive_root,
    delete_plan: resolvedDeletePlanPath,
    delete_plan_sha256: actualDeletePlanSha256,
    review_report_sha256: reportSha256,
    items: deletePlan.candidates.map((candidate) => ({ ...candidate, status: 'pending' })),
  };
  await atomicWrite(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  for (const item of receipt.items) {
    const target = path.resolve(loaded.manifest.archive_root, item.archive_path);
    try {
      await fs.unlink(target);
      item.status = 'purged';
      item.purged_at = new Date().toISOString();
    } catch (error) {
      item.status = 'blocked';
      item.error = error.message;
      receipt.status = 'blocked';
      await atomicWrite(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
      throw new Error(`Purge stopped at ${item.archive_path}: ${error.message}`);
    }
    await atomicWrite(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  receipt.status = 'complete';
  receipt.completed_at = new Date().toISOString();
  await atomicWrite(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return {
    receiptPath,
    receiptSha256: await sha256File(receiptPath),
    purged: receipt.items.length,
  };
}
