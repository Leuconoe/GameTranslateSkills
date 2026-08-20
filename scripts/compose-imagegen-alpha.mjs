#!/usr/bin/env node
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flag, parseArgs, requiredOption } from './lib/args.mjs';
import {
  ALPHA_COMPOSITION_ALGORITHM, composeAlphaMask, parseEditRegions,
} from './lib/image-alpha-mask.mjs';
import { parseImageManifest, serializeImageManifest } from './lib/image-manifest.mjs';
import { validateAlphaMaskReceipt } from './lib/image-mask-receipt.mjs';
import { decodePngRgba, encodePngRgba } from './lib/png-rgba.mjs';

const imageRoot = '30_translation/image_translation/';

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

async function readEvidence(projectRoot, projectRealRoot, relativePath, label, declaredHash = null) {
  const absolutePath = projectPath(projectRoot, relativePath, label);
  const stat = await fs.lstat(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-link file`);
  const realPath = await fs.realpath(absolutePath);
  if (!isWithinRoot(projectRealRoot, realPath)) throw new Error(`${label} resolves outside project root`);
  const buffer = await fs.readFile(absolutePath);
  const actualHash = sha256(buffer);
  if (declaredHash !== null && (!/^[0-9a-f]{64}$/i.test(declaredHash) || actualHash !== declaredHash.toLowerCase())) {
    throw new Error(`${label} SHA-256 does not match the manifest`);
  }
  return { absolutePath, realPath, stat, buffer, sha256: actualHash };
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

function runPreflightValidator(projectRoot, manifestPath) {
  const validator = path.join(path.dirname(fileURLToPath(import.meta.url)), 'validate-image-translation.mjs');
  const result = spawnSync(process.execPath, [validator, '--project-root', projectRoot, '--manifest', manifestPath], {
    encoding: 'utf8', windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status === 0) return;
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const errors = output.split(/\r?\n/).filter((line) => line.startsWith('ERROR\t'));
  if (errors.length === 0) throw new Error('image validator failed without structured issues');
  const allowed = [
    /alpha changed outside edit_regions at \d+ pixel\(s\)$/,
    /decoded RGBA changed outside edit_regions at \d+ pixel\(s\)$/,
  ];
  const unrelated = errors.filter((line) => !allowed.some((pattern) => pattern.test(line)));
  if (unrelated.length > 0) {
    throw new Error(`alpha composition refused because validation has non-alpha issue(s): ${unrelated.join(' | ')}`);
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
    console.log('Usage: node scripts/compose-imagegen-alpha.mjs --project-root <project> --manifest <manifest> --stable-key <key> --mask-receipt <project-relative-json> [--apply]');
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
  const rows = parseImageManifest(await fs.readFile(manifestPath, 'utf8'), manifestPath);
  const stableKey = requiredOption(args, 'stable-key');
  const matching = rows.filter((row) => row.stable_key === stableKey);
  if (matching.length !== 1) throw new Error(`stable_key must match exactly one manifest row; found ${matching.length}`);
  const row = matching[0];
  if (row.origin !== 'agent-generated' || row.generator !== 'imagegen' || row.tool !== 'image_gen.imagegen') {
    throw new Error('only built-in imagegen agent-generated candidates can use alpha composition');
  }
  if (row.alpha_policy !== 'edit-region-only') throw new Error('alpha composition requires alpha_policy=edit-region-only');
  if (row.source_format.toLowerCase() !== 'png' || row.candidate_format.toLowerCase() !== 'png'
      || row.source_color_mode.toLowerCase() !== 'rgba8' || row.candidate_color_mode.toLowerCase() !== 'rgba8') {
    throw new Error('alpha composition supports PNG decoded as RGBA8 only');
  }
  if (row.candidate_path.startsWith(`${imageRoot}for_translation/composed/`)
      || row.candidate_rgba_path.startsWith(`${imageRoot}probes/composed/`)
      || row.receipt_path.startsWith(`${imageRoot}receipts/composed/`)) {
    throw new Error('an alpha-composed candidate cannot be composed again');
  }
  const width = positiveInteger(row.source_width, 'source_width');
  const height = positiveInteger(row.source_height, 'source_height');
  if (positiveInteger(row.candidate_width, 'candidate_width') !== width
      || positiveInteger(row.candidate_height, 'candidate_height') !== height) {
    throw new Error('alpha composition requires an already matching canvas; normalize size first when eligible');
  }
  const regions = parseEditRegions(row.edit_regions);
  for (const [index, region] of regions.entries()) {
    if (region.x + region.width > width || region.y + region.height > height) throw new Error(`edit_regions[${index}] exceeds the canvas`);
  }
  runPreflightValidator(projectRoot, manifestPath);

  const source = await readEvidence(projectRoot, projectRealRoot, row.source_path, 'source_path', row.source_sha256);
  const reference = await readEvidence(projectRoot, projectRealRoot, row.reference_path, 'reference_path', row.reference_sha256);
  const input = await readEvidence(projectRoot, projectRealRoot, row.candidate_path, 'candidate_path', row.candidate_sha256);
  const sourceProbe = await readEvidence(projectRoot, projectRealRoot, row.source_rgba_path, 'source_rgba_path', row.source_rgba_sha256);
  const inputProbe = await readEvidence(projectRoot, projectRealRoot, row.candidate_rgba_path, 'candidate_rgba_path', row.candidate_rgba_sha256);
  const priorReceiptEvidence = await readEvidence(projectRoot, projectRealRoot, row.receipt_path, 'receipt_path', row.receipt_sha256);
  if (!source.buffer.equals(reference.buffer)) throw new Error('reference bytes no longer match source');
  const decodedSource = decodePngRgba(source.buffer);
  const decodedInput = decodePngRgba(input.buffer);
  if (decodedSource.width !== width || decodedSource.height !== height || !decodedSource.rgba.equals(sourceProbe.buffer)) {
    throw new Error('source PNG IHDR/decoded RGBA does not match manifest evidence');
  }
  if (decodedInput.width !== width || decodedInput.height !== height || !decodedInput.rgba.equals(inputProbe.buffer)) {
    throw new Error('candidate PNG IHDR/decoded RGBA does not match manifest evidence');
  }
  let priorReceipt;
  try {
    priorReceipt = JSON.parse(priorReceiptEvidence.buffer.toString('utf8'));
  } catch (error) {
    throw new Error(`receipt is not valid JSON (${error.message})`);
  }
  if (![3, 4].includes(priorReceipt.schema_version) || priorReceipt.alpha_composition !== undefined
      || priorReceipt.candidate_path !== row.candidate_path || priorReceipt.candidate_sha256 !== row.candidate_sha256
      || priorReceipt.candidate_rgba_path !== row.candidate_rgba_path
      || priorReceipt.candidate_rgba_sha256 !== row.candidate_rgba_sha256) {
    throw new Error('alpha composition requires a current schema 3 or schema 4 candidate receipt');
  }
  const selectedImagegenAttempt = priorReceipt.attempts?.find((attempt) => attempt.attempt === priorReceipt.selected_attempt);
  if (!selectedImagegenAttempt || selectedImagegenAttempt.selection_status !== 'selected') {
    throw new Error('prior receipt selected imagegen attempt is missing');
  }

  const maskReceiptPath = requiredOption(args, 'mask-receipt');
  const maskReceiptInput = await readEvidence(projectRoot, projectRealRoot, maskReceiptPath, 'mask receipt_path');
  const maskValidation = await validateAlphaMaskReceipt({
    projectRoot,
    projectRealRoot,
    receiptPath: maskReceiptPath,
    receiptSha256: maskReceiptInput.sha256,
    row,
    protectedEvidence: [source, reference, input, sourceProbe, inputProbe, priorReceiptEvidence],
  });
  if (maskValidation.issues.length > 0) throw new Error(`alpha mask receipt is invalid: ${maskValidation.issues.join(' | ')}`);
  const decodedMask = decodePngRgba(maskValidation.selectedMaskEvidence.buffer);
  if (decodedMask.width !== width || decodedMask.height !== height) throw new Error('selected alpha mask canvas must match source exactly');
  const composed = composeAlphaMask({
    sourceRgba: decodedSource.rgba,
    candidateRgba: decodedInput.rgba,
    maskRgba: decodedMask.rgba,
    width,
    height,
    regions,
  });
  if (composed.metrics.rgbDriftOutsideRegions > 0) {
    throw new Error(`candidate RGB changed outside edit_regions at ${composed.metrics.rgbDriftOutsideRegions} pixel(s); alpha composition cannot hide RGB drift`);
  }
  if (composed.metrics.nonOpaqueMaskPixels > 0) {
    throw new Error(`alpha mask must be an opaque PNG; ${composed.metrics.nonOpaqueMaskPixels} edit-region pixel(s) have non-255 alpha`);
  }
  if (composed.metrics.grayscaleDriftPixels > 0) {
    throw new Error(`alpha mask exceeds grayscale tolerance at ${composed.metrics.grayscaleDriftPixels} edit-region pixel(s)`);
  }
  if (composed.metrics.changedAlphaPixels === 0) throw new Error('alpha mask does not change candidate alpha inside edit_regions');

  const outputPng = encodePngRgba(width, height, composed.rgba);
  const stablePath = encodedStablePath(stableKey);
  const outputRelative = `${imageRoot}for_translation/composed/${stablePath}.png`;
  const probeRelative = `${imageRoot}probes/composed/${stablePath}.candidate.rgba`;
  const receiptRelative = `${imageRoot}receipts/composed/${stablePath}.json`;
  const outputAbsolute = projectPath(projectRoot, outputRelative, 'composed candidate path');
  const probeAbsolute = projectPath(projectRoot, probeRelative, 'composed probe path');
  const receiptAbsolute = projectPath(projectRoot, receiptRelative, 'composed receipt path');
  await assertPathAbsent(outputAbsolute, 'composed candidate');
  await assertPathAbsent(probeAbsolute, 'composed probe');
  await assertPathAbsent(receiptAbsolute, 'composed receipt');

  const composedReceipt = {
    ...priorReceipt,
    schema_version: 5,
    candidate_path: outputRelative,
    candidate_sha256: sha256(outputPng),
    candidate_rgba_path: probeRelative,
    candidate_rgba_sha256: sha256(composed.rgba),
    alpha_composition: {
      status: 'applied',
      reason: 'imagegen-alpha-loss',
      tool: 'game-translate.compose-imagegen-alpha',
      algorithm: ALPHA_COMPOSITION_ALGORITHM,
      prior_receipt_path: row.receipt_path,
      prior_receipt_sha256: priorReceiptEvidence.sha256,
      input_path: row.candidate_path,
      input_sha256: input.sha256,
      input_rgba_path: row.candidate_rgba_path,
      input_rgba_sha256: inputProbe.sha256,
      selected_imagegen_output_path: selectedImagegenAttempt.output_path,
      selected_imagegen_output_sha256: selectedImagegenAttempt.output_sha256,
      mask_receipt_path: maskReceiptPath,
      mask_receipt_sha256: maskReceiptInput.sha256,
      mask_path: maskValidation.receipt.mask_path,
      mask_sha256: maskValidation.receipt.mask_sha256,
      mask_polarity: maskValidation.receipt.mask_polarity,
      mask_channel: maskValidation.receipt.mask_channel,
      input_width: width,
      input_height: height,
      output_path: outputRelative,
      output_sha256: sha256(outputPng),
      output_rgba_path: probeRelative,
      output_rgba_sha256: sha256(composed.rgba),
      output_width: width,
      output_height: height,
    },
  };
  const receiptBuffer = Buffer.from(`${JSON.stringify(composedReceipt, null, 2)}\n`);
  row.candidate_path = outputRelative;
  row.candidate_sha256 = sha256(outputPng);
  row.candidate_rgba_path = probeRelative;
  row.candidate_rgba_sha256 = sha256(composed.rgba);
  row.receipt_path = receiptRelative;
  row.receipt_sha256 = sha256(receiptBuffer);
  row.alpha_status = 'pass';
  row.status = 'verified';
  row.notes = row.notes ? `${row.notes}; alpha-composed:${ALPHA_COMPOSITION_ALGORITHM}` : `alpha-composed:${ALPHA_COMPOSITION_ALGORITHM}`;
  const updatedManifest = serializeImageManifest(rows);

  console.log(`Stable key: ${stableKey}`);
  console.log(`Mask: ${maskValidation.receipt.mask_path}`);
  console.log(`Candidate: ${outputRelative}`);
  console.log(`Probe: ${probeRelative}`);
  console.log(`Receipt: ${receiptRelative}`);
  if (!flag(args, 'apply')) {
    console.log('Result: ELIGIBLE (dry-run; pass --apply to compose alpha and update the manifest)');
    return;
  }

  const written = [];
  const manifestTemp = path.join(path.dirname(manifestPath), `tmp-image-alpha-composition-${process.pid}-${Date.now()}.tmp`);
  try {
    for (const relativeDirectory of [path.posix.dirname(outputRelative), path.posix.dirname(probeRelative), path.posix.dirname(receiptRelative)]) {
      await ensureSafeDirectory(projectRoot, projectRealRoot, relativeDirectory);
    }
    await fs.writeFile(outputAbsolute, outputPng, { flag: 'wx' });
    written.push(outputAbsolute);
    await fs.writeFile(probeAbsolute, composed.rgba, { flag: 'wx' });
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
  console.log('Result: APPLIED (run image:validate; alpha composition never waives downstream QA)');
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exitCode = 1;
});
