#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';

const titleIdPattern = /^[0-9A-Fa-f]{16}$/;
const sessionStatuses = new Set(['active', 'pending', 'closed', 'blocked']);

function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function isDirectory(target) {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function readJson(target) {
  try {
    return JSON.parse(await fs.readFile(target, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Cannot read JSON state ${target}: ${error.message}`);
  }
}

async function acquireLock(lockPath) {
  try {
    const handle = await fs.open(lockPath, 'wx');
    await handle.writeFile(`${process.pid}\n`);
    return handle;
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`QA session state is already being updated: ${lockPath}`);
    throw error;
  }
}

async function releaseLock(handle, lockPath) {
  if (!handle) return;
  await handle.close();
  await fs.rm(lockPath, { force: true });
}

async function atomicWriteJson(target, value) {
  const tempPath = path.join(path.dirname(target), `tmp-qa-session-state-${process.pid}.json`);
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    await fs.rename(tempPath, target);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

function normalizedPath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function makeSessionKey({ projectId, titleId, profilePath, profileSha256, emulatorVersion }) {
  const identity = [
    'eden-mcp',
    projectId.toUpperCase(),
    titleId.toUpperCase(),
    normalizedPath(profilePath),
    profileSha256.toLowerCase(),
    emulatorVersion,
  ].join('\u0000');
  return `eden-mcp:${crypto.createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 24)}`;
}

function usage() {
  console.log(`Usage: npm run project:qa-session -- --project-root <title/_work/<16-hex-title-id>> [options]

Options:
  --action <status|prepare|close>  Guard action (default: status)
  --project-root <path>            Exact project root under a title's _work folder
  --title-id <16-hex>              Runtime Title ID used to build the session key
  --profile-path <path>            Exact isolated emulator profile path
  --profile-sha256 <sha256>        SHA-256 of the effective profile settings
  --emulator-version <version>     Exact emulator version
  --build-id <id>                  Current candidate build ID (not part of session key)
  --session-id <id>                Eden session ID returned by the backend
  --previous-session-id <id>       Exact last_session_id proven closed before creating a new session
  --remote-closed                  Required with close after backend close succeeded
  --help                           Show this help

The command only manages the project-local SESSION.json guard. It never calls or kills Eden.`);
}

function requireIdentity(args) {
  const titleId = requiredOption(args, 'title-id');
  const profilePath = requiredOption(args, 'profile-path');
  const profileSha256 = requiredOption(args, 'profile-sha256');
  const emulatorVersion = requiredOption(args, 'emulator-version');
  if (!titleIdPattern.test(titleId)) throw new Error('--title-id must contain exactly 16 hexadecimal characters');
  if (!/^[0-9A-Fa-f]{64}$/.test(profileSha256)) throw new Error('--profile-sha256 must contain exactly 64 hexadecimal characters');
  return { titleId: titleId.toUpperCase(), profilePath, profileSha256: profileSha256.toLowerCase(), emulatorVersion };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flag(args, 'help')) {
    usage();
    return;
  }

  const projectRoot = path.resolve(requiredOption(args, 'project-root'));
  const workRoot = path.dirname(projectRoot);
  const projectId = path.basename(projectRoot).toUpperCase();
  if (path.basename(workRoot) !== '_work' || !titleIdPattern.test(projectId)) {
    throw new Error('--project-root must be an exact title project under <title>/_work/<16-hex-title-id>');
  }
  if (!(await isDirectory(projectRoot))) throw new Error(`Project root does not exist: ${projectRoot}`);

  const edenRoot = path.join(projectRoot, '50_test', 'eden');
  const statePath = path.join(edenRoot, 'SESSION.json');
  const lockPath = path.join(edenRoot, 'tmp-qa-session.lock');
  await fs.mkdir(edenRoot, { recursive: true });
  const action = String(option(args, 'action') ?? 'status').toLowerCase();
  if (!['status', 'prepare', 'close'].includes(action)) throw new Error('--action must be status, prepare, or close');

  let state = await readJson(statePath);
  if (!state) {
    state = {
      schema_version: 1,
      project_id: projectId,
      backend: 'eden-mcp',
      session_key: null,
      session_id: null,
      last_session_id: null,
      status: 'closed',
      remote_close_session_id: null,
      title_id: null,
      profile_path: null,
      profile_sha256: null,
      emulator_version: null,
      current_build_id: null,
      updated_at: null,
      closed_at: null,
    };
  }
  if (state.project_id !== projectId) throw new Error(`SESSION.json belongs to ${state.project_id}, not ${projectId}`);
  if (!sessionStatuses.has(state.status)) throw new Error(`SESSION.json has unsupported status: ${state.status}`);

  if (action === 'status') {
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  const identity = requireIdentity(args);
  const sessionKey = makeSessionKey({ projectId, ...identity });
  const buildId = option(args, 'build-id') ?? state.current_build_id ?? null;
  let lockHandle;
  try {
    lockHandle = await acquireLock(lockPath);
    state = (await readJson(statePath)) ?? state;
    if (state.project_id !== projectId) throw new Error(`SESSION.json belongs to ${state.project_id}, not ${projectId}`);

    if (action === 'prepare') {
      if (state.status === 'active' && !state.session_id) {
        state.status = 'blocked';
        state.updated_at = new Date().toISOString();
        await atomicWriteJson(statePath, state);
        throw new Error('SESSION.json claims an active session without a session_id; reconcile remote Eden status before creating another');
      }
      if (state.status === 'active' && state.session_id) {
        if (state.session_key !== sessionKey) {
          state.status = 'blocked';
          state.updated_at = new Date().toISOString();
          await atomicWriteJson(statePath, state);
          throw new Error('An active Eden session has a different ownership/profile key; close it with its exact session ID before creating another');
        }
        state.current_build_id = buildId;
        state.updated_at = new Date().toISOString();
        await atomicWriteJson(statePath, state);
        console.log(`REUSE\t${state.session_id}\t${state.session_key}`);
        return;
      }

      const suppliedSessionId = option(args, 'session-id');
      if (state.status === 'pending' && !suppliedSessionId) {
        state.status = 'blocked';
        state.updated_at = new Date().toISOString();
        await atomicWriteJson(statePath, state);
        throw new Error('SESSION.json is pending without a confirmed session ID; reconcile remote Eden status before creating another session');
      }
      if (state.status === 'pending' && state.session_key && state.session_key !== sessionKey) {
        state.status = 'blocked';
        state.updated_at = new Date().toISOString();
        await atomicWriteJson(statePath, state);
        throw new Error('Pending Eden session ownership/profile key differs; reconcile remote status before recording a session ID');
      }
      if (state.status === 'blocked') throw new Error('SESSION.json is blocked; reconcile remote Eden status before preparing a session');
      const previousSessionId = option(args, 'previous-session-id');
      if (state.status === 'closed' && state.last_session_id && previousSessionId !== state.last_session_id) {
        throw new Error(`A previous session exists (${state.last_session_id}); pass --previous-session-id with that exact ID after remote close was confirmed`);
      }
      if (state.status === 'closed' && !state.last_session_id && previousSessionId) {
        throw new Error('--previous-session-id was supplied but SESSION.json has no last_session_id');
      }
      state = {
        ...state,
        schema_version: 1,
        project_id: projectId,
        backend: 'eden-mcp',
        session_key: sessionKey,
        session_id: suppliedSessionId ?? null,
        last_session_id: state.last_session_id ?? null,
        remote_close_session_id: null,
        status: suppliedSessionId ? 'active' : 'pending',
        title_id: identity.titleId,
        profile_path: path.resolve(identity.profilePath),
        profile_sha256: identity.profileSha256,
        emulator_version: identity.emulatorVersion,
        current_build_id: buildId,
        updated_at: new Date().toISOString(),
        closed_at: null,
      };
      await atomicWriteJson(statePath, state);
      console.log(`${suppliedSessionId ? 'ACTIVE' : 'CREATE_REQUIRED'}\t${suppliedSessionId ?? '-'}\t${sessionKey}`);
      return;
    }

    if (!flag(args, 'remote-closed')) throw new Error('close requires --remote-closed after the backend confirmed close for the exact session ID');
    const suppliedSessionId = requiredOption(args, 'session-id');
    if (state.session_id !== suppliedSessionId) throw new Error('The supplied --session-id does not match SESSION.json; refusing to change another session');
    state = {
      ...state,
      status: 'closed',
      session_id: null,
      last_session_id: suppliedSessionId,
      remote_close_session_id: suppliedSessionId,
      current_build_id: buildId,
      updated_at: new Date().toISOString(),
      closed_at: new Date().toISOString(),
    };
    await atomicWriteJson(statePath, state);
    console.log(`CLOSED\t${suppliedSessionId}\t${state.session_key ?? sessionKey}`);
  } finally {
    await releaseLock(lockHandle, lockPath);
  }
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exitCode = 1;
});
