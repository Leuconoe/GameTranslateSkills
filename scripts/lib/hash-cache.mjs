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

/** Lowercase hex SHA-256 of a file, served from the cache when path+size+mtime are unchanged. */
export async function cachedSha256(target) {
  const file = cacheFile();
  if (file === 'off') return rawSha256(target);
  const key = cacheKey(target);
  const hit = readCache(file)[key];
  if (hit) return hit;
  const hex = await rawSha256(target);
  try {
    const cache = readCache(file); // merge with whatever other processes wrote meanwhile
    cache[key] = hex;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache));
    fs.renameSync(tmp, file);
  } catch {
    // ponytail: cache is best-effort; last writer wins between concurrent processes.
  }
  return hex;
}
