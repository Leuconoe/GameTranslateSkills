#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { flag, parseArgs, requiredOption } from './lib/args.mjs';

const requiredColumns = [
  'stable_key', 'source_path', 'source_sha256', 'reference_path', 'reference_sha256',
  'candidate_path', 'candidate_sha256', 'source_rgba_path', 'source_rgba_sha256',
  'candidate_rgba_path', 'candidate_rgba_sha256', 'source_width', 'source_height',
  'candidate_width', 'candidate_height', 'source_format', 'candidate_format',
  'source_color_mode', 'candidate_color_mode', 'alpha_policy', 'edit_regions', 'source_anchors',
  'candidate_anchors', 'atlas_page', 'source_atlas_rect', 'candidate_atlas_rect',
  'origin', 'generator', 'tool', 'model', 'quality', 'generation_mode', 'prompt_path', 'prompt_sha256',
  'receipt_path', 'receipt_sha256', 'style_contract', 'atmosphere_contract',
  'style_status', 'atmosphere_status', 'original_feel_status', 'source_text_removal_status',
  'alpha_status', 'layout_status', 'korean_text_status', 'roundtrip_status', 'status', 'notes',
];

const imageRoot = '30_translation/image_translation/';
const requiredPrefixes = {
  reference_path: `${imageRoot}reference/`,
  candidate_path: `${imageRoot}for_translation/`,
  source_rgba_path: `${imageRoot}probes/`,
  candidate_rgba_path: `${imageRoot}probes/`,
  prompt_path: `${imageRoot}prompts/`,
  receipt_path: `${imageRoot}receipts/`,
};

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function parseRows(text, source) {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length < 2) throw new Error(`${source} must contain the exact header and at least one row`);
  const header = lines[0].split('\t');
  if (header.join('\t') !== requiredColumns.join('\t')) {
    throw new Error(`${source} header must exactly match common/image-translation-contract.md`);
  }
  const rows = lines.slice(1).map((line, index) => {
    const cells = line.split('\t');
    if (cells.length !== header.length) {
      throw new Error(`${source} line ${index + 2} has ${cells.length} cells; expected ${header.length}`);
    }
    const row = Object.fromEntries(header.map((column, columnIndex) => [column, cells[columnIndex]]));
    row.__line = index + 2;
    return row;
  });
  return rows;
}

function integer(value, label, row, issues, { positive = false } = {}) {
  if (!/^\d+$/.test(value)) {
    issues.push(`line ${row.__line}: ${label} must be a non-negative integer`);
    return null;
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || (positive && number < 1)) {
    issues.push(`line ${row.__line}: ${label} is outside the supported integer range`);
    return null;
  }
  return number;
}

function parseRect(value, label, row, issues) {
  const cells = value.split(',');
  if (cells.length !== 4 || cells.some((cell) => !/^\d+$/.test(cell))) {
    issues.push(`line ${row.__line}: ${label} must be x,y,width,height using non-negative integers`);
    return null;
  }
  const [x, y, width, height] = cells.map(Number);
  if (width < 1 || height < 1) {
    issues.push(`line ${row.__line}: ${label} width and height must be positive`);
    return null;
  }
  return { x, y, width, height, canonical: `${x},${y},${width},${height}` };
}

function parseRects(value, row, issues) {
  if (!value) {
    issues.push(`line ${row.__line}: edit_regions must not be empty`);
    return [];
  }
  return value.split(';').map((part, index) => parseRect(part, `edit_regions[${index}]`, row, issues)).filter(Boolean);
}

function parsePoints(value, label, row, issues) {
  if (!value) {
    issues.push(`line ${row.__line}: ${label} must not be empty`);
    return [];
  }
  return value.split(';').map((part, index) => {
    const cells = part.split(',');
    if (cells.length !== 2 || cells.some((cell) => !/^\d+$/.test(cell))) {
      issues.push(`line ${row.__line}: ${label}[${index}] must be x,y using non-negative integers`);
      return null;
    }
    const [x, y] = cells.map(Number);
    return { x, y, canonical: `${x},${y}` };
  }).filter(Boolean);
}

function isWithinRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function canonicalPathKey(target) {
  const resolved = path.resolve(target);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function fileEvidence(projectRoot, projectRealRoot, relativePath, label, row, issues) {
  const pathSegments = relativePath?.split('/') ?? [];
  if (!relativePath || relativePath === 'N/A' || path.isAbsolute(relativePath) || relativePath.includes('\\')
      || relativePath.includes('\0') || /^[A-Za-z]:/.test(relativePath)
      || pathSegments.some((segment) => !segment || segment === '.' || segment === '..')) {
    issues.push(`line ${row.__line}: ${label} must be a forward-slash project-relative path`);
    return null;
  }
  const absolutePath = path.resolve(projectRoot, ...relativePath.split('/'));
  if (!isWithinRoot(projectRoot, absolutePath)) {
    issues.push(`line ${row.__line}: ${label} escapes project root`);
    return null;
  }
  try {
    const stat = await fs.lstat(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      issues.push(`line ${row.__line}: ${label} must be a regular non-link file`);
      return null;
    }
    const realPath = await fs.realpath(absolutePath);
    if (!isWithinRoot(projectRealRoot, realPath)) {
      issues.push(`line ${row.__line}: ${label} resolves outside project root`);
      return null;
    }
    const buffer = await fs.readFile(absolutePath);
    return { absolutePath, realPath, stat, buffer, sha256: sha256(buffer) };
  } catch (error) {
    issues.push(`line ${row.__line}: cannot read ${label} ${relativePath} (${error.message})`);
    return null;
  }
}

function requireSha(value, label, row, issues) {
  if (!/^[0-9a-f]{64}$/i.test(value)) issues.push(`line ${row.__line}: ${label} must be a 64-hex SHA-256 value`);
}

function compareDeclaredHash(evidence, declared, label, row, issues) {
  requireSha(declared, label, row, issues);
  if (evidence && /^[0-9a-f]{64}$/i.test(declared) && evidence.sha256 !== declared.toLowerCase()) {
    issues.push(`line ${row.__line}: ${label} does not match current file bytes`);
  }
}

function insideAnyRegion(x, y, regions) {
  return regions.some((region) => x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height);
}

function exactReceiptField(receipt, field, expected, row, issues) {
  if (receipt?.[field] !== expected) issues.push(`line ${row.__line}: receipt ${field} does not match manifest`);
}

function parsePromptContract(text, row, issues) {
  const fields = new Map();
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (fields.has(key)) {
      issues.push(`line ${row.__line}: imagegen prompt duplicates ${key} at prompt line ${index + 1}`);
      continue;
    }
    fields.set(key, value);
  }
  return fields;
}

function requirePromptExact(fields, key, expected, row, issues) {
  if (fields.get(key) !== expected) {
    issues.push(`line ${row.__line}: imagegen prompt ${key} must equal ${expected}`);
  }
}

function requirePromptDescription(fields, key, row, issues) {
  const value = fields.get(key)?.trim() ?? '';
  if (value.length < 4 || /^(?:n\/?a|none|unknown|미확인|same|original|원본(?:과\s*)?(?:동일|그대로))$/i.test(value)) {
    issues.push(`line ${row.__line}: imagegen prompt ${key} must describe the original visual contract`);
  }
}

function isSamePhysicalFile(left, right) {
  if (!left || !right) return false;
  if (canonicalPathKey(left.realPath) === canonicalPathKey(right.realPath)) return true;
  return left.stat.dev !== 0 && left.stat.ino !== 0
    && right.stat.dev !== 0 && right.stat.ino !== 0
    && left.stat.dev === right.stat.dev && left.stat.ino === right.stat.ino;
}

async function validateAgentAttempts(receipt, row, projectRoot, projectRealRoot, protectedEntries, issues) {
  exactReceiptField(receipt, 'execution_surface', 'chatgpt-built-in', row, issues);
  exactReceiptField(receipt, 'candidate_policy', 'best-of-3-fail-closed', row, issues);
  exactReceiptField(receipt, 'minimum_candidates', 3, row, issues);

  if (!Array.isArray(receipt.attempts)) {
    issues.push(`line ${row.__line}: receipt attempts must be an array`);
    return;
  }
  if (receipt.attempts.length < 3 || receipt.attempts.length > 4) {
    issues.push(`line ${row.__line}: receipt must contain 3 or 4 independent imagegen attempts`);
  }

  const seenAttempts = new Set();
  const seenOutputPaths = new Set();
  const seenOutputHashes = new Set();
  const outputEntries = [];
  let selectedCount = 0;
  let selectedAttempt = null;
  const qaFields = [
    'technical_status', 'visual_status', 'source_text_removal_status',
    'korean_text_status', 'original_feel_status',
  ];

  for (const [index, attempt] of receipt.attempts.entries()) {
    const label = `receipt attempts[${index}]`;
    if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)) {
      issues.push(`line ${row.__line}: ${label} must be an object`);
      continue;
    }
    if (!Number.isInteger(attempt.attempt) || attempt.attempt < 1) {
      issues.push(`line ${row.__line}: ${label}.attempt must be a positive integer`);
    } else if (seenAttempts.has(attempt.attempt)) {
      issues.push(`line ${row.__line}: duplicate receipt attempt number ${attempt.attempt}`);
    } else {
      seenAttempts.add(attempt.attempt);
    }
    if (attempt.attempt !== index + 1) {
      issues.push(`line ${row.__line}: ${label}.attempt must follow contiguous 1-based order`);
    }
    for (const [field, expected] of Object.entries({
      tool: 'image_gen.imagegen',
      operation: 'edit',
      reference_path: row.reference_path,
      reference_sha256: row.reference_sha256,
      prompt_path: row.prompt_path,
      prompt_sha256: row.prompt_sha256,
      generation_status: 'completed',
    })) {
      if (attempt[field] !== expected) issues.push(`line ${row.__line}: ${label}.${field} must equal ${expected}`);
    }

    const outputPath = attempt.output_path;
    if (typeof outputPath !== 'string' || !outputPath.startsWith(`${imageRoot}for_translation/`)) {
      issues.push(`line ${row.__line}: ${label}.output_path must be under ${imageRoot}for_translation/`);
    }
    const outputPathKey = process.platform === 'win32' ? String(outputPath).toLowerCase() : String(outputPath);
    if (seenOutputPaths.has(outputPathKey)) issues.push(`line ${row.__line}: receipt attempt output paths must be unique`);
    seenOutputPaths.add(outputPathKey);
    const output = await fileEvidence(projectRoot, projectRealRoot, outputPath, `${label}.output_path`, row, issues);
    compareDeclaredHash(output, attempt.output_sha256, `${label}.output_sha256`, row, issues);
    if (/^[0-9a-f]{64}$/i.test(attempt.output_sha256 ?? '')) {
      const outputHash = attempt.output_sha256.toLowerCase();
      if (seenOutputHashes.has(outputHash)) issues.push(`line ${row.__line}: independent imagegen attempts must have distinct output hashes`);
      seenOutputHashes.add(outputHash);
    }
    if (output) {
      if (protectedEntries.some((entry) => isSamePhysicalFile(output, entry))) {
        issues.push(`line ${row.__line}: ${label}.output_path must not overwrite or hard-link source/reference/probe/receipt evidence`);
      }
      if (outputEntries.some((entry) => isSamePhysicalFile(output, entry))) {
        issues.push(`line ${row.__line}: independent imagegen attempts must be physically distinct files`);
      }
      outputEntries.push(output);
    }

    const invalidQa = qaFields.filter((field) => !['pass', 'reject'].includes(attempt[field]));
    for (const field of invalidQa) issues.push(`line ${row.__line}: ${label}.${field} must be pass or reject`);
    const allPass = qaFields.every((field) => attempt[field] === 'pass');
    const hasReject = qaFields.some((field) => attempt[field] === 'reject');
    const reasons = attempt.rejection_reasons;
    if (!Array.isArray(reasons) || reasons.some((reason) => typeof reason !== 'string' || reason.trim().length < 4)) {
      issues.push(`line ${row.__line}: ${label}.rejection_reasons must be an array of concrete strings`);
    }

    if (attempt.selection_status === 'selected') {
      selectedCount += 1;
      selectedAttempt = attempt;
      if (!allPass) issues.push(`line ${row.__line}: selected imagegen attempt must pass every QA status`);
      if (!Array.isArray(reasons) || reasons.length !== 0) issues.push(`line ${row.__line}: selected imagegen attempt must have no rejection reasons`);
    } else if (attempt.selection_status === 'qualified') {
      if (!allPass) issues.push(`line ${row.__line}: qualified imagegen attempt must pass every QA status`);
      if (!Array.isArray(reasons) || reasons.length !== 0) issues.push(`line ${row.__line}: qualified imagegen attempt must have no rejection reasons`);
    } else if (attempt.selection_status === 'rejected') {
      if (!hasReject) issues.push(`line ${row.__line}: rejected imagegen attempt must fail at least one QA status`);
      if (!Array.isArray(reasons) || reasons.length === 0) issues.push(`line ${row.__line}: rejected imagegen attempt requires a concrete rejection reason`);
    } else {
      issues.push(`line ${row.__line}: ${label}.selection_status must be selected, qualified, or rejected`);
    }
  }

  if (selectedCount !== 1) issues.push(`line ${row.__line}: receipt must select exactly one imagegen attempt`);
  if (!Number.isInteger(receipt.selected_attempt) || !seenAttempts.has(receipt.selected_attempt)) {
    issues.push(`line ${row.__line}: receipt selected_attempt must name an existing attempt`);
  }
  if (selectedAttempt) {
    if (selectedAttempt.attempt !== receipt.selected_attempt) issues.push(`line ${row.__line}: receipt selected_attempt does not match selection_status=selected`);
    if (selectedAttempt.output_path !== row.candidate_path) issues.push(`line ${row.__line}: selected imagegen output_path must equal manifest candidate_path`);
    if (selectedAttempt.output_sha256 !== row.candidate_sha256) issues.push(`line ${row.__line}: selected imagegen output_sha256 must equal manifest candidate_sha256`);
  }
}

async function validateRow(row, projectRoot, projectRealRoot, issues) {
  if (!row.stable_key || /[\t\r\n]/.test(row.stable_key)) issues.push(`line ${row.__line}: stable_key is empty or invalid`);
  for (const [field, prefix] of Object.entries(requiredPrefixes)) {
    if (field === 'prompt_path' && row.origin === 'user-supplied') continue;
    if (!row[field].startsWith(prefix)) issues.push(`line ${row.__line}: ${field} must be under ${prefix}`);
  }

  const source = await fileEvidence(projectRoot, projectRealRoot, row.source_path, 'source_path', row, issues);
  const reference = await fileEvidence(projectRoot, projectRealRoot, row.reference_path, 'reference_path', row, issues);
  const candidate = await fileEvidence(projectRoot, projectRealRoot, row.candidate_path, 'candidate_path', row, issues);
  const sourceRgba = await fileEvidence(projectRoot, projectRealRoot, row.source_rgba_path, 'source_rgba_path', row, issues);
  const candidateRgba = await fileEvidence(projectRoot, projectRealRoot, row.candidate_rgba_path, 'candidate_rgba_path', row, issues);
  const receiptEvidence = await fileEvidence(projectRoot, projectRealRoot, row.receipt_path, 'receipt_path', row, issues);

  compareDeclaredHash(source, row.source_sha256, 'source_sha256', row, issues);
  compareDeclaredHash(reference, row.reference_sha256, 'reference_sha256', row, issues);
  compareDeclaredHash(candidate, row.candidate_sha256, 'candidate_sha256', row, issues);
  compareDeclaredHash(sourceRgba, row.source_rgba_sha256, 'source_rgba_sha256', row, issues);
  compareDeclaredHash(candidateRgba, row.candidate_rgba_sha256, 'candidate_rgba_sha256', row, issues);
  compareDeclaredHash(receiptEvidence, row.receipt_sha256, 'receipt_sha256', row, issues);

  const pathEntries = [source, reference, candidate, sourceRgba, candidateRgba].filter(Boolean);
  const pathKeys = pathEntries.map((entry) => canonicalPathKey(entry.realPath));
  if (new Set(pathKeys).size !== pathKeys.length) {
    issues.push(`line ${row.__line}: source/reference/candidate/probe paths must be physically distinct`);
  }
  const fileIds = pathEntries
    .map((entry) => `${entry.stat.dev}:${entry.stat.ino}`)
    .filter((identity) => identity !== '0:0');
  if (new Set(fileIds).size !== fileIds.length) {
    issues.push(`line ${row.__line}: source/reference/candidate/probe files must not be hard-linked`);
  }
  if (source && reference && source.sha256 !== reference.sha256) {
    issues.push(`line ${row.__line}: reference bytes must exactly match the source before editing`);
  }
  if (source && candidate && source.sha256 === candidate.sha256) {
    issues.push(`line ${row.__line}: candidate is unchanged from source`);
  }

  const sourceWidth = integer(row.source_width, 'source_width', row, issues, { positive: true });
  const sourceHeight = integer(row.source_height, 'source_height', row, issues, { positive: true });
  const candidateWidth = integer(row.candidate_width, 'candidate_width', row, issues, { positive: true });
  const candidateHeight = integer(row.candidate_height, 'candidate_height', row, issues, { positive: true });
  if (sourceWidth !== null && candidateWidth !== null && sourceWidth !== candidateWidth) issues.push(`line ${row.__line}: canvas width changed`);
  if (sourceHeight !== null && candidateHeight !== null && sourceHeight !== candidateHeight) issues.push(`line ${row.__line}: canvas height changed`);
  if (!row.source_format || row.source_format.toLowerCase() !== row.candidate_format.toLowerCase()) issues.push(`line ${row.__line}: image format changed`);
  if (!row.source_color_mode || row.source_color_mode.toLowerCase() !== row.candidate_color_mode.toLowerCase()) issues.push(`line ${row.__line}: color mode changed`);

  const regions = parseRects(row.edit_regions, row, issues);
  const sourceAnchors = parsePoints(row.source_anchors, 'source_anchors', row, issues);
  const candidateAnchors = parsePoints(row.candidate_anchors, 'candidate_anchors', row, issues);
  if (sourceAnchors.length !== regions.length || candidateAnchors.length !== regions.length) {
    issues.push(`line ${row.__line}: edit region and anchor counts must match`);
  }
  if (sourceAnchors.map((point) => point.canonical).join(';') !== candidateAnchors.map((point) => point.canonical).join(';')) {
    issues.push(`line ${row.__line}: source and candidate anchors must match exactly`);
  }
  if (sourceWidth !== null && sourceHeight !== null) {
    regions.forEach((region, index) => {
      if (region.x + region.width > sourceWidth || region.y + region.height > sourceHeight) {
        issues.push(`line ${row.__line}: edit_regions[${index}] exceeds the canvas`);
      }
      const anchor = sourceAnchors[index];
      if (anchor && !insideAnyRegion(anchor.x, anchor.y, [region])) {
        issues.push(`line ${row.__line}: source_anchors[${index}] is outside its edit region`);
      }
    });
    for (let left = 0; left < regions.length; left += 1) {
      for (let right = left + 1; right < regions.length; right += 1) {
        const a = regions[left];
        const b = regions[right];
        const overlap = a.x < b.x + b.width && a.x + a.width > b.x
          && a.y < b.y + b.height && a.y + a.height > b.y;
        if (overlap) issues.push(`line ${row.__line}: edit_regions[${left}] and edit_regions[${right}] overlap`);
      }
    }
  }

  if (row.atlas_page === 'none') {
    if (row.source_atlas_rect !== 'none' || row.candidate_atlas_rect !== 'none') issues.push(`line ${row.__line}: non-atlas rows must use none for both atlas rects`);
  } else {
    integer(row.atlas_page, 'atlas_page', row, issues);
    const sourceAtlas = parseRect(row.source_atlas_rect, 'source_atlas_rect', row, issues);
    const candidateAtlas = parseRect(row.candidate_atlas_rect, 'candidate_atlas_rect', row, issues);
    if (sourceAtlas && candidateAtlas && sourceAtlas.canonical !== candidateAtlas.canonical) issues.push(`line ${row.__line}: atlas rect changed`);
  }

  let promptEvidence = null;
  if (row.origin === 'agent-generated') {
    if (row.generator !== 'imagegen' || row.generation_mode !== 'edit') {
      issues.push(`line ${row.__line}: agent-generated raster candidates require generator=imagegen and generation_mode=edit`);
    }
    if (row.tool !== 'image_gen.imagegen') {
      issues.push(`line ${row.__line}: agent-generated raster candidates require the built-in tool=image_gen.imagegen`);
    }
    if (row.model !== 'provider-selected') {
      issues.push(`line ${row.__line}: built-in imagegen candidates require model=provider-selected; do not claim an unexposed model`);
    }
    if (row.quality !== 'provider-managed') {
      issues.push(`line ${row.__line}: built-in imagegen candidates require quality=provider-managed; quality is controlled by candidate QA`);
    }
    promptEvidence = await fileEvidence(projectRoot, projectRealRoot, row.prompt_path, 'prompt_path', row, issues);
    compareDeclaredHash(promptEvidence, row.prompt_sha256, 'prompt_sha256', row, issues);
    if (promptEvidence) {
      const prompt = promptEvidence.buffer.toString('utf8');
      const fields = parsePromptContract(prompt, row, issues);
      requirePromptExact(fields, 'use_case', 'text-localization', row, issues);
      requirePromptExact(fields, 'input_image_role', 'Image 1 = edit target', row, issues);
      requirePromptExact(fields, 'tool', row.tool, row, issues);
      requirePromptExact(fields, 'execution_surface', 'chatgpt-built-in', row, issues);
      requirePromptExact(fields, 'model', row.model, row, issues);
      requirePromptExact(fields, 'quality', row.quality, row, issues);
      requirePromptExact(fields, 'candidate_policy', 'best-of-3-fail-closed', row, issues);
      requirePromptExact(fields, 'minimum_candidates', '3', row, issues);
      requirePromptExact(fields, 'reference_sha256', row.reference_sha256, row, issues);
      requirePromptExact(fields, 'remove_source_text', 'complete', row, issues);
      requirePromptExact(fields, 'no_overlay', 'true', row, issues);
      requirePromptExact(fields, 'verbatim_korean', 'true', row, issues);
      requirePromptExact(fields, 'change_only_declared_regions', 'true', row, issues);
      requirePromptExact(fields, 'preserve_unchanged_pixels', 'exact-outside-edit-regions', row, issues);
      requirePromptExact(fields, 'preserve_layout', 'exact', row, issues);
      requirePromptExact(fields, 'preserve_alpha', row.alpha_policy, row, issues);
      requirePromptExact(fields, 'edit_regions', row.edit_regions, row, issues);
      for (const key of [
        'preserve_atmosphere', 'preserve_style', 'preserve_typography', 'preserve_color',
        'preserve_outline_shadow', 'preserve_material_lighting', 'preserve_spacing_baseline',
      ]) requirePromptDescription(fields, key, row, issues);
      for (const key of ['source_text', 'korean_text']) {
        if (!(fields.get(key)?.trim())) issues.push(`line ${row.__line}: imagegen prompt ${key} must not be empty`);
      }
    }
  } else if (row.origin === 'user-supplied') {
    if (row.generator !== 'user-supplied' || row.generation_mode !== 'external') {
      issues.push(`line ${row.__line}: user-supplied candidates require matching provenance`);
    }
    if (row.tool !== 'user' || row.model !== 'N/A' || row.quality !== 'N/A') {
      issues.push(`line ${row.__line}: user-supplied candidates require tool=user and N/A model/quality`);
    }
    if (row.prompt_path !== 'N/A' || row.prompt_sha256 !== 'N/A') issues.push(`line ${row.__line}: user-supplied candidates must use N/A prompt fields`);
  } else {
    issues.push(`line ${row.__line}: origin must be agent-generated or user-supplied`);
  }

  let receipt = null;
  if (receiptEvidence) {
    try {
      receipt = JSON.parse(receiptEvidence.buffer.toString('utf8'));
    } catch (error) {
      issues.push(`line ${row.__line}: receipt is not valid JSON (${error.message})`);
    }
  }
  if (receipt) {
    exactReceiptField(receipt, 'schema_version', row.origin === 'agent-generated' ? 3 : 2, row, issues);
    exactReceiptField(receipt, 'stable_key', row.stable_key, row, issues);
    exactReceiptField(receipt, 'origin', row.origin, row, issues);
    exactReceiptField(receipt, 'generator', row.generator, row, issues);
    exactReceiptField(receipt, 'tool', row.tool, row, issues);
    exactReceiptField(receipt, 'model', row.model, row, issues);
    exactReceiptField(receipt, 'quality', row.quality, row, issues);
    exactReceiptField(receipt, 'api_endpoint', 'N/A', row, issues);
    exactReceiptField(receipt, 'input_fidelity', row.origin === 'agent-generated' ? 'provider-managed' : 'N/A', row, issues);
    exactReceiptField(receipt, 'operation', row.generation_mode, row, issues);
    exactReceiptField(receipt, 'reference_path', row.reference_path, row, issues);
    exactReceiptField(receipt, 'reference_sha256', row.reference_sha256, row, issues);
    exactReceiptField(receipt, 'prompt_path', row.prompt_path, row, issues);
    exactReceiptField(receipt, 'prompt_sha256', row.prompt_sha256, row, issues);
    exactReceiptField(receipt, 'candidate_path', row.candidate_path, row, issues);
    exactReceiptField(receipt, 'candidate_sha256', row.candidate_sha256, row, issues);
    exactReceiptField(receipt, 'source_rgba_path', row.source_rgba_path, row, issues);
    exactReceiptField(receipt, 'source_rgba_sha256', row.source_rgba_sha256, row, issues);
    exactReceiptField(receipt, 'candidate_rgba_path', row.candidate_rgba_path, row, issues);
    exactReceiptField(receipt, 'candidate_rgba_sha256', row.candidate_rgba_sha256, row, issues);
    exactReceiptField(receipt, 'alpha_policy', row.alpha_policy, row, issues);
    if (row.origin === 'agent-generated') {
      await validateAgentAttempts(
        receipt,
        row,
        projectRoot,
        projectRealRoot,
        [source, reference, sourceRgba, candidateRgba, receiptEvidence, promptEvidence].filter(Boolean),
        issues,
      );
    }
  }

  for (const field of ['style_contract', 'atmosphere_contract']) {
    if (row[field].trim().length < 8 || /^(?:n\/?a|none|unknown|미확인)$/i.test(row[field].trim())) {
      issues.push(`line ${row.__line}: ${field} must describe the original visual intent`);
    }
  }
  if (!['exact', 'edit-region-only'].includes(row.alpha_policy)) {
    issues.push(`line ${row.__line}: alpha_policy must be exact or edit-region-only`);
  }
  for (const field of [
    'style_status', 'atmosphere_status', 'original_feel_status', 'source_text_removal_status',
    'alpha_status', 'layout_status', 'korean_text_status', 'roundtrip_status',
  ]) {
    if (row[field] !== 'pass') issues.push(`line ${row.__line}: ${field} must be pass`);
  }
  if (row.status !== 'verified') issues.push(`line ${row.__line}: status must be verified`);

  if (sourceRgba && candidateRgba && sourceWidth !== null && sourceHeight !== null && sourceWidth === candidateWidth && sourceHeight === candidateHeight) {
    const expectedLength = sourceWidth * sourceHeight * 4;
    if (!Number.isSafeInteger(expectedLength)) {
      issues.push(`line ${row.__line}: RGBA probe size exceeds the supported range`);
    } else if (sourceRgba.buffer.length !== expectedLength || candidateRgba.buffer.length !== expectedLength) {
      issues.push(`line ${row.__line}: decoded RGBA probe length must equal width*height*4 (${expectedLength})`);
    } else {
      let alphaDiffPixels = 0;
      let alphaDiffOutsideRegions = 0;
      let preservedDiffPixels = 0;
      let editedRgbDiffPixels = 0;
      for (let pixel = 0; pixel < sourceWidth * sourceHeight; pixel += 1) {
        const offset = pixel * 4;
        const x = pixel % sourceWidth;
        const y = Math.floor(pixel / sourceWidth);
        const inEditRegion = insideAnyRegion(x, y, regions);
        if (sourceRgba.buffer[offset + 3] !== candidateRgba.buffer[offset + 3]) {
          alphaDiffPixels += 1;
          if (!inEditRegion) alphaDiffOutsideRegions += 1;
        }
        const rgbChanged = sourceRgba.buffer[offset] !== candidateRgba.buffer[offset]
          || sourceRgba.buffer[offset + 1] !== candidateRgba.buffer[offset + 1]
          || sourceRgba.buffer[offset + 2] !== candidateRgba.buffer[offset + 2];
        const rgbaChanged = rgbChanged || sourceRgba.buffer[offset + 3] !== candidateRgba.buffer[offset + 3];
        if (!inEditRegion && rgbaChanged) preservedDiffPixels += 1;
        if (inEditRegion && rgbChanged) editedRgbDiffPixels += 1;
      }
      if (row.alpha_policy === 'exact' && alphaDiffPixels > 0) issues.push(`line ${row.__line}: exact alpha changed at ${alphaDiffPixels} pixel(s)`);
      if (row.alpha_policy === 'edit-region-only' && alphaDiffOutsideRegions > 0) issues.push(`line ${row.__line}: alpha changed outside edit_regions at ${alphaDiffOutsideRegions} pixel(s)`);
      if (preservedDiffPixels > 0) issues.push(`line ${row.__line}: decoded RGBA changed outside edit_regions at ${preservedDiffPixels} pixel(s)`);
      if (editedRgbDiffPixels === 0) issues.push(`line ${row.__line}: no RGB change exists inside edit_regions`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flag(args, 'help')) {
    console.log('Usage: node scripts/validate-image-translation.mjs --project-root <project> --manifest <IMAGE_GENERATION_MANIFEST.tsv>');
    return;
  }
  const projectRoot = path.resolve(requiredOption(args, 'project-root'));
  const projectStat = await fs.lstat(projectRoot);
  if (!projectStat.isDirectory() || projectStat.isSymbolicLink()) throw new Error('project root must be a regular non-link directory');
  const projectRealRoot = await fs.realpath(projectRoot);
  const manifestPath = path.resolve(requiredOption(args, 'manifest'));
  if (!isWithinRoot(projectRoot, manifestPath)) throw new Error('manifest must be inside project root');
  const manifestStat = await fs.lstat(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error('manifest must be a regular non-link file');
  const manifestRealPath = await fs.realpath(manifestPath);
  if (!isWithinRoot(projectRealRoot, manifestRealPath)) throw new Error('manifest resolves outside project root');
  const rows = parseRows(await fs.readFile(manifestPath, 'utf8'), manifestPath);
  const issues = [];
  const seenStableKeys = new Set();
  const seenSourcePaths = new Set();
  const seenCandidatePaths = new Set();
  const seenReceiptPaths = new Set();
  for (const row of rows) {
    if (seenStableKeys.has(row.stable_key)) issues.push(`line ${row.__line}: duplicate stable_key ${row.stable_key}`);
    seenStableKeys.add(row.stable_key);
    for (const [field, seen] of [['source_path', seenSourcePaths], ['candidate_path', seenCandidatePaths], ['receipt_path', seenReceiptPaths]]) {
      const key = process.platform === 'win32' ? row[field].toLowerCase() : row[field];
      if (seen.has(key)) issues.push(`line ${row.__line}: duplicate ${field} ${row[field]}`);
      seen.add(key);
    }
    await validateRow(row, projectRoot, projectRealRoot, issues);
  }
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Image rows: ${rows.length}`);
  console.log(`Issues: ${issues.length}`);
  for (const issue of issues) console.log(`ERROR\t${issue}`);
  if (issues.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exitCode = 1;
});
