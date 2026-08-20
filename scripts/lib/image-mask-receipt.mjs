import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MASK_CHANNEL, MASK_POLARITY } from './image-alpha-mask.mjs';

const imageRoot = '30_translation/image_translation/';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function isWithinRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function canonicalPathKey(target) {
  const resolved = path.resolve(target);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isSamePhysicalFile(left, right) {
  if (!left || !right) return false;
  if (canonicalPathKey(left.realPath) === canonicalPathKey(right.realPath)) return true;
  return left.stat.nlink > 1 && right.stat.nlink > 1
    && left.stat.dev !== 0 && left.stat.ino !== 0
    && right.stat.dev !== 0 && right.stat.ino !== 0
    && left.stat.dev === right.stat.dev && left.stat.ino === right.stat.ino;
}

async function fileEvidence(projectRoot, projectRealRoot, relativePath, label, issues) {
  const segments = relativePath?.split('/') ?? [];
  if (!relativePath || relativePath === 'N/A' || path.isAbsolute(relativePath) || relativePath.includes('\\')
      || relativePath.includes('\0') || /^[A-Za-z]:/.test(relativePath)
      || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    issues.push(`${label} must be a forward-slash project-relative path`);
    return null;
  }
  const absolutePath = path.resolve(projectRoot, ...segments);
  if (!isWithinRoot(projectRoot, absolutePath)) {
    issues.push(`${label} escapes project root`);
    return null;
  }
  try {
    const stat = await fs.lstat(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      issues.push(`${label} must be a regular non-link file`);
      return null;
    }
    const realPath = await fs.realpath(absolutePath);
    if (!isWithinRoot(projectRealRoot, realPath)) {
      issues.push(`${label} resolves outside project root`);
      return null;
    }
    const buffer = await fs.readFile(absolutePath);
    return { absolutePath, realPath, stat, buffer, sha256: sha256(buffer) };
  } catch (error) {
    issues.push(`cannot read ${label} ${relativePath} (${error.message})`);
    return null;
  }
}

function compareHash(evidence, declared, label, issues) {
  if (!/^[0-9a-f]{64}$/i.test(declared ?? '')) {
    issues.push(`${label} must be a 64-hex SHA-256 value`);
  } else if (evidence && evidence.sha256 !== declared.toLowerCase()) {
    issues.push(`${label} does not match current file bytes`);
  }
}

function parsePrompt(text, issues) {
  const fields = new Map();
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (fields.has(key)) issues.push(`alpha mask prompt duplicates ${key} at line ${index + 1}`);
    else fields.set(key, value);
  }
  return fields;
}

export async function validateAlphaMaskReceipt({
  projectRoot, projectRealRoot, receiptPath, receiptSha256, row, protectedEvidence = [],
}) {
  const issues = [];
  if (typeof receiptPath !== 'string' || !receiptPath.startsWith(`${imageRoot}receipts/alpha_masks/`)) {
    issues.push(`alpha mask receipt_path must be under ${imageRoot}receipts/alpha_masks/`);
  }
  const receiptEvidence = await fileEvidence(projectRoot, projectRealRoot, receiptPath, 'alpha mask receipt_path', issues);
  compareHash(receiptEvidence, receiptSha256, 'alpha mask receipt_sha256', issues);
  let receipt = null;
  if (receiptEvidence) {
    try {
      receipt = JSON.parse(receiptEvidence.buffer.toString('utf8'));
    } catch (error) {
      issues.push(`alpha mask receipt is not valid JSON (${error.message})`);
    }
  }
  if (!receipt) return { issues, receiptEvidence, receipt: null, selectedAttempt: null, selectedMaskEvidence: null };

  const expected = {
    schema_version: 1,
    purpose: 'alpha-mask',
    stable_key: row.stable_key,
    origin: 'agent-generated',
    generator: 'imagegen',
    tool: 'image_gen.imagegen',
    execution_surface: 'chatgpt-built-in',
    model: 'provider-selected',
    quality: 'provider-managed',
    api_endpoint: 'N/A',
    input_fidelity: 'provider-managed',
    operation: 'edit',
    candidate_policy: 'best-of-3-fail-closed',
    minimum_candidates: 3,
    reference_path: row.candidate_path,
    reference_sha256: row.candidate_sha256,
    mask_polarity: MASK_POLARITY,
    mask_channel: MASK_CHANNEL,
    canvas_width: Number(row.source_width),
    canvas_height: Number(row.source_height),
    edit_regions: row.edit_regions,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (receipt[field] !== value) issues.push(`alpha mask receipt ${field} must equal ${value}`);
  }

  const promptEvidence = await fileEvidence(projectRoot, projectRealRoot, receipt.prompt_path, 'alpha mask prompt_path', issues);
  compareHash(promptEvidence, receipt.prompt_sha256, 'alpha mask prompt_sha256', issues);
  if (typeof receipt.prompt_path !== 'string' || !receipt.prompt_path.startsWith(`${imageRoot}prompts/alpha_masks/`)) {
    issues.push(`alpha mask prompt_path must be under ${imageRoot}prompts/alpha_masks/`);
  }
  if (promptEvidence) {
    const fields = parsePrompt(promptEvidence.buffer.toString('utf8'), issues);
    for (const [field, value] of Object.entries({
      use_case: 'alpha-mask-recovery',
      input_image_role: 'Image 1 = selected Korean candidate',
      tool: 'image_gen.imagegen',
      execution_surface: 'chatgpt-built-in',
      model: 'provider-selected',
      quality: 'provider-managed',
      candidate_policy: 'best-of-3-fail-closed',
      minimum_candidates: '3',
      reference_sha256: row.candidate_sha256,
      output_mode: 'grayscale-alpha-mask',
      mask_polarity: MASK_POLARITY,
      mask_channel: MASK_CHANNEL,
      mask_canvas: `${row.source_width}x${row.source_height}`,
      edit_regions: row.edit_regions,
      preserve_korean_glyph_edges: 'true',
      opaque_output: 'true',
    })) {
      if (fields.get(field) !== value) issues.push(`alpha mask prompt ${field} must equal ${value}`);
    }
  }

  if (!Array.isArray(receipt.attempts)) {
    issues.push('alpha mask receipt attempts must be an array');
    return { issues, receiptEvidence, receipt, promptEvidence, selectedAttempt: null, selectedMaskEvidence: null };
  }
  if (receipt.attempts.length < 3 || receipt.attempts.length > 4) {
    issues.push('alpha mask receipt must contain 3 or 4 independent imagegen attempts');
  }
  const seenNumbers = new Set();
  const seenPaths = new Set();
  const seenHashes = new Set();
  const attemptEvidence = [];
  let selectedAttempt = null;
  let selectedMaskEvidence = null;
  let selectedCount = 0;
  const qaFields = ['technical_status', 'visual_status', 'edge_status', 'transparency_intent_status'];
  for (const [index, attempt] of receipt.attempts.entries()) {
    const label = `alpha mask attempts[${index}]`;
    if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)) {
      issues.push(`${label} must be an object`);
      continue;
    }
    if (attempt.attempt !== index + 1 || seenNumbers.has(attempt.attempt)) issues.push(`${label}.attempt must use unique contiguous 1-based order`);
    seenNumbers.add(attempt.attempt);
    for (const [field, value] of Object.entries({
      tool: 'image_gen.imagegen', operation: 'edit', reference_path: row.candidate_path,
      reference_sha256: row.candidate_sha256, prompt_path: receipt.prompt_path,
      prompt_sha256: receipt.prompt_sha256, generation_status: 'completed',
    })) if (attempt[field] !== value) issues.push(`${label}.${field} must equal ${value}`);
    if (typeof attempt.output_path !== 'string' || !attempt.output_path.startsWith(`${imageRoot}alpha_masks/`)) {
      issues.push(`${label}.output_path must be under ${imageRoot}alpha_masks/`);
    }
    const pathKey = process.platform === 'win32' ? String(attempt.output_path).toLowerCase() : String(attempt.output_path);
    if (seenPaths.has(pathKey)) issues.push('alpha mask attempt output paths must be unique');
    seenPaths.add(pathKey);
    const output = await fileEvidence(projectRoot, projectRealRoot, attempt.output_path, `${label}.output_path`, issues);
    compareHash(output, attempt.output_sha256, `${label}.output_sha256`, issues);
    const hashKey = String(attempt.output_sha256).toLowerCase();
    if (seenHashes.has(hashKey)) issues.push('independent alpha mask attempts must have distinct output hashes');
    seenHashes.add(hashKey);
    if (output) {
      if (output.stat.nlink > 1) issues.push(`${label}.output_path must not be hard-linked`);
      if ([...protectedEvidence, receiptEvidence, promptEvidence, ...attemptEvidence].filter(Boolean).some((entry) => isSamePhysicalFile(output, entry))) {
        issues.push(`${label}.output_path must be physically distinct from protected evidence and other attempts`);
      }
      attemptEvidence.push(output);
    }
    for (const field of qaFields) if (!['pass', 'reject'].includes(attempt[field])) issues.push(`${label}.${field} must be pass or reject`);
    const allPass = qaFields.every((field) => attempt[field] === 'pass');
    const hasReject = qaFields.some((field) => attempt[field] === 'reject');
    const reasons = attempt.rejection_reasons;
    if (!Array.isArray(reasons) || reasons.some((reason) => typeof reason !== 'string' || reason.trim().length < 4)) {
      issues.push(`${label}.rejection_reasons must be an array of concrete strings`);
    }
    if (attempt.selection_status === 'selected') {
      selectedCount += 1;
      selectedAttempt = attempt;
      selectedMaskEvidence = output;
      if (!allPass || !Array.isArray(reasons) || reasons.length !== 0) issues.push('selected alpha mask attempt must pass every QA status with no rejection reasons');
    } else if (attempt.selection_status === 'qualified') {
      if (!allPass || !Array.isArray(reasons) || reasons.length !== 0) issues.push('qualified alpha mask attempt must pass every QA status with no rejection reasons');
    } else if (attempt.selection_status === 'rejected') {
      if (!hasReject || !Array.isArray(reasons) || reasons.length === 0) issues.push('rejected alpha mask attempt requires a failed QA status and concrete reason');
    } else {
      issues.push(`${label}.selection_status must be selected, qualified, or rejected`);
    }
  }
  if (selectedCount !== 1) issues.push('alpha mask receipt must select exactly one imagegen attempt');
  if (!selectedAttempt || receipt.selected_attempt !== selectedAttempt.attempt) issues.push('alpha mask selected_attempt must match selection_status=selected');
  if (selectedAttempt && (receipt.mask_path !== selectedAttempt.output_path || receipt.mask_sha256 !== selectedAttempt.output_sha256)) {
    issues.push('alpha mask receipt mask path/hash must match the selected attempt');
  }
  return { issues, receiptEvidence, receipt, promptEvidence, selectedAttempt, selectedMaskEvidence, attemptEvidence };
}
