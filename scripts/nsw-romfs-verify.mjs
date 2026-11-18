#!/usr/bin/env node
// Verify an extracted NSW RomFS directory against the nstool --fstree listing of its NCA (path set, both ways).
// Usage: node scripts/nsw-romfs-verify.mjs --extract <dir> (--listing <fstree.txt> [--listing <update fstree.txt>] | --nca <program.nca> --keys <prod.keys>
//        [--nstool <nstool.exe>]) [--partition 1]
// The keys file is only passed to nstool by path; it is never read or printed here, and nstool output is not echoed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { option, parseArgs, requiredOption } from './lib/args.mjs';

/** nstool tree: one leading space per depth, directories end with '/'; root line is '<name>:/'. */
export function parseFsTree(text, partition = '1') {
  const files = [];
  const stack = [];
  let inTree = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\[.*Tree\]$/.test(line)) { inTree = true; continue; }
    if (!inTree || !line.trim()) continue;
    if (line.startsWith('[')) { inTree = false; continue; }
    const depth = line.length - line.trimStart().length;
    const name = line.trim();
    if (name.endsWith(':/')) continue; // root, depth 1
    stack.length = depth - 2;
    if (name.endsWith('/')) stack.push(name.slice(0, -1));
    else if (stack[0] === partition) files.push([...stack.slice(1), name].join('/'));
  }
  return files;
}

export function diskFiles(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name), `${rel}${e.name}/`);
      else out.push(rel + e.name);
    }
  };
  walk(dir, '');
  return out;
}

export function compare(listed, onDisk) {
  const a = new Set(listed);
  const b = new Set(onDisk);
  return { missing: listed.filter((p) => !b.has(p)), extra: onDisk.filter((p) => !a.has(p)) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const extract = requiredOption(args, 'extract');
  let text;
  const listings = [option(args, 'listing') ?? []].flat(); // repeatable: base + update NCA listings are unioned
  if (listings.length) text = listings.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  else {
    const exe = option(args, 'nstool') ?? 'nstool';
    const r = spawnSync(exe, ['-k', requiredOption(args, 'keys'), '--fstree', requiredOption(args, 'nca')], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0 || !/Tree\]/.test(r.stdout)) { console.error(`nstool failed (exit ${r.status}); check --nca/--keys paths`); process.exit(2); }
    text = r.stdout;
  }
  const listed = [...new Set(parseFsTree(text, option(args, 'partition') ?? '1'))];
  if (!listed.length) { console.error('listing has no files in the selected partition'); process.exit(2); }
  const { missing, extra } = compare(listed, diskFiles(extract));
  for (const p of [...missing.map((x) => `MISSING ${x}`), ...extra.map((x) => `EXTRA ${x}`)].slice(0, 20)) console.log(p);
  console.log(`romfs listed=${listed.length} missing=${missing.length} extra=${extra.length}`);
  process.exit(missing.length || extra.length ? 1 : 0);
}
