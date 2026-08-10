import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants as fsConstants, createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

async function assertPlainFile(target, label) {
  const stats = await lstatSafe(target);
  if (!stats || stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be an existing regular file, not a link: ${target}`);
  }
  const real = await fs.realpath(target);
  if (!samePath(real, target)) throw new Error(`${label} resolves through a link or reparse point: ${target} -> ${real}`);
}

function commandError(label, error) {
  const detail = String(error.stderr ?? error.stdout ?? error.message ?? error).trim();
  return new Error(`${label} failed; no permanent-delete fallback was attempted${detail ? `: ${detail}` : ''}`);
}

async function moveToWindowsRecycleBin(target) {
  if (target.startsWith('\\\\')) throw new Error(`Windows Recycle Bin is not guaranteed for UNC paths; refusing: ${target}`);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName Microsoft.VisualBasic',
    "$target = [Environment]::GetEnvironmentVariable('GT_CLEANUP_TRASH_TARGET')",
    "if ([string]::IsNullOrWhiteSpace($target)) { throw 'Missing recycle target' }",
    '$item = Get-Item -LiteralPath $target -Force',
    "if ($item.PSIsContainer) { throw 'Recycle target is not a file' }",
    "if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Recycle target is a reparse point' }",
    '$drive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($item.FullName))',
    "if ($drive.DriveType -ne [System.IO.DriveType]::Fixed) { throw ('Recycle target is not on a fixed local drive: ' + $drive.DriveType) }",
    '[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(',
    '  $item.FullName,',
    '  [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,',
    '  [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin,',
    '  [Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException',
    ')',
    "if ([System.IO.File]::Exists($item.FullName)) { throw 'File still exists after Recycle Bin operation' }",
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  try {
    await execFileAsync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      encoded,
    ], {
      env: { ...process.env, GT_CLEANUP_TRASH_TARGET: target },
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    throw commandError('Windows Recycle Bin operation', error);
  }
  return { backend: 'windows-recycle-bin' };
}

async function moveToMacTrash(target) {
  const script = [
    'on run argv',
    '  tell application "Finder"',
    '    delete POSIX file (item 1 of argv)',
    '  end tell',
    'end run',
  ].join('\n');
  try {
    await execFileAsync('/usr/bin/osascript', ['-e', script, target], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    throw commandError('macOS Trash operation', error);
  }
  return { backend: 'macos-finder-trash' };
}

async function moveToGioTrash(target) {
  try {
    await execFileAsync('gio', ['trash', target], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    throw commandError('GIO Trash operation', error);
  }
  return { backend: 'gio-trash' };
}

async function moveToTestTrash(target, { cleanupKind, archiveRoot, archivePath }) {
  const configuredRoot = process.env.GT_CLEANUP_TEST_TRASH_ROOT;
  if (process.env.NODE_ENV !== 'test' || !configuredRoot) {
    throw new Error('The isolated trash backend is available only when NODE_ENV=test and GT_CLEANUP_TEST_TRASH_ROOT is set');
  }
  const testTrashRoot = path.resolve(configuredRoot);
  if (samePath(testTrashRoot, archiveRoot) || isWithin(archiveRoot, testTrashRoot)) {
    throw new Error('Isolated test trash must be outside the cleanup archive transaction');
  }
  await assertPlainDirectory(testTrashRoot, 'Isolated test trash root');
  const destination = path.resolve(testTrashRoot, cleanupKind, path.basename(archiveRoot), archivePath);
  if (!isWithin(testTrashRoot, destination)) throw new Error(`Isolated test trash path escaped its root: ${archivePath}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  if (await lstatSafe(destination)) throw new Error(`Isolated test trash destination already exists: ${destination}`);
  await fs.rename(target, destination);
  await assertPlainFile(destination, 'Isolated trashed file');
  return { backend: 'isolated-test-trash', recovery_path: destination };
}

async function moveFileToTrash(target, context) {
  await assertPlainFile(target, 'Trash target');
  let result;
  if (process.env.NODE_ENV === 'test' && process.env.GT_CLEANUP_TEST_TRASH_ROOT) {
    result = await moveToTestTrash(target, context);
  } else if (process.platform === 'win32') {
    result = await moveToWindowsRecycleBin(target);
  } else if (process.platform === 'darwin') {
    result = await moveToMacTrash(target);
  } else if (process.platform === 'linux') {
    result = await moveToGioTrash(target);
  } else {
    throw new Error(`No recoverable Trash backend is supported on ${process.platform}; no file was permanently deleted`);
  }
  if (await lstatSafe(target)) throw new Error(`Trash backend returned success but the file remains at ${target}`);
  return result;
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
  const trashPlanPath = path.join(loaded.manifest.archive_root, 'TRASH_PLAN.json');
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
    '- Files moved to the operating-system Trash in this stage: 0',
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
    '- 같은 사용자 요청/turn에서 아카이브와 휴지통 이동을 연속 실행하지 않는다.',
    '- 사용자가 이후 별도 요청으로 휴지통 이동을 명시적으로 승인한 경우에만 `TRASH_PLAN.json`의 `review_reported_to_user`와 `user_trash_approval`을 `true`로 바꾼다.',
    '- 모든 파일을 다시 확인하고 각 exact 항목의 `approved`를 개별적으로 `true`로 바꾼 뒤 현재 trash-plan SHA-256과 `--trash --user-confirmed-trash`를 사용한다.',
    '- 이 도구는 영구 삭제를 지원하지 않는다. 휴지통 처리가 불가능하면 파일을 그대로 보존하고 `BLOCKED`로 중단한다.',
    '- 원본 위치 복원이 필요하면 archive path의 파일을 original path로 되돌린 뒤 해시를 확인한다.',
    '');
  await atomicWrite(reviewReportPath, `${lines.join('\n')}\n`);
  const reviewReportSha256 = await sha256File(reviewReportPath);
  const trashPlan = {
    schema_version: 1,
    kind: `${cleanupKind}-trash-plan`,
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
    user_trash_approval: false,
    candidates: inspections.map((item) => ({
      original_path: item.original_path,
      archive_path: item.archive_path,
      size: item.size,
      sha256: item.sha256,
      approved: false,
    })),
  };
  await atomicWrite(trashPlanPath, `${JSON.stringify(trashPlan, null, 2)}\n`);
  return {
    fullReinspectionComplete,
    reviewReportPath,
    reviewReportSha256,
    trashPlanPath,
    trashPlanSha256: await sha256File(trashPlanPath),
    stateFingerprint,
    inspections,
  };
}

function compareTrashCandidates(trashPlan, manifest) {
  if (!Array.isArray(trashPlan.candidates) || trashPlan.candidates.length !== manifest.items.length) {
    throw new Error('Trash plan candidate set does not exactly match the archive manifest');
  }
  if (new Set(trashPlan.candidates.map((candidate) => candidate.original_path)).size !== trashPlan.candidates.length) {
    throw new Error('Trash plan contains duplicate candidates');
  }
  const archived = new Map(manifest.items.map((item) => [item.original_path, item]));
  for (const candidate of trashPlan.candidates) {
    const item = archived.get(candidate.original_path);
    if (!item || candidate.archive_path !== item.archive_path || candidate.size !== item.size || candidate.sha256 !== item.sha256) {
      throw new Error(`Trash plan candidate differs from archive manifest: ${candidate.original_path}`);
    }
  }
}

export async function trashArchive({ cleanupKind, sourceRoot, trashPlanPath, expectedTrashPlanSha256, userConfirmedTrash, currentReviewState }) {
  if (!userConfirmedTrash) throw new Error('--trash requires --user-confirmed-trash after a separate explicit user approval');
  const resolvedTrashPlanPath = path.resolve(trashPlanPath);
  const raw = await fs.readFile(resolvedTrashPlanPath, 'utf8');
  const actualTrashPlanSha256 = sha256Text(raw);
  if (actualTrashPlanSha256.toLowerCase() !== expectedTrashPlanSha256.toLowerCase()) {
    throw new Error(`Trash plan SHA-256 mismatch: expected ${expectedTrashPlanSha256}, actual ${actualTrashPlanSha256}`);
  }
  const trashPlan = JSON.parse(raw);
  const legacyDeletePlan = trashPlan.kind === `${cleanupKind}-delete-plan`
    && path.basename(resolvedTrashPlanPath) === 'DELETE_PLAN.json';
  const canonicalTrashPlan = trashPlan.kind === `${cleanupKind}-trash-plan`
    && path.basename(resolvedTrashPlanPath) === 'TRASH_PLAN.json';
  if ((!canonicalTrashPlan && !legacyDeletePlan) || !samePath(trashPlan.source_root, sourceRoot)) {
    throw new Error('Trash plan does not belong to this cleanup root');
  }
  if (trashPlan.status !== 'awaiting-user-approval' || trashPlan.full_reinspection_complete !== true) {
    throw new Error('Trash plan has no completed full reinspection');
  }
  const canonicalPlanName = legacyDeletePlan ? 'DELETE_PLAN.json' : 'TRASH_PLAN.json';
  if (!samePath(resolvedTrashPlanPath, path.join(trashPlan.archive_root, canonicalPlanName))) {
    throw new Error('Trash plan must remain at its canonical archive transaction path');
  }
  if (legacyDeletePlan && await lstatSafe(path.join(trashPlan.archive_root, 'TRASH_PLAN.json'))) {
    throw new Error('A newer TRASH_PLAN.json exists; the legacy DELETE_PLAN.json is stale and cannot be used');
  }
  if (!samePath(trashPlan.archive_manifest, path.join(trashPlan.archive_root, 'ARCHIVE_MANIFEST.json'))
    || !samePath(trashPlan.review_report, path.join(trashPlan.archive_root, 'CLEANUP_ARCHIVE_REVIEW.md'))) {
    throw new Error('Trash plan references non-canonical archive evidence paths');
  }
  const explicitApproval = legacyDeletePlan ? trashPlan.user_delete_approval : trashPlan.user_trash_approval;
  if (trashPlan.review_reported_to_user !== true || explicitApproval !== true) {
    throw new Error('Detailed review reporting and explicit user Trash approval are not both recorded');
  }
  if (!Array.isArray(trashPlan.candidates) || trashPlan.candidates.length === 0) {
    throw new Error('Trash plan has no exact file candidates');
  }
  if (!trashPlan.candidates.every((candidate) => candidate.approved === true)) {
    throw new Error('Every archived file must be individually approved before this archive transaction can be moved to Trash');
  }

  const loaded = await readArchiveManifest({
    cleanupKind,
    sourceRoot: path.resolve(sourceRoot),
    manifestPath: trashPlan.archive_manifest,
    expectedSha256: trashPlan.archive_manifest_sha256,
  });
  if (!samePath(trashPlan.archive_root, loaded.manifest.archive_root)) throw new Error('Trash plan archive root mismatch');
  const reportSha256 = await sha256File(trashPlan.review_report);
  if (reportSha256 !== trashPlan.review_report_sha256) throw new Error('Detailed archive review report changed after review');
  compareTrashCandidates(trashPlan, loaded.manifest);
  const inspections = await inspectArchiveItems(loaded.manifest);
  if (!inspections.every((item) => item.original_absent && item.archive_regular_file && item.size_match && item.hash_match)) {
    throw new Error('Archive contents or original paths changed; run a new full archive review and report it again');
  }
  const currentFingerprint = sha256Text(JSON.stringify(currentReviewState));
  if (currentFingerprint !== trashPlan.source_reinspection_fingerprint) {
    throw new Error('Cleanup scope changed after the detailed report; run --review-archive and obtain new user approval');
  }

  const receiptPath = path.join(loaded.manifest.archive_root, 'TRASH_RECEIPT.json');
  const legacyReceiptPath = path.join(loaded.manifest.archive_root, 'PURGE_RECEIPT.json');
  if (await lstatSafe(receiptPath)) throw new Error(`Trash receipt already exists; inspect the prior operation before retrying: ${receiptPath}`);
  if (await lstatSafe(legacyReceiptPath)) throw new Error(`Legacy purge receipt exists; inspect it before any new Trash operation: ${legacyReceiptPath}`);
  const receipt = {
    schema_version: 1,
    kind: `${cleanupKind}-trash-receipt`,
    status: 'moving-to-trash',
    started_at: new Date().toISOString(),
    completed_at: null,
    source_root: path.resolve(sourceRoot),
    archive_root: loaded.manifest.archive_root,
    trash_plan: resolvedTrashPlanPath,
    trash_plan_sha256: actualTrashPlanSha256,
    plan_format: legacyDeletePlan ? 'legacy-delete-plan' : 'trash-plan',
    review_report_sha256: reportSha256,
    permanent_deletions: 0,
    recovery: {
      recoverable: true,
      instructions: 'Restore items from the operating-system Recycle Bin/Trash to their original_archive_path. To restore into the source tree, then follow ARCHIVE_MANIFEST.json and verify SHA-256.',
    },
    items: trashPlan.candidates.map((candidate) => ({
      ...candidate,
      original_archive_path: path.resolve(loaded.manifest.archive_root, candidate.archive_path),
      status: 'pending',
    })),
  };
  await atomicWrite(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  for (const item of receipt.items) {
    const target = path.resolve(loaded.manifest.archive_root, item.archive_path);
    const filesRoot = path.join(loaded.manifest.archive_root, 'files');
    try {
      if (!isWithin(filesRoot, target)) throw new Error(`Trash target escaped archive files root: ${item.archive_path}`);
      const trashResult = await moveFileToTrash(target, {
        cleanupKind,
        archiveRoot: loaded.manifest.archive_root,
        archivePath: item.archive_path,
      });
      item.status = 'trashed';
      item.trashed_at = new Date().toISOString();
      item.trash_backend = trashResult.backend;
      if (trashResult.recovery_path) item.recovery_path = trashResult.recovery_path;
    } catch (error) {
      item.status = 'blocked';
      item.error = error.message;
      receipt.status = 'blocked';
      await atomicWrite(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
      throw new Error(`Trash operation stopped at ${item.archive_path}: ${error.message}`);
    }
    await atomicWrite(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  receipt.status = 'complete';
  receipt.completed_at = new Date().toISOString();
  await atomicWrite(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return {
    receiptPath,
    receiptSha256: await sha256File(receiptPath),
    trashed: receipt.items.length,
  };
}
