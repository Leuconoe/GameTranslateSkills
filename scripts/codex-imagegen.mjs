#!/usr/bin/env node
// Reusable Codex imagegen broker: one call = one imagegen edit attempt on one image.
// usage: node scripts/codex-imagegen.mjs --src <png> --out <png> --ja "<JA>" --ko "<KO>"
//          [--style "<fill/outline/shadow notes>"] [--region x,y,w,h] [--receipt <jsonl>] [--attempt N]
//          [--timeout-sec 600] [--codex codex]
// - Runs `codex exec` in a bracket-free temp dir (the Codex sandbox can't start a shell under [...] paths).
// - Resizes the result to the source canvas; with --region only that rectangle is taken from the result,
//   every other pixel (and the source alpha outside it) is kept byte-identical.
// - Appends one JSON line to --receipt (provenance) and prints one JSON line. Exit 1 if no image came back
//   (that run is not an attempt; record it as a preflight failure).
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { option, parseArgs, requiredOption } from './lib/args.mjs';
import { decodePngRgba, encodePngRgba, resizeRgbaBilinear } from './lib/png-rgba.mjs';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

export function buildPrompt({ ja, ko, style, width, height }) {
  return 'Use your built-in image generation tool to edit the attached image: replace ONLY the Japanese lettering '
    + `「${ja}」 with the Korean 「${ko}」 in exactly the same lettering style`
    + (style ? ` (${style})` : '')
    + `. Keep every non-text pixel, ornament, layout, colors, the ${width}x${height} canvas and transparency unchanged. `
    + 'Save the result as out.png in the current directory. Reply only with the saved path.';
}

export function compositeRegion(src, gen, region) {
  const out = Buffer.from(src.rgba);
  const [x0, y0, w, h] = region;
  for (let y = Math.max(0, y0); y < Math.min(src.height, y0 + h); y += 1) {
    const start = (y * src.width + Math.max(0, x0)) * 4;
    const end = (y * src.width + Math.min(src.width, x0 + w)) * 4;
    gen.copy(out, start, start, end);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const src = path.resolve(requiredOption(args, 'src'));
  const out = path.resolve(requiredOption(args, 'out'));
  const ja = requiredOption(args, 'ja');
  const ko = requiredOption(args, 'ko');
  const style = option(args, 'style');
  const region = option(args, 'region')?.split(',').map(Number);
  const receipt = option(args, 'receipt');
  const attempt = Number(option(args, 'attempt') ?? 1);
  const timeoutMs = Number(option(args, 'timeout-sec') ?? 600) * 1000;
  const codex = option(args, 'codex') ?? 'codex';

  const srcBuf = fs.readFileSync(src);
  const srcImg = decodePngRgba(srcBuf);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-imagegen-'));
  fs.copyFileSync(src, path.join(work, 'in.png'));
  const prompt = buildPrompt({ ja, ko, style, width: srcImg.width, height: srcImg.height });
  // -i is variadic and would swallow a trailing prompt, so the prompt goes first.
  const run = spawnSync(codex, ['exec', '--skip-git-repo-check', '-s', 'workspace-write', '-C', work,
    prompt, '-i', path.join(work, 'in.png')], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });

  const pngs = fs.readdirSync(work).filter((f) => f.toLowerCase().endsWith('.png') && f !== 'in.png');
  const genName = pngs.includes('out.png') ? 'out.png' : pngs.sort((a, b) =>
    fs.statSync(path.join(work, b)).mtimeMs - fs.statSync(path.join(work, a)).mtimeMs)[0];
  const record = { time: new Date().toISOString(), src, src_sha256: sha256(srcBuf), ja, ko, style, region,
    attempt, prompt, codex_exit: run.status, codex_error: run.error?.message,
    codex_tail: `${run.stdout ?? ''}${run.stderr ?? ''}`.slice(-600), work };
  if (!genName) {
    record.result = 'no-image (preflight failure, not counted as an attempt)';
  } else {
    const genBuf = fs.readFileSync(path.join(work, genName));
    const gen = decodePngRgba(genBuf);
    let rgba = gen.width === srcImg.width && gen.height === srcImg.height
      ? Buffer.from(gen.rgba)
      : Buffer.from(resizeRgbaBilinear(gen.rgba, gen.width, gen.height, srcImg.width, srcImg.height));
    if (region) rgba = compositeRegion(srcImg, rgba, region);
    const outBuf = encodePngRgba(srcImg.width, srcImg.height, rgba);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(`${out}.tmp`, outBuf);
    fs.renameSync(`${out}.tmp`, out);
    Object.assign(record, { result: 'ok', origin: 'imagegen', raw: path.join(work, genName),
      raw_sha256: sha256(genBuf), raw_size: [gen.width, gen.height], out, out_sha256: sha256(outBuf) });
  }
  if (receipt) fs.appendFileSync(receipt, `${JSON.stringify(record)}\n`);
  console.log(JSON.stringify({ result: record.result, out: record.out, out_sha256: record.out_sha256 }));
  process.exit(record.result === 'ok' ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
