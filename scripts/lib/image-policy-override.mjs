import fs from 'node:fs/promises';
import path from 'node:path';
import { decodePngRgba } from './png-rgba.mjs';
import { insideEditRegions, parseEditRegions } from './image-alpha-mask.mjs';
import { sameImageText, validImageTextPair } from './image-prompt-contract.mjs';

export const IMAGE_OVERRIDE_POLICY = 'project-local-max-2-then-typeset';
const shaPattern = /^[0-9a-f]{64}$/i;
const nonempty = (value) => typeof value === 'string' && value.trim().length >= 4;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const samePath = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const normalize = (p) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
  return normalize(a) === normalize(b);
};

export async function loadImageOverride(projectRoot, projectRealRoot, ctx, issues) {
  try { await fs.lstat(path.join(projectRoot, 'PROJECT.md')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const row = { __line: 'PROJECT' };
  const before = issues.length;
  const project = await ctx.fileEvidence(projectRoot, projectRealRoot, 'PROJECT.md', 'PROJECT.md', row, issues);
  if (!project) return null;
  const fields = (key) => [...project.buffer.toString('utf8').matchAll(new RegExp('^\\s*' + key + ':\\s*([^\\r\\n]*)', 'gm'))]
    .map((m) => m[1].trim().replace(/\s+#.*$/, '').replace(/^(['"])(.*)\1$/, '$2'));
  const paths = fields('image_generation_override');
  if (!paths.length) return null;
  const value = (key) => {
    const found = fields(key);
    if (found.length !== 1) issues.push('image override: PROJECT must contain exactly one ' + key);
    return found[0];
  };
  const policyPath = value('image_generation_override');
  const policySha = value('image_generation_override_sha256');
  const title = value('title_id');
  if (!policyPath?.startsWith('30_translation/image_translation/policies/') || !policyPath.endsWith('.json')) {
    issues.push('image override: policy must be a project-local policies/*.json path');
  }
  const evidence = await ctx.fileEvidence(projectRoot, projectRealRoot, policyPath, 'image override policy', row, issues);
  ctx.compareDeclaredHash(evidence, policySha, 'image override policy SHA', row, issues);
  let policy;
  try { policy = JSON.parse(evidence?.buffer.toString('utf8') ?? 'null'); }
  catch { issues.push('image override: policy is not valid JSON'); return null; }
  if (!object(policy)) { issues.push('image override: policy must be an object'); return null; }
  if (policy.schema_version !== 1 || policy.policy !== IMAGE_OVERRIDE_POLICY
      || policy.max_imagegen_attempts !== 2 || policy.include_prior_failures !== true
      || policy.fallback !== 'direct-typesetting') issues.push('image override: invalid explicit policy contract');
  if (!samePath(policy.project_root, projectRealRoot) || !title || policy.title_id !== title) {
    issues.push('image override: title/project identity mismatch');
  }
  const instruction = await ctx.fileEvidence(projectRoot, projectRealRoot, policy.user_instruction?.path, 'user instruction evidence', row, issues);
  ctx.compareDeclaredHash(instruction, policy.user_instruction?.sha256, 'user instruction SHA', row, issues);
  let directive;
  try { directive = JSON.parse(instruction?.buffer.toString('utf8') ?? 'null'); }
  catch { issues.push('image override: instruction evidence is not valid JSON'); }
  if (!object(directive) || directive.authority !== 'user' || directive.policy !== IMAGE_OVERRIDE_POLICY
      || directive.max_imagegen_attempts !== 2 || directive.include_prior_failures !== true
      || directive.fallback !== 'direct-typesetting' || !nonempty(directive.verbatim)
      || !nonempty(directive.source_ref) || !Number.isFinite(Date.parse(directive.recorded_at))
      || directive.title_id !== title || !samePath(directive.project_root, projectRealRoot)) {
    issues.push('image override: explicit user instruction/title/project evidence required');
  }
  const scope = new Map();
  const historyEvidence = [];
  if (!Array.isArray(policy.scope) || !policy.scope.length) issues.push('image override: nonempty exact scope required');
  for (const item of Array.isArray(policy.scope) ? policy.scope : []) {
    if ((typeof item?.stable_key !== 'string' || !item.stable_key.trim()) || !shaPattern.test(item?.source_sha256 ?? '') || scope.has(item.stable_key)) {
      issues.push('image override: scope requires unique exact stable_key + source_sha256');
    } else {
      const history = await loadPriorHistory(item, title, projectRoot, projectRealRoot, ctx, row, issues, historyEvidence);
      scope.set(item.stable_key, { source_sha256: item.source_sha256.toLowerCase(), history });
    }
  }
  if ([project, evidence, instruction, ...historyEvidence].some((entry) => entry?.stat.nlink > 1)) issues.push('image override: policy/instruction/PROJECT must not be hard-linked');
  if (issues.length !== before) return null;
  return { path: policyPath, sha256: evidence.sha256, scope, evidence: [project, evidence, instruction, ...historyEvidence].filter(Boolean) };
}

// A surfaced artifact key is an observation identity, never a claimed provider ID.
export function invocationIdentity(value) {
  if (!object(value)) return null;
  if (value.provider_tool_call_id_exposed === true && nonempty(value.tool_call_id)
      && !value.tool_call_id.startsWith('returned-artifact:')
      && value.invocation_key == null) return 'provider-tool-call:' + value.tool_call_id;
  if (value.provider_tool_call_id_exposed !== false || value.tool_call_id != null
      || !nonempty(value.returned_artifact_locator) || /[\r\n]/.test(value.returned_artifact_locator)) return null;
  const filename = value.returned_artifact_locator.replace(/\\/g, '/').split('/').at(-1);
  const stem = filename.replace(/\.[^.]+$/, '');
  return nonempty(stem) && value.invocation_key === 'returned-artifact:' + stem ? value.invocation_key : null;
}

async function loadPriorHistory(item, title, projectRoot, projectRealRoot, ctx, row, issues, evidenceList) {
  const fail = (message) => issues.push('image override: prior history ' + message);
  const pin = item.prior_history;
  const entry = await ctx.fileEvidence(projectRoot, projectRealRoot, pin?.path, 'prior history', row, issues);
  ctx.compareDeclaredHash(entry, pin?.sha256, 'prior history SHA', row, issues);
  if (entry) evidenceList.push(entry);
  let history;
  try { history = JSON.parse(entry?.buffer.toString('utf8') ?? 'null'); }
  catch { fail('is not JSON'); return null; }
  if (!object(history)) { fail('requires an explicit snapshot, including zero prior calls'); return null; }
  if (history.schema_version !== 1 || !['before-current-execution', 'after-generation-before-adoption'].includes(history.snapshot_phase)
      || !nonempty(history.source_ref) || !Number.isFinite(Date.parse(history.recorded_at))
      || history.title_id !== title || !samePath(history.project_root, projectRealRoot)
      || history.stable_key !== item.stable_key
      || history.source_sha256 !== item.source_sha256.toLowerCase()) fail('scope/project identity mismatch');
  if (!Array.isArray(history.invocations)) { fail('invocations must be an array'); return null; }
  if (history.explicit_zero_prior !== (history.invocations.length === 0)) fail('zero-prior declaration mismatch');
  const records = new Map();
  for (const prior of history.invocations) {
    const identity = invocationIdentity(prior);
    if (!identity || records.has(identity)) {
      fail('requires unique typed invocation identities'); continue;
    }
    const file = await ctx.fileEvidence(projectRoot, projectRealRoot, prior.invocation_path, 'prior invocation', row, issues);
    ctx.compareDeclaredHash(file, prior.invocation_sha256, 'prior invocation SHA', row, issues);
    if (file?.stat.nlink > 1) fail('invocation record must not be hard-linked');
    let data;
    try { data = JSON.parse(file?.buffer.toString('utf8') ?? 'null'); } catch { fail('invocation record is not JSON'); }
    if (!object(data) || invocationIdentity(data) !== identity || data.tool !== 'image_gen.imagegen'
        || data.execution_surface !== 'chatgpt-built-in' || data.operation !== 'edit'
        || data.reference_sha256 !== item.source_sha256.toLowerCase()
        || !['completed', 'failed'].includes(data.generation_status) || data.safety_refusal !== false) {
      fail('actual invocation identity mismatch');
    }
    records.set(identity, prior);
  }
  if (records.size > 2) fail('already exceeds cumulative unique call limit 2');
  if (history.snapshot_phase === 'after-generation-before-adoption' && records.size !== 2) {
    fail('historical adoption requires exactly two actual prior calls, never a retroactive zero');
  }
  return { path: pin?.path, sha256: entry?.sha256, records, phase: history.snapshot_phase };
}

export function validatePriorInvocationHistory(receipt, policy, row, issues) {
  if (!policy || !Array.isArray(receipt.attempts)) return;
  const prior = policy.priorHistory;
  const fail = (message) => issues.push('line ' + row.__line + ': prior history ' + message);
  if (!prior || receipt.prior_history?.path !== prior.path || receipt.prior_history?.sha256 !== prior.sha256) {
    fail('receipt snapshot pin missing or mismatched'); return;
  }
  if (prior.phase === 'after-generation-before-adoption' && receipt.origin !== 'agent-typeset') {
    fail('historical adoption is typeset-only and does not authorize generation');
  }
  const current = new Map(receipt.attempts.filter(object).map((attempt) => [invocationIdentity(attempt), attempt]));
  const union = new Set([...prior.records.keys(), ...current.keys()]);
  if (union.size > 2) fail('cumulative unique calls exceed limit 2');
  for (const [id, record] of prior.records) {
    const attempt = current.get(id);
    if (!attempt) fail('pinned prior call omitted: ' + id);
    else if (attempt.invocation_path !== record.invocation_path || attempt.invocation_sha256 !== record.invocation_sha256) {
      fail('prior invocation pin changed: ' + id);
    }
  }
}

export function scopedImageOverride(policy, row) {
  const scope = policy?.scope.get(row.stable_key);
  return scope?.source_sha256 === row.source_sha256.toLowerCase() ? { ...policy, priorHistory: scope.history } : null;
}

export function validateOverrideBinding(receipt, policy, row, issues) {
  const binding = receipt.policy_override;
  if (!policy || binding?.path !== policy.path || binding?.sha256 !== policy.sha256) {
    issues.push('line ' + row.__line + ': explicit project override scope/pin missing or mismatched');
  }
}

// An invocation record preserves an actual built-in call reference; it is not a fabricated service signature.
export async function validateOverrideInvocation(attempt, row, ctx, issues) {
  const fail = (message) => issues.push('line ' + row.__line + ': override invocation ' + message);
  const identity = invocationIdentity(attempt);
  if (!identity || attempt.execution_surface !== 'chatgpt-built-in' || attempt.safety_refusal !== false) {
    fail('requires typed invocation identity/built-in surface and no safety refusal');
  }
  const record = await ctx.evidence(attempt.invocation_path, attempt.invocation_sha256, 'invocation');
  let data;
  try { data = JSON.parse(record?.buffer.toString('utf8') ?? 'null'); } catch { fail('invalid JSON'); }
  const expected = {
    tool: 'image_gen.imagegen', execution_surface: 'chatgpt-built-in', operation: 'edit',
    provider_tool_call_id_exposed: attempt.provider_tool_call_id_exposed,
    reference_sha256: row.reference_sha256, prompt_sha256: attempt.prompt_sha256,
    generation_status: attempt.generation_status, output_sha256: attempt.output_sha256, safety_refusal: false,
  };
  if (attempt.provider_tool_call_id_exposed === false) {
    Object.assign(expected, {
      invocation_key: attempt.invocation_key, returned_artifact_locator: attempt.returned_artifact_locator,
      returned_artifact_sha256: attempt.returned_artifact_sha256,
      request_path: attempt.request_path, request_sha256: attempt.request_sha256,
    });
    const request = await ctx.evidence(attempt.request_path, attempt.request_sha256, 'preserved imagegen request');
    if (!request?.buffer.length || attempt.generation_status !== 'completed'
        || !shaPattern.test(attempt.returned_artifact_sha256 ?? '')
        || attempt.returned_artifact_sha256 !== attempt.output_sha256) {
      fail('observable artifact requires preserved request and completed output byte pin');
    }
  } else expected.tool_call_id = attempt.tool_call_id;
  if (invocationIdentity(data) !== identity) fail('record typed identity mismatch');
  for (const [key, value] of Object.entries(expected)) {
    if (!object(data) || data[key] !== value) fail('record mismatch: ' + key);
  }
  if (attempt.generation_status === 'failed'
      && (attempt.failure_kind !== 'generation-error' || !nonempty(data?.error))) {
    fail('failed generation requires recorded non-safety generation error');
  }
}

function jsonPointer(value, pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return undefined;
  for (const token of pointer.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, token)) return undefined;
    value = value[token];
  }
  return value;
}

// An adoption-time interpretation of preserved bytes, not a rewritten tool prompt or service attestation.
export async function validateFailedPromptContract(receipt, row, policy, ctx, issues) {
  const before = issues.length;
  const fail = (message) => issues.push('line ' + row.__line + ': failed prompt sidecar ' + message);
  if (!policy || receipt.origin !== 'agent-typeset' || receipt.schema_version !== 6
      || !Array.isArray(receipt.attempts) || receipt.attempts.length !== 2
      || receipt.attempts.some((call) => call?.selection_status !== 'rejected')) {
    fail('requires exactly two rejected built-in calls and typeset adoption'); return false;
  }
  const file = await ctx.evidence(receipt.failed_prompt_contract?.path,
    receipt.failed_prompt_contract?.sha256, 'failed prompt contract');
  let contract;
  try { contract = JSON.parse(file?.buffer.toString('utf8') ?? 'null'); } catch { fail('is not JSON'); }
  if (!object(contract)) { fail('requires a pinned object'); return false; }
  for (const key of ['stable_key', 'source_path', 'source_sha256', 'reference_path', 'reference_sha256', 'edit_regions']) {
    if (contract[key] !== row[key]) fail('identity mismatch: ' + key);
  }
  if (contract.schema_version !== 1 || contract.kind !== 'preserved-failed-prompt-contract'
      || contract.actual_read !== true || !nonempty(contract.reviewer) || contract.semantic_consistency !== 'pass'
      || contract.source_text !== receipt.typesetting?.source_text
      || contract.korean_text !== receipt.typesetting?.korean_text
      || contract.canvas?.width !== Number(row.source_width) || contract.canvas?.height !== Number(row.source_height)) {
    fail('explicit text/canvas and named semantic review required');
  }
  const plan = await ctx.evidence(contract.plan?.path, contract.plan?.sha256, 'frozen image plan');
  if (!plan?.buffer.length) fail('frozen plan byte pin required');
  if (!Array.isArray(contract.attempts) || contract.attempts.length !== 2) {
    fail('requires two exact request/prompt records'); return false;
  }
  const records = new Map();
  for (const record of contract.attempts) {
    const id = invocationIdentity(record);
    if (!id || records.has(id)) fail('duplicate or invalid typed identity');
    records.set(id, record);
  }
  let regions;
  try { regions = parseEditRegions(row.edit_regions); } catch { fail('invalid edit regions'); return false; }
  for (const attempt of receipt.attempts) {
    const record = records.get(invocationIdentity(attempt));
    if (!record) { fail('request record omitted'); continue; }
    for (const key of ['prompt_path', 'prompt_sha256', 'request_path', 'request_sha256']) {
      if (record[key] !== attempt[key]) fail('actual attempt pin mismatch: ' + key);
    }
    const raw = await ctx.evidence(record.prompt_path, record.prompt_sha256, 'preserved natural-language prompt');
    const request = await ctx.evidence(record.request_path, record.request_sha256, 'actual request record');
    if (!raw || !request) continue;
    const span = (description, label, limit = raw.buffer.length) => {
      const offset = description?.byte_offset, length = description?.byte_length;
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1
          || offset + length > limit) { fail(label + ' invalid UTF-8 byte span'); return null; }
      const bytes = raw.buffer.subarray(offset, offset + length);
      const text = bytes.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(bytes)) { fail(label + ' splits UTF-8'); return null; }
      return text;
    };
    const actualPrompt = span(record.request_prompt_span, 'request prompt');
    const callLength = record.request_prompt_span?.byte_length;
    const suffix = Number.isSafeInteger(callLength) ? raw.buffer.subarray(callLength).toString('utf8') : null;
    if (record.request_prompt_span?.byte_offset !== 0 || !['', '\n', '\r\n'].includes(suffix)) {
      fail('request prompt must cover raw bytes except an explicit final LF/CRLF');
    }
    let requestData;
    try { requestData = JSON.parse(request.buffer.toString('utf8')); } catch { fail('request record is not JSON'); }
    const sent = jsonPointer(requestData, record.request_prompt_pointer);
    if (typeof sent !== 'string' || sent !== actualPrompt) fail('actual request prompt differs from preserved span');
    for (const key of ['source_text', 'korean_text']) {
      const descriptor = record.literal_spans?.[key];
      if (key === 'source_text' && descriptor?.kind === 'ordered-source-lines') {
        const ordered = descriptor.ordered_spans;
        if (descriptor.joiner !== '\n' || !Array.isArray(ordered) || ordered.length !== 2) {
          fail('ordered source lines require exactly two spans and declared LF'); continue;
        }
        const parts = ordered.map((part, index) => span(part, 'source line ' + index, callLength));
        if (parts.some((part) => part === null || /[\r\n]/.test(part))) {
          fail('ordered source lines must each be a nonempty raw single line'); continue;
        }
        const middle = ' on the first line and ';
        const instruction = parts[0] + middle + parts[1] + ' on the second line';
        const instructionSpan = descriptor.line_instruction_span;
        const observed = span(instructionSpan, 'source line instruction', callLength);
        const secondOffset = instructionSpan?.byte_offset + Buffer.byteLength(parts[0] + middle, 'utf8');
        if (observed !== instruction || ordered[0].byte_offset !== instructionSpan?.byte_offset
            || ordered[1].byte_offset !== secondOffset
            || ordered[0].byte_offset + ordered[0].byte_length > ordered[1].byte_offset
            || parts.join(descriptor.joiner) !== contract[key]) {
          fail('ordered source line instruction/order or reconstructed source mismatch');
        }
      } else if (span(descriptor, key, callLength) !== contract[key]) fail('literal mismatch: ' + key);
    }
    const numbers = (description, label) => {
      const text = span(description, label, callLength);
      return text === null ? null : (text.match(/-?\d+/g) ?? []).map(Number);
    };
    const sameNumbers = (actual, expected) => actual?.length === expected.length && actual.every((n, i) => n === expected[i]);
    if (!sameNumbers(numbers(record.canvas_span, 'canvas'), [Number(row.source_width), Number(row.source_height)])) {
      fail('canvas literal contradicts manifest');
    }
    if (!Array.isArray(record.region_spans) || record.region_spans.length !== regions.length) {
      fail('every edit region needs an actual coordinate literal');
    } else for (const [index, descriptor] of record.region_spans.entries()) {
      const r = regions[index];
      const expected = descriptor.representation === 'xywh' ? [r.x, r.y, r.width, r.height] : null;
      if (descriptor.index !== index || !expected || !sameNumbers(numbers(descriptor, 'region ' + index), expected)) {
        fail('coordinate literal contradicts edit region ' + index);
      }
    }
  }
  return issues.length === before;
}

export async function validateTypesetReceipt(receipt, row, policy, evidence, ctx, issues) {
  const fail = (message) => issues.push('line ' + row.__line + ': typeset ' + message);
  validateOverrideBinding(receipt, policy, row, issues);
  for (const [key, expected] of Object.entries({
    schema_version: 6, origin: 'agent-typeset', generator: 'typeset', operation: 'typeset',
    execution_surface: 'project-local-typeset', source_path: row.source_path,
    source_sha256: row.source_sha256, candidate_policy: IMAGE_OVERRIDE_POLICY,
  })) if (receipt[key] !== expected) fail('receipt mismatch: ' + key);
  if (receipt.normalization || receipt.alpha_composition) fail('cannot impersonate imagegen schemas 4/5');
  const spec = receipt.typesetting;
  if (!object(spec)) { fail('requires typesetting provenance'); return; }
  if (!['direct-typesetting', 'compositing'].includes(spec.technique)
      || !validImageTextPair(spec.source_text, spec.korean_text, row.edit_regions)
      || !nonempty(spec.renderer?.name) || !nonempty(spec.renderer?.version)
      || !object(spec.renderer?.settings) || !Object.keys(spec.renderer.settings).length
      || row.tool !== spec.renderer.name) fail('actual technique/text/renderer/settings required');

  const font = await ctx.evidence(spec.font?.path, spec.font?.sha256, 'font');
  if (font && !font.buffer.length) fail('empty font');
  const masks = [];
  for (const key of ['glyph_mask', 'effect_mask']) {
    const file = await ctx.evidence(spec[key]?.path, spec[key]?.sha256, key);
    if (!file) continue;
    try {
      const png = decodePngRgba(file.buffer);
      if (png.width !== Number(row.source_width) || png.height !== Number(row.source_height)) fail(key + ' canvas mismatch');
      else masks.push(png.rgba);
    } catch { fail(key + ' must be a decoded PNG mask'); }
  }
  if (masks.length === 2) {
    let regions;
    try { regions = parseEditRegions(row.edit_regions); } catch { regions = []; }
    let active = 0, invalidMask = false, outsideRegion = false, unmaskedChange = false;
    for (let i = 0; i < masks[0].length; i += 4) {
      const pixel = i / 4, x = pixel % Number(row.source_width), y = Math.floor(pixel / Number(row.source_width));
      for (const mask of masks) {
        if (mask[i] !== mask[i + 1] || mask[i] !== mask[i + 2] || mask[i + 3] !== 255) invalidMask = true;
        if (!insideEditRegions(x, y, regions) && mask[i] !== 0) outsideRegion = true;
      }
      if (masks[0][i] || masks[1][i]) active++;
      else if (evidence.sourceRgba && evidence.candidateRgba
          && evidence.sourceRgba.buffer.length === masks[0].length
          && evidence.candidateRgba.buffer.length === masks[0].length
          && !evidence.sourceRgba.buffer.subarray(i, i + 4).equals(evidence.candidateRgba.buffer.subarray(i, i + 4))) {
        unmaskedChange = true;
      }
    }
    if (invalidMask) fail('mask must be opaque grayscale');
    if (outsideRegion) fail('mask exceeds edit regions');
    if (unmaskedChange) fail('RGBA changed outside glyph/effect masks');
    if (!active) fail('empty edit masks');
  }
  const jsonEvidence = async (key) => {
    const file = await ctx.evidence(spec[key]?.path, spec[key]?.sha256, key);
    let data;
    try { data = JSON.parse(file?.buffer.toString('utf8') ?? 'null'); } catch { fail(key + ' is not JSON'); }
    if (!object(data) || data.stable_key !== row.stable_key
        || data.source_sha256 !== row.source_sha256 || data.candidate_sha256 !== row.candidate_sha256) {
      fail(key + ' source/candidate identity mismatch');
    }
    return data;
  };
  const background = await jsonEvidence('background_evidence');
  if (!nonempty(background?.method)) fail('background restoration method required');
  const visual = await jsonEvidence('visual_qa');
  if (visual?.actual_view !== true || !nonempty(visual?.reviewer)
      || !sameImageText(visual?.source_text, spec.source_text) || !sameImageText(visual?.korean_text, spec.korean_text)
      || ['visual_status', 'source_text_removal_status', 'korean_text_status', 'original_feel_status']
        .some((key) => visual?.[key] !== 'pass')) fail('actual-view text/visual QA required');
  const roundtrip = await jsonEvidence('roundtrip');
  if (roundtrip?.status !== 'pass' || !nonempty(roundtrip?.method)) fail('native roundtrip proof required');
  const reloaded = await ctx.evidence(roundtrip?.reloaded_path, roundtrip?.reloaded_sha256, 'reloaded candidate');
  const rgba = await ctx.evidence(roundtrip?.reloaded_rgba_path, roundtrip?.reloaded_rgba_sha256, 'reloaded RGBA');
  if (reloaded && reloaded.sha256 !== row.candidate_sha256) fail('roundtrip candidate bytes mismatch');
  if (rgba && rgba.sha256 !== row.candidate_rgba_sha256) fail('roundtrip decoded RGBA mismatch');
  for (const kind of ['source', 'candidate']) {
    if (row[kind + '_format'].toLowerCase() !== 'png' || !evidence[kind]) continue;
    try {
      const png = decodePngRgba(evidence[kind].buffer);
      if (png.width !== Number(row[kind + '_width']) || png.height !== Number(row[kind + '_height'])
          || !evidence[kind + 'Rgba'] || !png.rgba.equals(evidence[kind + 'Rgba'].buffer)) fail(kind + ' PNG/probe mismatch');
    } catch { fail(kind + ' PNG cannot be decoded'); }
  }
}
