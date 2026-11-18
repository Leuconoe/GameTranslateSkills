#!/usr/bin/env node
// Move one title folder between zones (_working/_complete/_waitng/_hold/_archive) and update its registry row.
// Usage: node scripts/title-move.mjs --titles-root <dir> --tid <base TID> --to <_zone> [--status "<status>"] [--dry-run]
// Refuses: reparse points (junction/symlink) anywhere in the tree, an existing destination, a cross-volume move,
// a status the target zone does not allow. Same-volume rename only (no copy, no links). Registry written LF, then
// registry:check runs; a failed registry write renames the folder back.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkRegistry, stateOf, ZONES } from './check-game-registry.mjs';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';

export function reparsePoints(dir, limit = 20) {
  const found = [];
  const stack = [dir];
  while (stack.length && found.length < limit) {
    const d = stack.pop();
    if (fs.lstatSync(d).isSymbolicLink()) { found.push(d); continue; } // Node reports junctions as symlinks
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) found.push(p);
      else if (e.isDirectory()) stack.push(p);
    }
  }
  return found;
}

export function moveTitle({ root, tid, to, status, dryRun = false }) {
  if (!(to in ZONES)) throw new Error(`--to must be one of ${Object.keys(ZONES).join(', ')}`);
  const regFile = path.join(root, 'GAME_REGISTRY.tsv');
  const raw = fs.readFileSync(regFile, 'utf8');
  const bom = raw.startsWith('﻿');
  const lines = raw.replace(/^﻿/, '').split(/\r?\n/);
  while (lines.at(-1) === '') lines.pop();
  const header = lines[0].split('\t');
  const col = (c) => header.indexOf(c);
  const i = lines.findIndex((l, n) => n > 0 && (l.split('\t')[col('base_title_id')] ?? '').toUpperCase() === tid.toUpperCase());
  if (i < 0) throw new Error(`${tid} not in registry`);
  const cells = lines[i].split('\t');
  const rel = cells[col('release_folder')].replace(/\\/g, '/');
  const src = path.join(root, rel);
  const dst = path.join(root, to, path.basename(rel));
  const newStatus = status ?? cells[col('status')];
  const allowed = ZONES[to];
  if (allowed && !allowed.includes(stateOf(newStatus))) throw new Error(`${to} expects status ${allowed.join('|')}; pass --status`);
  if (!allowed && ['complete', 'removed'].includes(stateOf(newStatus))) throw new Error(`${to} cannot hold status '${stateOf(newStatus)}'; pass --status`);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) throw new Error(`source folder missing: ${src}`);
  if (fs.existsSync(dst)) throw new Error(`destination exists: ${dst}`);
  if (path.parse(path.resolve(src)).root.toLowerCase() !== path.parse(path.resolve(dst)).root.toLowerCase()) throw new Error('cross-volume move refused');
  const links = reparsePoints(src);
  if (links.length) throw new Error(`reparse points inside (protected; resolve first):\n  ${links.join('\n  ')}`);
  cells[col('release_folder')] = `${to}/${path.basename(rel)}`;
  cells[col('status')] = newStatus;
  lines[i] = cells.join('\t');
  const plan = `${rel} -> ${cells[col('release_folder')]} | status: ${newStatus}`;
  if (dryRun) return { plan, errors: [] };
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.renameSync(src, dst);
  try {
    const tmp = `${regFile}.tmp`;
    fs.writeFileSync(tmp, (bom ? '﻿' : '') + lines.join('\n') + '\n');
    fs.renameSync(tmp, regFile);
  } catch (error) {
    fs.renameSync(dst, src);
    throw error;
  }
  return { plan, errors: checkRegistry(root).errors };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const r = moveTitle({
      root: path.resolve(option(args, 'titles-root') ?? process.env.GT_TITLES_ROOT ?? requiredOption(args, 'titles-root')),
      tid: requiredOption(args, 'tid'),
      to: requiredOption(args, 'to'),
      status: option(args, 'status'),
      dryRun: flag(args, 'dry-run'),
    });
    console.log(`${flag(args, 'dry-run') ? 'DRY ' : ''}moved ${r.plan}`);
    for (const e of r.errors) console.log(`ERROR ${e}`);
    console.log(`registry:check ${r.errors.length} error(s)`);
    process.exit(r.errors.length ? 1 : 0);
  } catch (error) {
    console.error(`REFUSED ${error.message}`);
    process.exit(2);
  }
}
