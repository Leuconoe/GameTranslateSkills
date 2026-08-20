#!/usr/bin/env node
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flag, parseArgs, requiredOption } from './lib/args.mjs';
import { parseImageManifest, serializeImageManifest } from './lib/image-manifest.mjs';
import { decodePngRgba, encodePngRgba, resizeRgbaBilinear } from './lib/png-rgba.mjs';

const imageRoot = '30_translation/image_translation/';
const algorithm = 'premultiplied-alpha-bilinear-rgba8-v1';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function isWithinRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function projectPath(projectRoot, relativePath, label) {
  const segments = relativePath?.split('/') ?? [];
  if (!relativePath || relativePath === 'N/A' || path.isAbsolute(relativePath) || relativePath.includes('\\')
      || relativePath.includes('\0') || /^[A-Za-z]:/.test(relativePath)
      || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`${label} must be a forward-slash project-relative path`);
  }
  const absolutePath = path.resolve(projectRoot, ...segments);
  if (!isWithinRoot(projectRoot, absolutePath)) throw new Error(`${label} escapes project root`);
  return absolutePath;
}

async function readEvidence(projectRoot, projectRealRoot, relativePath, label, declaredHash) {
  const absolutePath = projectPath(projectRoot, relativePath, label);
  const stat = await fs.lstat(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-link file`);
  const realPath = await fs.realpath(absolutePath);
  if (!isWithinRoot(projectRealRoot, realPath)) throw new Error(`${label} resolves outside project root`);
  const buffer = await fs.readFile(absolutePath);
  const actualHash = sha256(buffer);
  if (!/^[0-9a-f]{64}$/i.test(declaredHash ?? '') || actualHash !== declaredHash.toLowerCase()) {
    throw new Error(`${label} SHA-256 does not match the manifest`);
  }
  return { absolutePath, buffer, sha256: actualHash };
}

function positiveInteger(value, label) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} is outside the supported integer range`);
  return parsed;
}

function encodedStablePath(stableKey) {
  if (!stableKey || /[\t\r\n]/.test(stableKey)) throw new Error('stable_key is empty or invalid');
  return stableKey.split('/').map((segment) => encodeURIComponent(segment || '_')).join('/');
}

function parseEditRegions(value) {
  return value.split(';').map((part) => {
    const cells = part.split(',');
    if (cells.length !== 4 || cells.some((cell) => !/^\d+$/.test(cell))) throw new Error('edit_regions is invalid');
    const [x, y, width, height] = cells.map(Number);
    return { x, y, width, height };
  });
}

function assertNormalizedPixels(row, sourceRgba, candidateRgba, width, height) {
  const regions = parseEditRegions(row.edit_regions);
  let changedInside = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const inEditRegion = regions.some((region) => x >= region.x && x < region.x + region.width
      && y >= region.y && y < region.y + region.height);
    const alphaChanged = sourceRgba[offset + 3] !== candidateRgba[offset + 3];
    const rgbChanged = sourceRgba[offset] !== candidateRgba[offset]
      || sourceRgba[offset + 1] !== candidateRgba[offset + 1]
      || sourceRgba[offset + 2] !== candidateRgba[offset + 2];
    if (!inEditRegion && (rgbChanged || alphaChanged)) {
      throw new Error('normalized RGBA changes pixels outside edit_regions; size mismatch is not the only issue');
    }
    if (row.alpha_policy === 'exact' && alphaChanged) {
      throw new Error('normalized RGBA changes exact alpha; size mismatch is not the only issue');
    }
    if (row.alpha_policy === 'edit-region-only' && !inEditRegion && alphaChanged) {
      throw new Error('normalized RGBA changes alpha outside edit_regions; size mismatch is not the only issue');
    }
    if (inEditRegion && rgbChanged) changedInside += 1;
  }
  if (changedInside === 0) throw new Error('normalized RGBA has no RGB change inside edit_regions');
}

function runPreflightValidator(projectRoot, manifestPath) {
  const validator = path.join(path.dirname(fileURLToPath(import.meta.url)), 'validate-image-translation.mjs');
  const result = spawnSync(process.execPath, [validator, '--project-root', projectRoot, '--manifest', manifestPath], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const errors = output.split(/\r?\n/).filter((line) => line.startsWith('ERROR\t'));
  if (result.status === 0 || errors.length === 0) throw new Error('manifest does not have a validator-confirmed canvas size mismatch');
  const unrelated = errors.filter((line) => !/canvas (?:width|height) changed$/.test(line));
  if (unrelated.length > 0) {
    throw new Error(`size normalization refused because validation has non-size issue(s): ${unrelated.join(' | ')}`);
  }
}

async function assertPathAbsent(absolutePath, label) {
  try {
    await fs.lstat(absolutePath);
    throw new Error(`${label} already exists; refusing to overwrite it`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function ensureSafeDirectory(projectRoot, projectRealRoot, relativeDirectory) {
  let cursor = projectRoot;
  for (const segment of relativeDirectory.split('/').filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      const stat = await fs.lstat(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`output directory is not a regular directory: ${cursor}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.mkdir(cursor);
    }
    const realPath = await fs.realpath(cursor);
    if (!isWithinRoot(projectRealRoot, realPath)) throw new Error(`output directory resolves outside project root: ${cursor}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flag(args, 'help')) {
    console.log('Usage: node scripts/normalize-imagegen-size.mjs --project-root <project> --manifest <manifest> --stable-key <key> [--apply]');
    return;
  }
  const projectRoot = path.resolve(requiredOption(args, 'project-root'));
  const rootStat = await fs.lstat(projectRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('project root must be a regular non-link directory');
  const projectRealRoot = await fs.realpath(projectRoot);
  const manifestPath = path.resolve(requiredOption(args, 'manifest'));
  if (!isWithinRoot(projectRoot, manifestPath)) throw new Error('manifest must be inside project root');
  const manifestStat = await fs.lstat(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error('manifest must be a regular non-link file');
  if (!isWithinRoot(projectRealRoot, await fs.realpath(manifestPath))) throw new Error('manifest resolves outside project root');
  const manifestText = await fs.readFile(manifestPath, 'utf8');
  const rows = parseImageManifest(manifestText, manifestPath);
  const stableKey = requiredOption(args, 'stable-key');
  const matching = rows.filter((row) => row.stable_key === stableKey);
  if (matching.length !== 1) throw new Error(`stable_key must match exactly one manifest row; found ${matching.length}`);
  const row = matching[0];

  if (row.origin !== 'agent-generated' || row.generator !== 'imagegen' || row.tool !== 'image_gen.imagegen') {
    throw new Error('only built-in imagegen agent-generated candidates can be normalized');
  }
  if (row.candidate_path.startsWith(`${imageRoot}for_translation/normalized/`)
      || row.candidate_rgba_path.startsWith(`${imageRoot}probes/normalized/`)
      || row.receipt_path.startsWith(`${imageRoot}receipts/normalized/`)) {
    throw new Error('a normalized candidate cannot be normalized again');
  }
  if (row.source_format.toLowerCase() !== 'png' || row.candidate_format.toLowerCase() !== 'png') {
    throw new Error('size normalization supports PNG-to-PNG rows only');
  }
  if (row.source_color_mode.toLowerCase() !== 'rgba8' || row.candidate_color_mode.toLowerCase() !== 'rgba8') {
    throw new Error('size normalization supports decoded RGBA8 rows only');
  }

  const sourceWidth = positiveInteger(row.source_width, 'source_width');
  const sourceHeight = positiveInteger(row.source_height, 'source_height');
  const inputWidth = positiveInteger(row.candidate_width, 'candidate_width');
  const inputHeight = positiveInteger(row.candidate_height, 'candidate_height');
  if (sourceWidth === inputWidth && sourceHeight === inputHeight) throw new Error('candidate already matches the source canvas');
  if (BigInt(sourceWidth) * BigInt(inputHeight) !== BigInt(sourceHeight) * BigInt(inputWidth)) {
    throw new Error('candidate and source aspect ratios differ; crop, pad, or layout repair is not a simple resize');
  }

  runPreflightValidator(projectRoot, manifestPath);
  const source = await readEvidence(projectRoot, projectRealRoot, row.source_path, 'source_path', row.source_sha256);
  const reference = await readEvidence(projectRoot, projectRealRoot, row.reference_path, 'reference_path', row.reference_sha256);
  const input = await readEvidence(projectRoot, projectRealRoot, row.candidate_path, 'candidate_path', row.candidate_sha256);
  const sourceProbe = await readEvidence(projectRoot, projectRealRoot, row.source_rgba_path, 'source_rgba_path', row.source_rgba_sha256);
  const inputProbe = await readEvidence(projectRoot, projectRealRoot, row.candidate_rgba_path, 'candidate_rgba_path', row.candidate_rgba_sha256);
  const originalReceipt = await readEvidence(projectRoot, projectRealRoot, row.receipt_path, 'receipt_path', row.receipt_sha256);
  if (!source.buffer.equals(reference.buffer)) throw new Error('reference bytes no longer match source');

  const decodedSource = decodePngRgba(source.buffer);
  const decodedInput = decodePngRgba(input.buffer);
  if (decodedSource.width !== sourceWidth || decodedSource.height !== sourceHeight) throw new Error('source PNG IHDR does not match manifest dimensions');
  if (decodedInput.width !== inputWidth || decodedInput.height !== inputHeight) throw new Error('candidate PNG IHDR does not match manifest dimensions');
  if (!decodedSource.rgba.equals(sourceProbe.buffer)) throw new Error('source RGBA probe does not match decoded source PNG');
  if (!decodedInput.rgba.equals(inputProbe.buffer)) throw new Error('candidate RGBA probe does not match decoded candidate PNG');

  let receipt;
  try {
    receipt = JSON.parse(originalReceipt.buffer.toString('utf8'));
  } catch (error) {
    throw new Error(`receipt is not valid JSON (${error.message})`);
  }
  if (receipt.schema_version !== 3 || receipt.normalization !== undefined || receipt.candidate_path !== row.candidate_path
      || receipt.candidate_sha256 !== row.candidate_sha256 || receipt.selected_attempt === undefined) {
    throw new Error('size normalization requires the current schema 3 receipt and raw candidate binding');
  }
  const selectedAttempt = receipt.attempts?.find((attempt) => attempt.attempt === receipt.selected_attempt);
  if (!selectedAttempt || selectedAttempt.selection_status !== 'selected'
      || selectedAttempt.output_path !== row.candidate_path || selectedAttempt.output_sha256 !== row.candidate_sha256) {
    throw new Error('schema 3 selected attempt does not match the raw candidate');
  }

  const normalizedRgba = resizeRgbaBilinear(decodedInput.rgba, inputWidth, inputHeight, sourceWidth, sourceHeight);
  assertNormalizedPixels(row, decodedSource.rgba, normalizedRgba, sourceWidth, sourceHeight);
  const normalizedPng = encodePngRgba(sourceWidth, sourceHeight, normalizedRgba);
  const stablePath = encodedStablePath(stableKey);
  const outputRelative = `${imageRoot}for_translation/normalized/${stablePath}.png`;
  const probeRelative = `${imageRoot}probes/normalized/${stablePath}.candidate.rgba`;
  const receiptRelative = `${imageRoot}receipts/normalized/${stablePath}.json`;
  const outputAbsolute = projectPath(projectRoot, outputRelative, 'normalized candidate path');
  const probeAbsolute = projectPath(projectRoot, probeRelative, 'normalized probe path');
  const receiptAbsolute = projectPath(projectRoot, receiptRelative, 'normalized receipt path');
  await assertPathAbsent(outputAbsolute, 'normalized candidate');
  await assertPathAbsent(probeAbsolute, 'normalized probe');
  await assertPathAbsent(receiptAbsolute, 'normalized receipt');

  const normalizedReceipt = {
    ...receipt,
    schema_version: 4,
    candidate_path: outputRelative,
    candidate_sha256: sha256(normalizedPng),
    candidate_rgba_path: probeRelative,
    candidate_rgba_sha256: sha256(normalizedRgba),
    normalization: {
      status: 'applied',
      reason: 'canvas-size-only',
      tool: 'game-translate.normalize-imagegen-size',
      algorithm,
      original_receipt_path: row.receipt_path,
      original_receipt_sha256: originalReceipt.sha256,
      input_path: row.candidate_path,
      input_sha256: input.sha256,
      input_rgba_path: row.candidate_rgba_path,
      input_rgba_sha256: inputProbe.sha256,
      input_width: inputWidth,
      input_height: inputHeight,
      output_path: outputRelative,
      output_sha256: sha256(normalizedPng),
      output_rgba_path: probeRelative,
      output_rgba_sha256: sha256(normalizedRgba),
      output_width: sourceWidth,
      output_height: sourceHeight,
    },
  };
  const receiptBuffer = Buffer.from(`${JSON.stringify(normalizedReceipt, null, 2)}\n`);
  row.candidate_path = outputRelative;
  row.candidate_sha256 = sha256(normalizedPng);
  row.candidate_rgba_path = probeRelative;
  row.candidate_rgba_sha256 = sha256(normalizedRgba);
  row.candidate_width = String(sourceWidth);
  row.candidate_height = String(sourceHeight);
  row.receipt_path = receiptRelative;
  row.receipt_sha256 = sha256(receiptBuffer);
  row.notes = row.notes ? `${row.notes}; size-normalized:${algorithm}` : `size-normalized:${algorithm}`;
  const updatedManifest = serializeImageManifest(rows);

  console.log(`Stable key: ${stableKey}`);
  console.log(`Canvas: ${inputWidth}x${inputHeight} -> ${sourceWidth}x${sourceHeight}`);
  console.log(`Candidate: ${outputRelative}`);
  console.log(`Probe: ${probeRelative}`);
  console.log(`Receipt: ${receiptRelative}`);
  if (!flag(args, 'apply')) {
    console.log('Result: ELIGIBLE (dry-run; pass --apply to write new artifacts and update the manifest)');
    return;
  }

  const written = [];
  const manifestTemp = path.join(path.dirname(manifestPath), `tmp-image-size-normalization-${process.pid}-${Date.now()}.tmp`);
  try {
    for (const relativeDirectory of [path.posix.dirname(outputRelative), path.posix.dirname(probeRelative), path.posix.dirname(receiptRelative)]) {
      await ensureSafeDirectory(projectRoot, projectRealRoot, relativeDirectory);
    }
    await fs.writeFile(outputAbsolute, normalizedPng, { flag: 'wx' });
    written.push(outputAbsolute);
    await fs.writeFile(probeAbsolute, normalizedRgba, { flag: 'wx' });
    written.push(probeAbsolute);
    await fs.writeFile(receiptAbsolute, receiptBuffer, { flag: 'wx' });
    written.push(receiptAbsolute);
    await fs.writeFile(manifestTemp, updatedManifest, { flag: 'wx' });
    await fs.rename(manifestTemp, manifestPath);
  } catch (error) {
    await fs.unlink(manifestTemp).catch(() => {});
    for (const target of written.reverse()) await fs.unlink(target).catch(() => {});
    throw error;
  }
  console.log('Result: APPLIED (run image:validate; normalization never waives downstream QA)');
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exitCode = 1;
});
