#!/usr/bin/env node
// One line per registered title: translated rows + resume point, latest 40_build dir, Eden verdict, release ZIP + hash8.
// Usage: node scripts/project-status.mjs --titles-root <dir> [--zone _working] [--tid <TID>] [--no-hash]
// Read-only. Hashes go through the shared path+size+mtime cache (scripts/lib/hash-cache.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stateOf } from './check-game-registry.mjs';
import { cachedSha256 } from './lib/hash-cache.mjs';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';

const read = (p) => fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
const newest = (dir, test) => {
  if (!fs.existsSync(dir)) return null;
  const c = fs.readdirSync(dir, { withFileTypes: true }).filter(test).map((e) => path.join(dir, e.name));
  return c.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null;
};

export function textProgress(work) {
  const t = path.join(work, '30_translation');
  const man = path.join(t, 'text', 'translation_manifest.tsv');
  if (!fs.existsSync(man)) return 'tr -';
  const lines = read(man).split(/\r?\n/).filter(Boolean);
  const hdr = lines[0].split('\t');
  const [si, ii] = [hdr.indexOf('status'), hdr.indexOf('id')];
  const rows = lines.slice(1).map((l) => l.split('\t'));
  const done = rows.filter((r) => (r[si] ?? '').startsWith('translated')).length;
  let out = `tr ${done}/${rows.length}`;
  const src = path.join(t, 'exports', 'source', 'bulk_source.txt');
  const outDir = path.join(t, 'text', 'batches', 'bulk', 'out');
  if (done < rows.length && fs.existsSync(src)) {
    const have = new Set();
    if (fs.existsSync(outDir)) {
      for (const f of fs.readdirSync(outDir)) {
        if (!/^P.*\.tsv$/.test(f) || /^P[ZS]_/.test(f)) continue;
        for (const l of read(path.join(outDir, f)).split(/\r?\n/)) if (/^\d+\t/.test(l)) have.add(Number(l.split('\t')[0]));
      }
    }
    const hfu = path.join(t, 'text', 'HELD_FOR_USER.tsv');
    if (fs.existsSync(hfu)) {
      const ids = new Set(read(hfu).split(/\r?\n/).slice(1).map((l) => l.split('\t')[0]));
      rows.forEach((r, n) => { if (ids.has(r[ii])) have.add(n + 1); });
    }
    const ns = read(src).split(/\r?\n/).filter(Boolean).map((l) => Number(l.split(/[\t|]/)[0]));
    const left = ns.filter((n) => !have.has(n));
    out += left.length ? ` next n ${left[0]} (${left.length}/${ns.length} left)` : ' parts done';
  }
  return out;
}

export function edenVerdict(work) {
  const f = newest(path.join(work, '50_test'), (e) => e.isFile() && /^EDEN_QA_.*\.md$/.test(e.name));
  if (!f) return 'eden -';
  const m = read(f).match(/(미완수|완수|PASS|FAIL)/);
  return `eden ${m ? m[1] : '?'} (${path.basename(f)})`;
}

export async function titleStatus(root, row, { hash = true } = {}) {
  const dir = path.join(root, row.release_folder);
  const work = path.join(dir, ...row.project_path.split(/[\\/]/));
  const build = newest(path.join(work, '40_build'), (e) => e.isDirectory() && !/^(\.|superseded)/.test(e.name));
  const rel = path.join(dir, '_release');
  const zip = newest(rel, (e) => e.isFile() && e.name.endsWith('.zip'));
  const zipText = zip ? `zip ${path.basename(zip)} ${hash ? (await cachedSha256(zip)).slice(0, 8).toUpperCase() : ''}`.trim() : 'zip -';
  return [row.base_title_id, stateOf(row.status).split(/\s/)[0], textProgress(work), `build ${build ? path.basename(build) : '-'}`,
    edenVerdict(work), zipText].join(' | ');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(option(args, 'titles-root') ?? process.env.GT_TITLES_ROOT ?? requiredOption(args, 'titles-root'));
  const lines = read(path.join(root, 'GAME_REGISTRY.tsv')).split(/\r?\n/).filter(Boolean);
  const hdr = lines[0].split('\t');
  const rows = lines.slice(1).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [hdr[i], v.trim()])));
  const zone = option(args, 'zone');
  const tid = option(args, 'tid')?.toUpperCase();
  for (const r of rows) {
    if (stateOf(r.status) === 'removed' || (tid && r.base_title_id.toUpperCase() !== tid)) continue;
    if (zone && r.release_folder.replace(/\\/g, '/').split('/')[0] !== zone) continue;
    if (!fs.existsSync(path.join(root, r.release_folder))) { console.log(`${r.base_title_id} | folder missing`); continue; }
    console.log(await titleStatus(root, r, { hash: !flag(args, 'no-hash') }));
  }
}
