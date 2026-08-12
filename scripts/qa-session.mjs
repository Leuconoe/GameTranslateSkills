#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';

const titleIdPattern = /^[0-9A-Fa-f]{16}$/;
const sessionStatuses = new Set(['active', 'pending', 'closed', 'blocked']);
const remoteSessionStatuses = new Set(['active', 'pending', 'closed']);
const supportedBackends = new Set(['eden-mcp', 'ryubing-mcp']);

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

function makeSessionKey({ backend, projectId, titleId, profilePath, profileSha256, emulatorVersion }) {
  const identity = [
    backend,
    projectId.toUpperCase(),
    titleId.toUpperCase(),
    normalizedPath(profilePath),
    profileSha256.toLowerCase(),
    emulatorVersion,
  ].join('\u0000');
  return `${backend}:${crypto.createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 24)}`;
}

function usage() {
  console.log(`Usage: npm run project:qa-session -- --project-root <title/_work/<16-hex-title-id>> [options]

Options:
  --action <status|prepare|close>  Guard action (default: status)
  --project-root <path>            Exact project root under a title's _work folder
  --backend <name>                 eden-mcp or ryubing-mcp (default: current backend or eden-mcp)
  --title-id <16-hex>              Runtime Title ID used to build the session key
  --profile-path <path>            Exact isolated emulator profile path
  --profile-sha256 <sha256>        SHA-256 of the effective profile settings
  --emulator-version <version>     Exact emulator version
  --build-id <id>                  Current candidate build ID (not part of session key)
  --session-id <id>                Session ID returned by the selected backend
  --remote-inventory-checked       Confirms the inventory rows were captured immediately before prepare
  --inventory-backend <name>       Repeat twice: eden-mcp and ryubing-mcp
  --observed-title-session <row>   Repeatable backend,status,session-id row from the remote inventory
  --previous-session-id <id>       Exact last_session_id proven closed before an exceptional replacement
  --exception-reason <reason>      Required for a second session, backend switch, or >1 observed session
  --remote-closed                  Required with close after backend close succeeded
  --close-reason <reason>          Required with close; routine QA should stop the title and reuse the session
  --help                           Show this help

The command manages one project-local SESSION.json ledger for Eden-MCP or Ryubing-MCP. It never
calls, creates, closes, or kills a remote session itself.`);
}

function normalizeState(state, projectId) {
  const inferredGeneration = state.session_id || state.last_session_id || ['active', 'pending'].includes(state.status) ? 1 : 0;
  return {
    ...state,
    schema_version: Number.isInteger(state.schema_version) ? state.schema_version : 1,
    project_id: state.project_id ?? projectId,
    backend: state.backend ?? null,
    session_generation: Number.isInteger(state.session_generation) ? state.session_generation : inferredGeneration,
    exception_count: Number.isInteger(state.exception_count) ? state.exception_count : 0,
    last_exception_reason: state.last_exception_reason ?? null,
    observed_title_sessions: Array.isArray(state.observed_title_sessions) ? state.observed_title_sessions : [],
    remote_inventory_checked_at: state.remote_inventory_checked_at ?? null,
    closed_reason: state.closed_reason ?? null,
  };
}

function requireIdentity(args, defaultBackend) {
  const backend = String(option(args, 'backend') ?? defaultBackend ?? 'eden-mcp').trim().toLowerCase();
  const titleId = requiredOption(args, 'title-id');
  const profilePath = requiredOption(args, 'profile-path');
  const profileSha256 = requiredOption(args, 'profile-sha256');
  const emulatorVersion = requiredOption(args, 'emulator-version');
  if (!supportedBackends.has(backend)) throw new Error('--backend must be eden-mcp or ryubing-mcp');
  if (!titleIdPattern.test(titleId)) throw new Error('--title-id must contain exactly 16 hexadecimal characters');
  if (!/^[0-9A-Fa-f]{64}$/.test(profileSha256)) throw new Error('--profile-sha256 must contain exactly 64 hexadecimal characters');
  return { backend, titleId: titleId.toUpperCase(), profilePath, profileSha256: profileSha256.toLowerCase(), emulatorVersion };
}

function optionalReason(args, name) {
  const value = option(args, name);
  if (value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`--${name} must be supplied exactly once`);
  const reason = value.trim();
  if (reason.length < 10 || /^(?:retry|test|temporary|other|재시도|테스트|임시|기타)$/i.test(reason)) {
    throw new Error(`--${name} must contain a concrete reason of at least 10 characters`);
  }
  return reason;
}

function parseRemoteInventory(args) {
  if (!flag(args, 'remote-inventory-checked')) {
    throw new Error('prepare requires --remote-inventory-checked after querying both Eden-MCP and Ryubing-MCP for this Title ID');
  }
  const rawInventoryBackends = option(args, 'inventory-backend');
  const inventoryBackends = rawInventoryBackends === undefined
    ? [] : (Array.isArray(rawInventoryBackends) ? rawInventoryBackends : [rawInventoryBackends]);
  const normalizedInventoryBackends = inventoryBackends.map((backend) => String(backend).trim().toLowerCase());
  if (normalizedInventoryBackends.length !== supportedBackends.size
      || new Set(normalizedInventoryBackends).size !== supportedBackends.size
      || normalizedInventoryBackends.some((backend) => !supportedBackends.has(backend))) {
    throw new Error('prepare requires exactly one --inventory-backend eden-mcp and one --inventory-backend ryubing-mcp');
  }
  const raw = option(args, 'observed-title-session');
  const rows = raw === undefined ? [] : (Array.isArray(raw) ? raw : [raw]);
  const sessions = [];
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    if (typeof row !== 'string') throw new Error(`--observed-title-session row ${index + 1} must be a string`);
    const [rawBackend, rawStatus, ...idCells] = row.split(',');
    const backend = rawBackend?.trim().toLowerCase();
    const status = rawStatus?.trim().toLowerCase();
    const sessionId = idCells.join(',').trim();
    if (!supportedBackends.has(backend) || !remoteSessionStatuses.has(status) || !sessionId || /[\r\n\t]/.test(sessionId)) {
      throw new Error(`--observed-title-session row ${index + 1} must be backend,status,session-id`);
    }
    const key = `${backend}\u0000${sessionId}`;
    if (seen.has(key)) throw new Error(`Duplicate observed Title session: ${backend}/${sessionId}`);
    seen.add(key);
    sessions.push({ backend, status, session_id: sessionId });
  }
  return sessions;
}

async function block(statePath, state, message, observedTitleSessions = state.observed_title_sessions) {
  const now = new Date().toISOString();
  await atomicWriteJson(statePath, {
    ...state,
    schema_version: 2,
    status: 'blocked',
    observed_title_sessions: observedTitleSessions,
    remote_inventory_checked_at: now,
    updated_at: now,
  });
  throw new Error(message);
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

  // Keep the established path for compatibility; SESSION.json is the single ledger for either MCP backend.
  const sessionRoot = path.join(projectRoot, '50_test', 'eden');
  const statePath = path.join(sessionRoot, 'SESSION.json');
  const lockPath = path.join(sessionRoot, 'tmp-qa-session.lock');
  await fs.mkdir(sessionRoot, { recursive: true });
  const action = String(option(args, 'action') ?? 'status').toLowerCase();
  if (!['status', 'prepare', 'close'].includes(action)) throw new Error('--action must be status, prepare, or close');

  let state = normalizeState((await readJson(statePath)) ?? {
    schema_version: 2,
    project_id: projectId,
    backend: null,
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
    session_generation: 0,
    exception_count: 0,
    last_exception_reason: null,
    observed_title_sessions: [],
    remote_inventory_checked_at: null,
    updated_at: null,
    closed_at: null,
    closed_reason: null,
  }, projectId);
  if (state.project_id !== projectId) throw new Error(`SESSION.json belongs to ${state.project_id}, not ${projectId}`);
  if (!sessionStatuses.has(state.status)) throw new Error(`SESSION.json has unsupported status: ${state.status}`);
  if (state.backend !== null && !supportedBackends.has(state.backend)) throw new Error(`SESSION.json has unsupported backend: ${state.backend}`);

  if (action === 'status') {
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  const identity = requireIdentity(args, state.backend);
  const sessionKey = makeSessionKey({ projectId, ...identity });
  const buildId = option(args, 'build-id') ?? state.current_build_id ?? null;
  let lockHandle;
  try {
    lockHandle = await acquireLock(lockPath);
    state = normalizeState((await readJson(statePath)) ?? state, projectId);
    if (state.project_id !== projectId) throw new Error(`SESSION.json belongs to ${state.project_id}, not ${projectId}`);

    if (action === 'prepare') {
      const observedTitleSessions = parseRemoteInventory(args);
      const exceptionReason = optionalReason(args, 'exception-reason');
      const backendException = identity.backend === 'ryubing-mcp';
      if (backendException && !exceptionReason) {
        throw new Error('Basic QA must use eden-mcp; selecting ryubing-mcp requires a concrete --exception-reason');
      }
      const liveSessions = observedTitleSessions.filter((session) => ['active', 'pending'].includes(session.status));
      if (liveSessions.length > 1) {
        await block(statePath, state, 'More than one active/pending remote session exists for this Title ID; reconcile and close exact owned sessions before QA', observedTitleSessions);
      }
      if (observedTitleSessions.length > 1 && !exceptionReason) {
        await block(statePath, state, 'More than one remote session exists for this Title ID; reuse or clean up the canonical session, or provide a concrete --exception-reason', observedTitleSessions);
      }

      const suppliedSessionId = option(args, 'session-id');
      if (suppliedSessionId !== undefined && (typeof suppliedSessionId !== 'string' || suppliedSessionId.trim() === '')) {
        throw new Error('--session-id must be supplied exactly once with a non-empty value');
      }
      if (state.status === 'blocked') {
        const singleRemoteActive = liveSessions.length === 1 && liveSessions[0].status === 'active';
        const recoverKnownActive = singleRemoteActive && state.session_id
          && liveSessions[0].backend === state.backend && liveSessions[0].session_id === state.session_id
          && state.session_key === sessionKey && state.backend === identity.backend;
        const recoverPendingCreate = singleRemoteActive && !state.session_id && suppliedSessionId
          && liveSessions[0].backend === identity.backend && liveSessions[0].session_id === suppliedSessionId
          && state.session_key === sessionKey;
        if (recoverKnownActive || recoverPendingCreate) {
          const now = new Date().toISOString();
          state = {
            ...state,
            schema_version: 2,
            backend: identity.backend,
            session_id: recoverPendingCreate ? suppliedSessionId : state.session_id,
            status: 'active',
            current_build_id: buildId,
            observed_title_sessions: observedTitleSessions,
            remote_inventory_checked_at: now,
            updated_at: now,
          };
          await atomicWriteJson(statePath, state);
          console.log(`${recoverPendingCreate ? 'ACTIVE' : 'REUSE'}\t${state.session_id}\t${state.session_key}\t${state.backend}`);
          return;
        }
        throw new Error('SESSION.json is blocked; reconcile both MCP inventories to one exact canonical active session before preparing again');
      }

      if (state.status === 'active' && !state.session_id) {
        await block(statePath, state, 'SESSION.json claims an active session without a session_id; reconcile both MCP inventories before creating another', observedTitleSessions);
      }
      if (state.status === 'active' && state.session_id) {
        const observedCurrent = liveSessions.length === 1 && liveSessions[0].status === 'active'
          && liveSessions[0].backend === state.backend
          && liveSessions[0].session_id === state.session_id;
        if (!observedCurrent) {
          await block(statePath, state, 'The canonical active session is not the single live remote session for this Title ID; do not create another', observedTitleSessions);
        }
        if (state.session_key !== sessionKey || state.backend !== identity.backend) {
          await block(statePath, state, 'The active Title session belongs to a different backend/profile identity; reuse it or close it exactly before an exceptional replacement', observedTitleSessions);
        }
        const now = new Date().toISOString();
        state = {
          ...state,
          schema_version: 2,
          current_build_id: buildId,
          observed_title_sessions: observedTitleSessions,
          remote_inventory_checked_at: now,
          last_exception_reason: exceptionReason ?? state.last_exception_reason,
          updated_at: now,
        };
        await atomicWriteJson(statePath, state);
        console.log(`REUSE\t${state.session_id}\t${state.session_key}\t${state.backend}`);
        return;
      }

      if (state.status === 'pending' && !suppliedSessionId) {
        await block(statePath, state, 'SESSION.json is pending; query both MCPs and record the one returned session ID instead of creating another', observedTitleSessions);
      }
      if (state.status === 'pending' && state.session_key && state.session_key !== sessionKey) {
        await block(statePath, state, 'Pending session ownership/backend/profile differs; reconcile remote status before recording a session ID', observedTitleSessions);
      }
      if (state.status === 'pending' && suppliedSessionId) {
        const observedCreated = liveSessions.length === 1 && liveSessions[0].status === 'active'
          && liveSessions[0].backend === identity.backend
          && liveSessions[0].session_id === suppliedSessionId;
        if (!observedCreated) {
          await block(statePath, state, 'The supplied session ID is not the single live remote session for this Title ID', observedTitleSessions);
        }
        const now = new Date().toISOString();
        state = {
          ...state,
          schema_version: 2,
          backend: identity.backend,
          session_id: suppliedSessionId,
          status: 'active',
          current_build_id: buildId,
          observed_title_sessions: observedTitleSessions,
          remote_inventory_checked_at: now,
          updated_at: now,
        };
        await atomicWriteJson(statePath, state);
        console.log(`ACTIVE\t${suppliedSessionId}\t${state.session_key}\t${state.backend}`);
        return;
      }
      if (liveSessions.length === 1) {
        const canAdoptFirst = state.session_generation === 0 && !state.last_session_id && suppliedSessionId
          && liveSessions[0].status === 'active'
          && liveSessions[0].backend === identity.backend && liveSessions[0].session_id === suppliedSessionId;
        if (!canAdoptFirst) {
          await block(statePath, state, 'A live remote session already exists for this Title ID; adopt or reconcile it instead of creating another', observedTitleSessions);
        }
      }

      const previousSessionId = option(args, 'previous-session-id');
      const additionalSession = state.session_generation >= 1 || Boolean(state.last_session_id)
        || observedTitleSessions.some((session) => session.status === 'closed');
      if (state.last_session_id) {
        if (previousSessionId !== state.last_session_id || state.remote_close_session_id !== state.last_session_id) {
          throw new Error(`Previous session ${state.last_session_id} needs exact --previous-session-id and matching remote-close proof before replacement`);
        }
      } else if (previousSessionId) {
        throw new Error('--previous-session-id was supplied but SESSION.json has no last_session_id');
      }
      if (additionalSession && !exceptionReason) {
        throw new Error('A second Title session requires a concrete --exception-reason; routine QA must reuse the canonical session');
      }

      const adoptingFirst = Boolean(suppliedSessionId) && state.session_generation === 0 && liveSessions.length === 1;
      if (suppliedSessionId && !adoptingFirst) {
        await block(statePath, state, 'Do not pass a new --session-id before the guard enters pending and the remote inventory confirms that single session', observedTitleSessions);
      }

      const now = new Date().toISOString();
      const nextGeneration = state.session_generation + 1;
      const exceptionApplied = additionalSession || backendException;
      state = {
        ...state,
        schema_version: 2,
        project_id: projectId,
        backend: identity.backend,
        session_key: sessionKey,
        session_id: suppliedSessionId ?? null,
        last_session_id: state.last_session_id ?? null,
        remote_close_session_id: additionalSession ? state.remote_close_session_id : null,
        status: suppliedSessionId ? 'active' : 'pending',
        title_id: identity.titleId,
        profile_path: path.resolve(identity.profilePath),
        profile_sha256: identity.profileSha256,
        emulator_version: identity.emulatorVersion,
        current_build_id: buildId,
        session_generation: nextGeneration,
        exception_count: state.exception_count + (exceptionApplied ? 1 : 0),
        last_exception_reason: exceptionApplied ? exceptionReason : state.last_exception_reason,
        observed_title_sessions: observedTitleSessions,
        remote_inventory_checked_at: now,
        updated_at: now,
        closed_at: null,
        closed_reason: null,
      };
      await atomicWriteJson(statePath, state);
      console.log(`${suppliedSessionId ? 'ACTIVE' : 'CREATE_REQUIRED'}\t${suppliedSessionId ?? '-'}\t${sessionKey}\t${identity.backend}`);
      return;
    }

    const closeReason = optionalReason(args, 'close-reason');
    if (!closeReason) throw new Error('close requires a concrete --close-reason; routine QA should stop the title and keep the canonical MCP session for reuse');
    if (!flag(args, 'remote-closed')) throw new Error('close requires --remote-closed after the backend confirmed close for the exact session ID');
    const suppliedSessionId = requiredOption(args, 'session-id');
    if (state.status !== 'active' || state.session_id !== suppliedSessionId) {
      throw new Error('The supplied --session-id is not the canonical active session; refusing to change another session');
    }
    if (state.backend !== identity.backend || state.session_key !== sessionKey) {
      throw new Error('The close identity does not match the canonical backend/profile session key');
    }
    const now = new Date().toISOString();
    state = {
      ...state,
      schema_version: 2,
      status: 'closed',
      session_id: null,
      last_session_id: suppliedSessionId,
      remote_close_session_id: suppliedSessionId,
      current_build_id: buildId,
      observed_title_sessions: [],
      remote_inventory_checked_at: now,
      updated_at: now,
      closed_at: now,
      closed_reason: closeReason,
    };
    await atomicWriteJson(statePath, state);
    console.log(`CLOSED\t${suppliedSessionId}\t${state.session_key}\t${state.backend}`);
  } finally {
    await releaseLock(lockHandle, lockPath);
  }
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exitCode = 1;
});
