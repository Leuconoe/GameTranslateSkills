import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptsRoot = path.join(repositoryRoot, 'scripts');
const fixtureRoot = path.join(repositoryRoot, 'tests', 'fixtures');

function runNode(script, args = [], env = {}) {
  return execFileSync(process.execPath, [path.join(scriptsRoot, script), ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function runNodeFailure(script, args = [], env = {}) {
  assert.throws(() => runNode(script, args, env));
}

function runNodeFailureOutput(script, args = [], env = {}) {
  try {
    runNode(script, args, env);
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
  assert.fail(`Expected ${script} to fail`);
}

test('skill bundle contract validates', () => {
  assert.match(runNode('validate-skill-bundle.mjs'), /Issues: 0/);
});

test('cleanup finalization exposes only recoverable Trash backends', async () => {
  const source = await fs.readFile(path.join(scriptsRoot, 'lib', 'cleanup-archive.mjs'), 'utf8');
  assert.match(source, /RecycleOption\]::SendToRecycleBin/);
  assert.match(source, /execFileAsync\('\/usr\/bin\/osascript'/);
  assert.match(source, /execFileAsync\('gio', \['trash'/);
  assert.doesNotMatch(source, /DeletePermanently/);
  assert.doesNotMatch(source, /fs\.unlink\(target\)/);
  assert.match(source, /no permanent-delete fallback was attempted/);
});

test('font atlas validator accepts a verified manifest', () => {
  const output = runNode('validate-font-atlas.mjs', [
    '--manifest', path.join(fixtureRoot, 'font-atlas-valid.tsv'),
    '--coverage', path.join(fixtureRoot, 'font-coverage-valid.tsv'),
  ]);
  assert.match(output, /Issues: 0/);
});

test('font atlas validator rejects duplicate or unverified glyph rows', () => {
  runNodeFailure('validate-font-atlas.mjs', ['--manifest', path.join(fixtureRoot, 'font-atlas-invalid.tsv')]);
});

test('qa session guard refuses a pending session retry', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'game-translate-session-'));
  const projectRoot = path.join(tempRoot, 'title', '_work', '0123456789ABCDEF');
  const edenRoot = path.join(projectRoot, '50_test', 'eden');
  await fs.mkdir(edenRoot, { recursive: true });
  await fs.writeFile(path.join(edenRoot, 'SESSION.json'), JSON.stringify({
    schema_version: 1,
    project_id: '0123456789ABCDEF',
    backend: 'eden-mcp',
    session_key: 'old-key',
    session_id: null,
    last_session_id: null,
    status: 'pending',
  }));
  const args = [
    '--project-root', projectRoot,
    '--action', 'prepare',
    '--title-id', '0123456789ABCDEF',
    '--profile-path', path.join(tempRoot, 'profile'),
    '--profile-sha256', '0'.repeat(64),
    '--emulator-version', 'fixture',
  ];
  runNodeFailure('qa-session.mjs', args);
  const state = JSON.parse(await fs.readFile(path.join(edenRoot, 'SESSION.json'), 'utf8'));
  assert.equal(state.status, 'blocked');
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test('qa session guard requires the exact previous ID before a new session', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'game-translate-session-reuse-'));
  const projectRoot = path.join(tempRoot, 'title', '_work', '0123456789ABCDEF');
  const edenRoot = path.join(projectRoot, '50_test', 'eden');
  await fs.mkdir(edenRoot, { recursive: true });
  await fs.writeFile(path.join(edenRoot, 'SESSION.json'), JSON.stringify({
    schema_version: 1,
    project_id: '0123456789ABCDEF',
    backend: 'eden-mcp',
    session_key: null,
    session_id: null,
    last_session_id: 'old-session',
    status: 'closed',
  }));
  const baseArgs = [
    '--project-root', projectRoot,
    '--action', 'prepare',
    '--title-id', '0123456789ABCDEF',
    '--profile-path', path.join(tempRoot, 'profile'),
    '--profile-sha256', '0'.repeat(64),
    '--emulator-version', 'fixture',
  ];
  runNodeFailure('qa-session.mjs', baseArgs);
  const createOutput = runNode('qa-session.mjs', [...baseArgs, '--previous-session-id', 'old-session']);
  assert.match(createOutput, /CREATE_REQUIRED/);
  const activeOutput = runNode('qa-session.mjs', [...baseArgs, '--session-id', 'new-session']);
  assert.match(activeOutput, /ACTIVE/);
  const state = JSON.parse(await fs.readFile(path.join(edenRoot, 'SESSION.json'), 'utf8'));
  assert.equal(state.status, 'active');
  assert.equal(state.session_id, 'new-session');
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test('project cleanup archives first and moves only approved files to recoverable Trash', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'game-translate-cleanup-'));
  const projectRoot = path.join(tempRoot, 'title', '_work', '0123456789ABCDEF');
  const toolsRoot = path.join(projectRoot, '90_tools');
  const trashRoot = path.join(tempRoot, 'isolated-trash');
  const trashEnv = { NODE_ENV: 'test', GT_CLEANUP_TEST_TRASH_ROOT: trashRoot };
  await fs.mkdir(toolsRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'HANDOFF.md'), '# Handoff\n\nOpen evidence: `90_tools/tmp-referenced.tmp`\n\n| date | type | observed | impact | decision | evidence | status |\n');
  await fs.writeFile(path.join(projectRoot, 'tmp-test-artifact.tmp'), 'fixture');
  await fs.writeFile(path.join(toolsRoot, 'tmp-referenced.tmp'), 'preserve');
  await fs.mkdir(path.join(projectRoot, '50_test', 'eden'), { recursive: true });
  await fs.writeFile(path.join(projectRoot, '50_test', 'eden', 'session-old.log'), 'unknown remote session');
  runNode('clean-translation-project.mjs', ['--project-root', projectRoot]);
  const planPath = path.join(toolsRoot, 'CLEANUP_PLAN.json');
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
  assert.ok(plan.candidates.some((candidate) => candidate.path === 'tmp-test-artifact.tmp'));
  const referenced = plan.candidates.find((candidate) => candidate.path === path.join('90_tools', 'tmp-referenced.tmp'));
  assert.equal(referenced.blocked, true);
  assert.match(referenced.evidence, /Referenced by Handoff/);
  const unverifiedEden = plan.candidates.find((candidate) => candidate.path === path.join('50_test', 'eden', 'session-old.log'));
  assert.equal(unverifiedEden.blocked, true);
  assert.match(unverifiedEden.evidence, /remote-close proof/);
  runNodeFailure('clean-translation-project.mjs', ['--project-root', projectRoot, '--plan', planPath, '--apply', '--plan-sha256', '0'.repeat(64)]);
  assert.equal(await fs.readFile(path.join(projectRoot, 'tmp-test-artifact.tmp'), 'utf8'), 'fixture');
  for (const candidate of plan.candidates) if (candidate.path === 'tmp-test-artifact.tmp') candidate.approved = true;
  await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const planSha = crypto.createHash('sha256').update(await fs.readFile(planPath)).digest('hex');
  await fs.writeFile(path.join(projectRoot, 'tmp-test-artifact.tmp'), 'changed after review');
  runNodeFailure('clean-translation-project.mjs', ['--project-root', projectRoot, '--plan', planPath, '--apply', '--plan-sha256', planSha]);
  assert.equal(await fs.readFile(path.join(projectRoot, 'tmp-test-artifact.tmp'), 'utf8'), 'changed after review');
  await fs.writeFile(path.join(projectRoot, 'tmp-test-artifact.tmp'), 'fixture');
  const archiveOutput = runNode('clean-translation-project.mjs', ['--project-root', projectRoot, '--plan', planPath, '--apply', '--plan-sha256', planSha]);
  assert.match(archiveOutput, /ARCHIVED\s+tmp-test-artifact\.tmp/);
  assert.match(archiveOutput, /permanently deleted: 0/);
  await assert.rejects(() => fs.access(path.join(projectRoot, 'tmp-test-artifact.tmp')));
  const archiveBase = path.join(toolsRoot, 'cleanup-archive');
  const archiveTransactions = await fs.readdir(archiveBase);
  assert.equal(archiveTransactions.length, 1);
  const archiveRoot = path.join(archiveBase, archiveTransactions[0]);
  const archiveManifestPath = path.join(archiveRoot, 'ARCHIVE_MANIFEST.json');
  const archiveManifest = JSON.parse(await fs.readFile(archiveManifestPath, 'utf8'));
  assert.equal(archiveManifest.status, 'archived');
  const archivedArtifact = path.join(archiveRoot, archiveManifest.items[0].archive_path);
  assert.equal(await fs.readFile(archivedArtifact, 'utf8'), 'fixture');
  const reviewText = await fs.readFile(path.join(archiveRoot, 'CLEANUP_ARCHIVE_REVIEW.md'), 'utf8');
  assert.match(reviewText, /Full reinspection completed: `true`/);
  assert.match(reviewText, /Files permanently deleted in this stage: 0/);
  const trashPlanPath = path.join(archiveRoot, 'TRASH_PLAN.json');
  const trashPlan = JSON.parse(await fs.readFile(trashPlanPath, 'utf8'));
  assert.equal(trashPlan.review_reported_to_user, false);
  assert.equal(trashPlan.user_trash_approval, false);
  runNodeFailure('clean-translation-project.mjs', [
    '--project-root', projectRoot,
    '--trash',
    '--trash-plan', trashPlanPath,
    '--trash-plan-sha256', crypto.createHash('sha256').update(await fs.readFile(trashPlanPath)).digest('hex'),
    '--user-confirmed-trash',
  ]);
  trashPlan.review_reported_to_user = true;
  trashPlan.user_trash_approval = true;
  for (const candidate of trashPlan.candidates) candidate.approved = true;
  await fs.writeFile(trashPlanPath, `${JSON.stringify(trashPlan, null, 2)}\n`);
  const trashPlanSha = crypto.createHash('sha256').update(await fs.readFile(trashPlanPath)).digest('hex');
  runNodeFailure('clean-translation-project.mjs', [
    '--project-root', projectRoot,
    '--trash',
    '--trash-plan', trashPlanPath,
    '--trash-plan-sha256', trashPlanSha,
  ]);
  await fs.appendFile(path.join(projectRoot, 'HANDOFF.md'), '\nReview input changed after report.\n');
  runNodeFailure('clean-translation-project.mjs', [
    '--project-root', projectRoot,
    '--trash',
    '--trash-plan', trashPlanPath,
    '--trash-plan-sha256', trashPlanSha,
    '--user-confirmed-trash',
  ]);
  const archiveManifestSha = crypto.createHash('sha256').update(await fs.readFile(archiveManifestPath)).digest('hex');
  const rereviewOutput = runNode('clean-translation-project.mjs', [
    '--project-root', projectRoot,
    '--review-archive',
    '--archive-manifest', archiveManifestPath,
    '--archive-manifest-sha256', archiveManifestSha,
  ]);
  assert.match(rereviewOutput, /Trash approvals were reset/);
  const rereviewedTrashPlan = JSON.parse(await fs.readFile(trashPlanPath, 'utf8'));
  assert.equal(rereviewedTrashPlan.review_reported_to_user, false);
  assert.equal(rereviewedTrashPlan.user_trash_approval, false);
  rereviewedTrashPlan.review_reported_to_user = true;
  rereviewedTrashPlan.user_trash_approval = true;
  for (const candidate of rereviewedTrashPlan.candidates) candidate.approved = true;
  await fs.writeFile(trashPlanPath, `${JSON.stringify(rereviewedTrashPlan, null, 2)}\n`);
  const rereviewedTrashPlanSha = crypto.createHash('sha256').update(await fs.readFile(trashPlanPath)).digest('hex');
  const trashOutput = runNode('clean-translation-project.mjs', [
    '--project-root', projectRoot,
    '--trash',
    '--trash-plan', trashPlanPath,
    '--trash-plan-sha256', rereviewedTrashPlanSha,
    '--user-confirmed-trash',
  ], trashEnv);
  assert.match(trashOutput, /Moved from archive to OS Recycle Bin\/Trash: 1; permanently deleted: 0/);
  await assert.rejects(() => fs.access(archivedArtifact));
  const receipt = JSON.parse(await fs.readFile(path.join(archiveRoot, 'TRASH_RECEIPT.json'), 'utf8'));
  assert.equal(receipt.status, 'complete');
  assert.equal(receipt.permanent_deletions, 0);
  assert.equal(receipt.items[0].status, 'trashed');
  assert.equal(receipt.items[0].trash_backend, 'isolated-test-trash');
  assert.equal(await fs.readFile(receipt.items[0].recovery_path, 'utf8'), 'fixture');
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test('project scaffold emits branch policies and validates', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'game-translate-project-'));
  const titlesRoot = path.join(tempRoot, '_titles');
  const gameFolder = path.join(titlesRoot, 'FixtureGame');
  await fs.mkdir(gameFolder, { recursive: true });
  await fs.writeFile(path.join(gameFolder, 'fixture.nsp'), 'fixture');
  const projectPath = runNode('new-translation-project.mjs', [
    '--titles-root', titlesRoot,
    '--game-folder', 'FixtureGame',
    '--title-id', '0123456789ABCDEF',
    '--game-name', 'Fixture Game',
  ]).trim();
  const projectText = await fs.readFile(path.join(projectPath, 'PROJECT.md'), 'utf8');
  assert.match(projectText, /text_review_policy: prepare-only/);
  assert.match(projectText, /image_review_policy: prepare-only/);
  assert.match(projectText, /font_status: pending/);
  assert.equal((await fs.stat(path.join(projectPath, 'HANDOFF.md'))).isFile(), true);
  assert.match(runNode('validate-translation-projects.mjs', ['--titles-root', titlesRoot]), /Errors: 0/);
  const gatedProjectText = projectText.replace('text_review_policy: prepare-only', 'text_review_policy: user-gate');
  await fs.writeFile(path.join(projectPath, 'PROJECT.md'), gatedProjectText);
  assert.match(
    runNodeFailureOutput('validate-translation-projects.mjs', ['--titles-root', titlesRoot]),
    /user-gate requires text_review_approval=pending or approved/,
  );
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test('workspace cleanup keeps active title state and legacy purge aliases still use recoverable Trash', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'game-translate-workspace-cleanup-'));
  const trashRoot = path.join(tempRoot, 'isolated-trash');
  const trashEnv = { NODE_ENV: 'test', GT_CLEANUP_TEST_TRASH_ROOT: trashRoot };
  const workspaceRoot = path.join(tempRoot, 'NSW');
  const projectRoot = path.join(workspaceRoot, '_titles', 'FixtureGame', '_work', '0123456789ABCDEF');
  const edenRoot = path.join(projectRoot, '50_test', 'eden');
  await fs.mkdir(edenRoot, { recursive: true });
  await fs.writeFile(path.join(edenRoot, 'SESSION.json'), JSON.stringify({
    project_id: '0123456789ABCDEF',
    status: 'active',
    session_id: 'active-session',
  }));
  const rootArtifact = path.join(workspaceRoot, 'tmp-root-artifact.tmp');
  const referencedRootArtifact = path.join(workspaceRoot, 'tmp-root-referenced.tmp');
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(rootArtifact, 'root fixture');
  await fs.writeFile(referencedRootArtifact, 'preserve root fixture');
  await fs.writeFile(path.join(projectRoot, 'HANDOFF.md'), '# Handoff\n\nOpen evidence: `../../../../tmp-root-referenced.tmp`\n');
  const reportPath = path.join(tempRoot, 'workspace-cleanup.md');
  const planPath = path.join(tempRoot, 'workspace-cleanup.json');
  runNode('workspace-cleanup.mjs', [
    '--workspace-root', workspaceRoot,
    '--report', reportPath,
    '--plan', planPath,
  ]);
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
  assert.equal(plan.findings.active_or_pending_sessions.length, 1);
  const candidate = plan.candidates.find((item) => item.path === 'tmp-root-artifact.tmp');
  assert.equal(candidate.blocked, false);
  const referencedCandidate = plan.candidates.find((item) => item.path === 'tmp-root-referenced.tmp');
  assert.equal(referencedCandidate.blocked, true);
  assert.match(referencedCandidate.evidence, /Referenced by a project Handoff/);
  candidate.approved = true;
  await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const planSha = crypto.createHash('sha256').update(await fs.readFile(planPath)).digest('hex');
  const archiveOutput = runNode('workspace-cleanup.mjs', ['--workspace-root', workspaceRoot, '--report', reportPath, '--plan', planPath, '--apply', '--plan-sha256', planSha]);
  assert.match(archiveOutput, /ARCHIVED\s+tmp-root-artifact\.tmp/);
  assert.match(archiveOutput, /permanently deleted: 0/);
  await assert.rejects(() => fs.access(rootArtifact));
  const archiveBase = path.join(tempRoot, 'workspace-cleanup-archive');
  const archiveTransactions = await fs.readdir(archiveBase);
  assert.equal(archiveTransactions.length, 1);
  const archiveRoot = path.join(archiveBase, archiveTransactions[0]);
  const archiveManifest = JSON.parse(await fs.readFile(path.join(archiveRoot, 'ARCHIVE_MANIFEST.json'), 'utf8'));
  const archivedArtifact = path.join(archiveRoot, archiveManifest.items[0].archive_path);
  assert.equal(await fs.readFile(archivedArtifact, 'utf8'), 'root fixture');
  const trashPlanPath = path.join(archiveRoot, 'TRASH_PLAN.json');
  const deletePlanPath = path.join(archiveRoot, 'DELETE_PLAN.json');
  const deletePlan = JSON.parse(await fs.readFile(trashPlanPath, 'utf8'));
  assert.equal(deletePlan.full_reinspection_complete, true);
  deletePlan.kind = 'workspace-cleanup-delete-plan';
  deletePlan.review_reported_to_user = true;
  deletePlan.user_delete_approval = true;
  delete deletePlan.user_trash_approval;
  for (const item of deletePlan.candidates) item.approved = true;
  await fs.rename(trashPlanPath, deletePlanPath);
  await fs.writeFile(deletePlanPath, `${JSON.stringify(deletePlan, null, 2)}\n`);
  const deletePlanSha = crypto.createHash('sha256').update(await fs.readFile(deletePlanPath)).digest('hex');
  const purgeOutput = runNode('workspace-cleanup.mjs', [
    '--workspace-root', workspaceRoot,
    '--purge',
    '--delete-plan', deletePlanPath,
    '--delete-plan-sha256', deletePlanSha,
    '--user-confirmed-delete',
  ], trashEnv);
  assert.match(purgeOutput, /Compatibility notice: --purge now moves files to the OS Trash and never permanently deletes them/);
  assert.match(purgeOutput, /Moved from archive to OS Recycle Bin\/Trash: 1; permanently deleted: 0/);
  await assert.rejects(() => fs.access(archivedArtifact));
  const receipt = JSON.parse(await fs.readFile(path.join(archiveRoot, 'TRASH_RECEIPT.json'), 'utf8'));
  assert.equal(receipt.plan_format, 'legacy-delete-plan');
  assert.equal(receipt.permanent_deletions, 0);
  assert.equal(await fs.readFile(receipt.items[0].recovery_path, 'utf8'), 'root fixture');
  await fs.rm(tempRoot, { recursive: true, force: true });
});
