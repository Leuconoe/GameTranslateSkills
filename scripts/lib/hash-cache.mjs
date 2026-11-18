// Shared SHA-256 cache keyed by absolute path + size + mtime (ns). Same JSON file as scripts/lib/hash_cache.py.
// File: $GT_HASH_CACHE, else <LOCALAPPDATA or ~/.cache>/game-translate/sha256-cache.json. GT_HASH_CACHE=off disables.
// A changed file (size or mtime) misses and is re-hashed; a cache write failure never fails the caller.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

export function cacheFile() {
  if (process.env.GT_HASH_CACHE) return process.env.GT_HASH_CACHE;
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache');
  return path.join(base, 'game-translate', 'sha256-cache.json');
}

function readCache(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function cacheKey(target) {
  const st = fs.statSync(target, { bigint: true });
  return `${path.resolve(target)}|${st.size}|${st.mtimeNs}`;
}

async function rawSha256(target) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(target), async (stream) => {
    for await (const chunk of stream) hash.update(chunk);
  });
  return hash.digest('hex');
}

function writeCache(file, updates) {
  try {
    const cache = { ...readCache(file), ...updates }; // merge with whatever other processes wrote meanwhile
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache));
    fs.renameSync(tmp, file);
  } catch {
    // ponytail: cache is best-effort; last writer wins between concurrent processes.
  }
}

/** Lowercase hex SHA-256 of a file, served from the cache when path+size+mtime are unchanged. */
export async function cachedSha256(target) {
  const file = cacheFile();
  if (file === 'off') return rawSha256(target);
  const key = cacheKey(target);
  const hit = readCache(file)[key];
  if (hit) return hit;
  const hex = await rawSha256(target);
  writeCache(file, { [key]: hex });
  return hex;
}

/**
 * Split-ZIP parts: { parts: [lowercase hex per part], joined: lowercase hex of the parts concatenated in order }, in one
 * read pass. The joined hash is cached under "joined:" + the parts' path+size+mtime keys, so any changed part misses.
 */
export async function cachedJoinedSha256(paths) {
  const file = cacheFile();
  const keys = file === 'off' ? null : paths.map(cacheKey);
  const joinKey = keys && `joined:${keys.join('|')}`;
  if (keys) {
    const cache = readCache(file);
    if (cache[joinKey] && keys.every((key) => cache[key])) return { parts: keys.map((key) => cache[key]), joined: cache[joinKey] };
  }
  const joined = crypto.createHash('sha256');
  const parts = [];
  for (const target of paths) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(target, { highWaterMark: 16 << 20 })) {
      hash.update(chunk);
      joined.update(chunk);
    }
    parts.push(hash.digest('hex'));
  }
  const result = { parts, joined: joined.digest('hex') };
  if (keys) writeCache(file, Object.fromEntries([...keys.map((key, i) => [key, parts[i]]), [joinKey, result.joined]]));
  return result;
}
