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
  'origin', 'generator', 'generation_mode', 'prompt_path', 'prompt_sha256',
  'receipt_path', 'receipt_sha256', 'style_contract', 'atmosphere_contract',
  'style_status', 'atmosphere_status', 'alpha_status', 'layout_status', 'korean_text_status',
  'roundtrip_status', 'status', 'notes',
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
    promptEvidence = await fileEvidence(projectRoot, projectRealRoot, row.prompt_path, 'prompt_path', row, issues);
    compareDeclaredHash(promptEvidence, row.prompt_sha256, 'prompt_sha256', row, issues);
    if (promptEvidence) {
      const prompt = promptEvidence.buffer.toString('utf8');
      const requiredPromptText = [
        `reference_sha256: ${row.reference_sha256}`,
        'preserve_atmosphere:',
        'preserve_style:',
        'preserve_layout: exact',
        `preserve_alpha: ${row.alpha_policy}`,
        `edit_regions: ${row.edit_regions}`,
        'korean_text:',
      ];
      for (const phrase of requiredPromptText) if (!prompt.includes(phrase)) issues.push(`line ${row.__line}: imagegen prompt is missing ${phrase}`);
    }
  } else if (row.origin === 'user-supplied') {
    if (row.generator !== 'user-supplied' || row.generation_mode !== 'external') {
      issues.push(`line ${row.__line}: user-supplied candidates require matching provenance`);
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
    exactReceiptField(receipt, 'schema_version', 1, row, issues);
    exactReceiptField(receipt, 'stable_key', row.stable_key, row, issues);
    exactReceiptField(receipt, 'origin', row.origin, row, issues);
    exactReceiptField(receipt, 'generator', row.generator, row, issues);
    exactReceiptField(receipt, 'tool', row.origin === 'agent-generated' ? 'image_gen.imagegen' : 'user', row, issues);
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
  }

  for (const field of ['style_contract', 'atmosphere_contract']) {
    if (row[field].trim().length < 8 || /^(?:n\/?a|none|unknown|미확인)$/i.test(row[field].trim())) {
      issues.push(`line ${row.__line}: ${field} must describe the original visual intent`);
    }
  }
  if (!['exact', 'edit-region-only'].includes(row.alpha_policy)) {
    issues.push(`line ${row.__line}: alpha_policy must be exact or edit-region-only`);
  }
  for (const field of ['style_status', 'atmosphere_status', 'alpha_status', 'layout_status', 'korean_text_status', 'roundtrip_status']) {
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
