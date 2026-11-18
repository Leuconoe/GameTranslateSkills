#!/usr/bin/env node
// Reconcile <titles-root>/GAME_REGISTRY.tsv with the title folders on disk. Read-only; exit 1 on errors.
// Usage: node scripts/check-game-registry.mjs --titles-root "<titles root>"
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ZONES = { _complete: ['complete'], _archive: ['complete'], _waitng: ['waiting', 'registered', 'blocked'], _hold: ['waiting', 'registered', 'blocked'], _working: null };
const TERMINAL = new Set(['complete', 'removed']);
const REQUIRED = ['game_name', 'base_title_id', 'update_title_id', 'release_folder', 'project_path', 'engine_or_format', 'status'];
const TID = /0[0-9A-F]{15}/gi;

export const stateOf = (status) => status.split(/[;:]/)[0].trim().toLowerCase();

function baseIdsOf(dir) {
  const work = path.join(dir, '_work');
  const fromWork = fs.existsSync(work) ? fs.readdirSync(work).filter((n) => /^0[0-9A-F]{15}$/i.test(n)).map((n) => n.toUpperCase()) : [];
  if (fromWork.length) return fromWork;
  const names = [path.basename(dir), ...fs.readdirSync(dir)];
  return [...new Set(names.flatMap((n) => n.match(TID) ?? []).map((t) => t.toUpperCase()))].filter((t) => t.endsWith('000'));
}

function titleFolders(root) {
  const out = [];
  for (const zone of Object.keys(ZONES)) {
    const z = path.join(root, zone);
    if (!fs.existsSync(z)) continue;
    for (const n of fs.readdirSync(z, { withFileTypes: true })) if (n.isDirectory() && !n.name.startsWith('.')) out.push(`${zone}/${n.name}`);
  }
  for (const n of fs.readdirSync(root, { withFileTypes: true })) if (n.isDirectory() && !/^[_.]/.test(n.name)) out.push(n.name);
  return out;
}

export function checkRegistry(root) {
  const errors = [];
  const warnings = [];
  const file = path.join(root, 'GAME_REGISTRY.tsv');
  const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const header = lines[0].split('\t');
  for (const c of REQUIRED) if (!header.includes(c)) errors.push(`header: missing column ${c}`);
  if (errors.length) return { errors, warnings };
  const rows = lines.slice(1).map((l, i) => ({ line: i + 2, ...Object.fromEntries(l.split('\t').map((v, j) => [header[j], (v ?? '').trim()])) }));
  const seen = new Map();
  for (const r of rows) {
    const id = (r.base_title_id ?? '').toUpperCase();
    const where = `line ${r.line} ${id}`;
    if (!/^0[0-9A-F]{15}$/.test(id)) errors.push(`${where}: invalid base_title_id`);
    if (seen.has(id)) errors.push(`${where}: duplicate base_title_id (also line ${seen.get(id)})`);
    seen.set(id, r.line);
    const state = stateOf(r.status ?? '');
    const rel = (r.release_folder ?? '').replace(/\\/g, '/');
    const exists = rel !== '' && fs.existsSync(path.join(root, rel));
    if (state === 'removed') {
      if (exists) errors.push(`${where}: status removed but folder exists: ${rel}`);
      continue;
    }
    if (!exists) { errors.push(`${where}: folder not found (move/rename not recorded, or mark 'removed; <date> <reason>'): ${rel}`); continue; }
    const zone = rel.split('/')[0];
    const allowed = ZONES[zone];
    if (allowed && !allowed.includes(state)) errors.push(`${where}: ${zone} expects status ${allowed.join('|')}, got '${state}'`);
    if (!(zone in ZONES) && TERMINAL.has(state)) errors.push(`${where}: '${state}' title must live in _complete (or be removed)`);
    if (allowed === null && TERMINAL.has(state)) errors.push(`${where}: _working title cannot be '${state}'; move it to _complete first`);
  }
  for (const rel of titleFolders(root)) {
    const ids = baseIdsOf(path.join(root, rel));
    if (!ids.length) { warnings.push(`unregistered folder without a Title ID: ${rel}`); continue; }
    for (const id of ids) {
      if (!seen.has(id)) { errors.push(`folder not in registry: ${rel} (${id})`); continue; }
      const r = rows.find((x) => x.base_title_id.toUpperCase() === id);
      if (r.release_folder.replace(/\\/g, '/') !== rel && stateOf(r.status) !== 'removed') errors.push(`line ${r.line} ${id}: release_folder '${r.release_folder}' but folder is at '${rel}'`);
    }
  }
  return { errors, warnings };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--titles-root');
  const root = i > 0 ? process.argv[i + 1] : process.env.GT_TITLES_ROOT;
  if (!root) { console.error('usage: check-game-registry.mjs --titles-root <dir>'); process.exit(2); }
  const { errors, warnings } = checkRegistry(path.resolve(root));
  for (const w of warnings) console.log(`WARN  ${w}`);
  for (const e of errors) console.log(`ERROR ${e}`);
  console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(errors.length ? 1 : 0);
}
