import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { cachedSha256 } from './hash-cache.mjs';
import zlib from 'node:zlib';

const TITLE_ID_PATTERN = /^[0-9A-F]{16}$/;
const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const DATA_DESCRIPTOR = 0x08074b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY = 0x06064b50;
const ZIP64_END_LOCATOR = 0x07064b50;
const ZIP64_EXTRA_ID = 0x0001;
const UTF8_DATA_DESCRIPTOR_FLAGS = 0x0808;
const DEFLATE_METHOD = 8;
const DOS_TIME = 0;
const DOS_DATE = 0x0021; // 1980-01-01, the earliest DOS timestamp.
const MAX_UINT32 = 0xffffffff;
const MAX_UINT16 = 0xffff;
// APPNOTE 4.5: a size/offset >= 0xFFFFFFFF is stored as 0xFFFFFFFF plus a Zip64 extra field. Archives that never reach
// this limit stay byte-identical to the pre-Zip64 writer. Tests lower the threshold to force Zip64 without 4 GiB inputs.
export const ZIP64_THRESHOLD = MAX_UINT32;
const forbiddenExtensions = new Set(['.nsp', '.xci', '.gldelta', '.keys']);
const forbiddenBasenames = new Set([
  'apply_patch.py', 'prod.keys', 'title.keys', 'console.keys', 'keys.txt',
]);

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  crcTable[index] = value >>> 0;
}

// Streaming CRC-32 (finalized form; start at 0). zlib.crc32 (Node 20.15+/22.2+) is native; the table is the fallback.
function updateCrc32(previous, buffer) {
  if (zlib.crc32) return zlib.crc32(buffer, previous);
  let value = (~previous) >>> 0;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (~value) >>> 0;
}

// zlib deflateBound(): worst-case raw-deflate output, so the Zip64 decision can be made before the local header is written.
function deflateBound(size) {
  return size + Math.floor(size / 4096) + Math.floor(size / 16384) + Math.floor(size / 33554432) + 13;
}

export function normalizeTitleId(value) {
  const titleId = String(value ?? '').trim().toUpperCase();
  if (!TITLE_ID_PATTERN.test(titleId)) throw new Error(`Invalid base Title ID: ${value}`);
  return titleId;
}

// Canonical release directory: <title root>/_release/, the sibling of _work/ (project root = <title root>/_work/<ID>).
// It holds the ZIP, RELEASE_NOTES.md, INSTALL.md, SHA256SUMS.txt, RELEASE_PACKAGE.json, screenshots/ and superseded/.
// Earlier locations inside the project (_work/<ID>/60_release/, _work/<ID>/40_build/releases/) are read-only fallbacks.
export const RELEASE_DIR = '_release';
export const LEGACY_RELEASE_DIRS = ['60_release', path.join('40_build', 'releases')];
const RELEASE_PARENT_NAMES = new Set([RELEASE_DIR, '60_release', 'releases']);

export function titleRootOfProject(projectRoot) {
  const resolved = path.resolve(projectRoot);
  const workRoot = path.dirname(resolved);
  if (path.basename(workRoot).toLowerCase() !== '_work') {
    throw new Error(`Project root must be <title root>/_work/<ID> to locate <title root>/${RELEASE_DIR}: ${resolved}`);
  }
  return path.dirname(workRoot);
}

export function releaseRootOfProject(projectRoot) {
  return path.join(titleRootOfProject(projectRoot), RELEASE_DIR);
}

// Creates <title root>/_release/ (and screenshots/) for writing; a link/junction there is refused.
export async function ensureReleaseRoot(projectRoot) {
  const releaseRoot = releaseRootOfProject(projectRoot);
  for (const target of [releaseRoot, path.join(releaseRoot, 'screenshots')]) {
    const stats = await fsp.lstat(target).catch((error) => { if (error?.code === 'ENOENT') return null; throw error; });
    if (stats && (stats.isSymbolicLink() || !stats.isDirectory())) throw new Error(`Release directory must be a real directory, not a link/junction: ${target}`);
    if (!stats) await fsp.mkdir(target);
  }
  return releaseRoot;
}
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;

// Release ZIPs are named "<한국어 제목> - <BASE_TITLE_ID>.zip" by default; "<BASE_TITLE_ID>.zip" only with --legacy-name.
// The title is made filesystem-safe: bracketed Title IDs are dropped (the ID is already in the suffix), Windows-invalid
// characters and control characters become spaces, whitespace collapses, and trailing dots/spaces are trimmed.
export function sanitizeReleaseGameName(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/\[(?:0x)?[0-9A-Fa-f]{16}\]/g, ' ')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
}

export function nswReleaseFileName(gameName, titleId) {
  if (gameName == null) return `${normalizeTitleId(titleId)}.zip`;
  const name = sanitizeReleaseGameName(gameName);
  if (!name) throw new Error(`NSW release game name is empty after sanitizing: ${JSON.stringify(gameName)}`);
  return `${name} - ${normalizeTitleId(titleId)}.zip`;
}

// Returns the game-name part of a canonical release filename for this Title ID, or null.
export function parseNswReleaseFileName(fileName, titleId) {
  const suffix = ` - ${normalizeTitleId(titleId)}.zip`;
  if (!fileName.endsWith(suffix)) return null;
  const name = fileName.slice(0, -suffix.length);
  return name && sanitizeReleaseGameName(name) === name ? name : null;
}

// Korean title for the release filename, first match wins:
// 1. explicit --korean-title;
// 2. the title root's empty Korean label folder (<title root>/<한국어 제목>/ beside _work/; NSW layout only);
// 3. PROJECT.md "- Korean title: <제목>" (also "korean_title: <제목>" or a "| korean_title | <제목> |" table row).
export async function resolveKoreanReleaseTitle(projectRoot, { explicit = null, labelFolder = true } = {}) {
  if (explicit != null) return sanitizeReleaseGameName(explicit) || null;
  const workDir = path.dirname(path.resolve(projectRoot));
  if (labelFolder && path.basename(workDir).toLowerCase() === '_work') {
    const titleRoot = path.dirname(workDir);
    const labels = [];
    for (const entry of await fsp.readdir(titleRoot, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || entry.name.startsWith('_') || !HANGUL.test(entry.name)) continue;
      if ((await fsp.readdir(path.join(titleRoot, entry.name))).length === 0) labels.push(entry.name);
    }
    if (labels.length > 1) throw new Error(`Several Korean label folders in ${titleRoot} (${labels.join(', ')}); pass --korean-title`);
    if (labels.length === 1) return sanitizeReleaseGameName(labels[0]) || null;
  }
  let text = '';
  try {
    text = await fsp.readFile(path.join(projectRoot, 'PROJECT.md'), 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const field = text.match(/^(?:- |\| )?(?:Korean title|korean_title|한국어 제목)\s*[:|]\s*`?([^`\r\n|]+?)`?\s*\|?\s*$/mi);
  return field ? sanitizeReleaseGameName(field[1]) || null : null;
}

// Replaced packages are kept, never deleted: <release dir>/superseded/<old name> (SHA-256 prefix added on a name clash).
export async function supersedeRelease(source, releaseRoot, name = path.basename(source)) {
  const directory = path.join(releaseRoot, 'superseded');
  await fsp.mkdir(directory, { recursive: true });
  let target = path.join(directory, name);
  if (fs.existsSync(target)) target = path.join(directory, `${(await sha256File(source)).slice(0, 12)}-${name}`);
  await fsp.rename(source, target);
  return target;
}

// Naming for one packaging/validation run: { gameName: <Korean title> } → "<한국어 제목> - <ID>.zip" (default, fail closed
// when no Korean title is known); { gameName: null } → "<ID>.zip" only with the explicit --legacy-name opt-out.
export async function resolveNswReleaseNaming(projectRoot, { koreanTitle = null, legacyName = false, labelFolder = true } = {}) {
  if (legacyName) return { gameName: null };
  const resolved = await resolveKoreanReleaseTitle(projectRoot, { explicit: koreanTitle, labelFolder });
  if (!resolved) {
    throw new Error('Korean release title is unknown: create the empty Korean label folder beside _work/, add "- Korean title: `<한국어 제목>`" to PROJECT.md, or pass --korean-title "<한국어 제목>"');
  }
  return { gameName: resolved };
}

function normalizedArchivePath(value) {
  return value.split(path.sep).join('/');
}

function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function validatePatchRelativePath(relativePath) {
  const archivePath = normalizedArchivePath(relativePath);
  const parts = archivePath.split('/');
  if (!archivePath || archivePath.startsWith('/') || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid RomFS patch path: ${relativePath}`);
  }
  const basename = parts.at(-1).toLowerCase();
  const extension = path.extname(basename).toLowerCase();
  if (forbiddenExtensions.has(extension) || forbiddenBasenames.has(basename)) {
    throw new Error(`Forbidden non-LayeredFS release payload: ${archivePath}`);
  }
  return archivePath;
}

export async function inventoryRomfs(romfsRoot) {
  const resolvedRoot = path.resolve(romfsRoot);
  const rootStats = await fsp.lstat(resolvedRoot).catch(() => null);
  if (!rootStats?.isDirectory() || rootStats.isSymbolicLink()) throw new Error(`RomFS root is not a regular directory: ${resolvedRoot}`);
  const realRoot = await fsp.realpath(resolvedRoot);
  const files = [];

  async function walk(current) {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      const stats = await fsp.lstat(target);
      if (entry.isSymbolicLink() || stats.isSymbolicLink()) throw new Error(`Links/reparse paths are forbidden in release RomFS: ${target}`);
      const realTarget = await fsp.realpath(target);
      if (!isWithin(realRoot, realTarget)) throw new Error(`RomFS entry resolves outside its root: ${target}`);
      if (stats.isDirectory()) {
        await walk(target);
      } else if (stats.isFile()) {
        const relativePath = path.relative(resolvedRoot, target);
        files.push({
          absolutePath: target,
          relativePath,
          patchPath: validatePatchRelativePath(relativePath),
          size: stats.size,
        });
      } else {
        throw new Error(`Unsupported RomFS entry type: ${target}`);
      }
    }
  }

  await walk(resolvedRoot);
  if (files.length === 0) throw new Error(`RomFS release input contains no patch files: ${resolvedRoot}`);
  files.sort((left, right) => left.patchPath.localeCompare(right.patchPath, 'en'));
  const folded = new Set();
  for (const file of files) {
    const key = file.patchPath.toLowerCase();
    if (folded.has(key)) throw new Error(`Case-colliding RomFS paths are forbidden: ${file.patchPath}`);
    folded.add(key);
  }
  return files;
}

async function writeAt(handle, buffer, state) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset, state.position);
    if (bytesWritten <= 0) throw new Error('Failed to make progress while writing ZIP');
    offset += bytesWritten;
    state.position += bytesWritten;
  }
}

// Zip64 entries (sizes may reach the limit) carry version-needed 45 and a local 0x0001 extra with both sizes; the sizes
// follow in the data descriptor (general-purpose bit 3), so the local fields are 0xFFFFFFFF and the extra values are 0.
function localHeader(nameBuffer, zip64) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_FILE_HEADER, 0);
  header.writeUInt16LE(zip64 ? 45 : 20, 4);
  header.writeUInt16LE(UTF8_DATA_DESCRIPTOR_FLAGS, 6);
  header.writeUInt16LE(DEFLATE_METHOD, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt16LE(nameBuffer.length, 26);
  if (zip64) {
    header.writeUInt32LE(MAX_UINT32, 18);
    header.writeUInt32LE(MAX_UINT32, 22);
    header.writeUInt16LE(20, 28);
  }
  return header;
}

function localZip64Extra() {
  const extra = Buffer.alloc(20);
  extra.writeUInt16LE(ZIP64_EXTRA_ID, 0);
  extra.writeUInt16LE(16, 2);
  return extra;
}

function dataDescriptor(entry) {
  const descriptor = Buffer.alloc(entry.zip64Local ? 24 : 16);
  descriptor.writeUInt32LE(DATA_DESCRIPTOR, 0);
  descriptor.writeUInt32LE(entry.crc32, 4);
  if (entry.zip64Local) {
    descriptor.writeBigUInt64LE(BigInt(entry.compressedSize), 8);
    descriptor.writeBigUInt64LE(BigInt(entry.uncompressedSize), 16);
  } else {
    descriptor.writeUInt32LE(entry.compressedSize, 8);
    descriptor.writeUInt32LE(entry.uncompressedSize, 12);
  }
  return descriptor;
}

function centralHeader(entry, threshold) {
  const nameBuffer = Buffer.from(entry.archivePath, 'utf8');
  // APPNOTE 4.5.3: only the overflowing fields go into the extra, in the order uncompressed, compressed, offset.
  const values = [entry.uncompressedSize, entry.compressedSize, entry.localHeaderOffset];
  const overflow = values.map((value) => value >= threshold);
  const extraValues = values.filter((_value, index) => overflow[index]);
  const field32 = (index) => (overflow[index] ? MAX_UINT32 : values[index]);
  const zip64 = entry.zip64Local || extraValues.length > 0;
  const extra = Buffer.alloc(extraValues.length ? 4 + extraValues.length * 8 : 0);
  if (extraValues.length) {
    extra.writeUInt16LE(ZIP64_EXTRA_ID, 0);
    extra.writeUInt16LE(extraValues.length * 8, 2);
    extraValues.forEach((value, index) => extra.writeBigUInt64LE(BigInt(value), 4 + index * 8));
  }
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_DIRECTORY_HEADER, 0);
  header.writeUInt16LE(zip64 ? 0x032d : 0x0314, 4);
  header.writeUInt16LE(zip64 ? 45 : 20, 6);
  header.writeUInt16LE(UTF8_DATA_DESCRIPTOR_FLAGS, 8);
  header.writeUInt16LE(DEFLATE_METHOD, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(entry.crc32, 16);
  header.writeUInt32LE(field32(1), 20);
  header.writeUInt32LE(field32(0), 24);
  header.writeUInt16LE(nameBuffer.length, 28);
  header.writeUInt16LE(extra.length, 30);
  header.writeUInt32LE(0o100644 * 0x10000, 38);
  header.writeUInt32LE(field32(2), 42);
  return { header, nameBuffer, extra };
}

// Classic EOCD, preceded by the Zip64 EOCD record + locator only when a field overflows (APPNOTE 4.4.1.4).
function endOfCentralDirectory(entryCount, centralSize, centralOffset, threshold) {
  const countOverflow = entryCount >= MAX_UINT16;
  const sizeOverflow = centralSize >= threshold;
  const offsetOverflow = centralOffset >= threshold;
  const record = Buffer.alloc(22);
  record.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  record.writeUInt16LE(countOverflow ? MAX_UINT16 : entryCount, 8);
  record.writeUInt16LE(countOverflow ? MAX_UINT16 : entryCount, 10);
  record.writeUInt32LE(sizeOverflow ? MAX_UINT32 : centralSize, 12);
  record.writeUInt32LE(offsetOverflow ? MAX_UINT32 : centralOffset, 16);
  if (!countOverflow && !sizeOverflow && !offsetOverflow) return record;
  const zip64End = Buffer.alloc(56);
  zip64End.writeUInt32LE(ZIP64_END_OF_CENTRAL_DIRECTORY, 0);
  zip64End.writeBigUInt64LE(44n, 4);
  zip64End.writeUInt16LE(0x032d, 12);
  zip64End.writeUInt16LE(45, 14);
  zip64End.writeBigUInt64LE(BigInt(entryCount), 24);
  zip64End.writeBigUInt64LE(BigInt(entryCount), 32);
  zip64End.writeBigUInt64LE(BigInt(centralSize), 40);
  zip64End.writeBigUInt64LE(BigInt(centralOffset), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(ZIP64_END_LOCATOR, 0);
  locator.writeBigUInt64LE(BigInt(centralOffset + centralSize), 8);
  locator.writeUInt32LE(1, 16);
  return Buffer.concat([zip64End, locator, record]);
}

export async function inventoryExefs(exefsRoot) {
  const rootStats = await fsp.lstat(exefsRoot).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!rootStats) return [];
  const files = await inventoryRomfs(exefsRoot);
  if (files.length !== 1 || files[0].patchPath !== 'main') {
    throw new Error('Optional ExeFS release input must contain only main');
  }
  const handle = await fsp.open(files[0].absolutePath, 'r');
  try {
    const magic = Buffer.alloc(4);
    await handle.read(magic, 0, 4, 0);
    if (magic.toString('ascii') !== 'NSO0') throw new Error('ExeFS main must be an NSO0 image');
  } finally {
    await handle.close();
  }
  return files;
}

export async function createDeterministicNswZip({ titleId, romfsRoot, exefsRoot = null, outputPath, zip64Threshold = ZIP64_THRESHOLD }) {
  const id = normalizeTitleId(titleId);
  const contentRoot = `atmosphere/contents/${id}`;
  const romfsFiles = await inventoryRomfs(romfsRoot);
  const exefsFiles = exefsRoot ? await inventoryExefs(exefsRoot) : [];
  return createDeterministicZip({
    files: [...romfsFiles.map((file) => ({
      ...file,
      archivePath: `${contentRoot}/romfs/${file.patchPath}`,
    })), ...exefsFiles.map((file) => ({
      ...file,
      archivePath: `${contentRoot}/exefs/${file.patchPath}`,
    }))],
    outputPath,
    zip64Threshold,
  });
}

export async function createDeterministicZip({ files, outputPath, zip64Threshold = ZIP64_THRESHOLD }) {
  const threshold = zip64Threshold;
  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > ZIP64_THRESHOLD) throw new Error(`Invalid Zip64 threshold: ${threshold}`);
  if (!Array.isArray(files) || files.length === 0) throw new Error('Release ZIP input contains no files');
  const orderedFiles = [...files].sort((left, right) => left.archivePath.localeCompare(right.archivePath, 'en'));
  const seen = new Set();
  for (const file of orderedFiles) {
    if (!file.absolutePath || !file.archivePath) throw new Error('Release ZIP entries require absolutePath and archivePath');
    const parts = file.archivePath.split('/');
    if (file.archivePath.startsWith('/') || parts.some((part) => !part || part === '.' || part === '..') || file.archivePath.includes('\\')) {
      throw new Error(`Invalid release ZIP path: ${file.archivePath}`);
    }
    const key = file.archivePath.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate/case-colliding release ZIP path: ${file.archivePath}`);
    seen.add(key);
  }
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  const handle = await fsp.open(outputPath, 'wx');
  const state = { position: 0 };
  const entries = [];

  try {
    for (const file of orderedFiles) {
      const sourceStats = await fsp.lstat(file.absolutePath);
      if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) throw new Error(`Release ZIP source must be a regular file: ${file.absolutePath}`);
      const archivePath = file.archivePath;
      const nameBuffer = Buffer.from(archivePath, 'utf8');
      if (nameBuffer.length > 0xffff) throw new Error(`ZIP entry name is too long: ${archivePath}`);
      const localHeaderOffset = state.position;
      const zip64Local = deflateBound(sourceStats.size) >= threshold;
      await writeAt(handle, localHeader(nameBuffer, zip64Local), state);
      await writeAt(handle, nameBuffer, state);
      if (zip64Local) await writeAt(handle, localZip64Extra(), state);

      let crc = 0;
      let uncompressedSize = 0;
      let compressedSize = 0;
      const sourceSha = crypto.createHash('sha256');
      const tracker = new Transform({
        transform(chunk, _encoding, callback) {
          crc = updateCrc32(crc, chunk);
          uncompressedSize += chunk.length;
          sourceSha.update(chunk);
          callback(null, chunk);
        },
      });
      const deflater = zlib.createDeflateRaw({ level: 9 });
      await pipeline(
        fs.createReadStream(file.absolutePath),
        tracker,
        deflater,
        async (compressed) => {
          for await (const chunk of compressed) {
            compressedSize += chunk.length;
            await writeAt(handle, chunk, state);
          }
        },
      );
      if (uncompressedSize !== sourceStats.size) throw new Error(`Release file changed while packaging: ${file.archivePath}`);
      if (!zip64Local && compressedSize >= threshold) throw new Error(`Compressed size exceeded its deflate bound: ${file.archivePath}`);
      const entry = {
        archivePath,
        sourcePath: file.absolutePath,
        sourceSha256: sourceSha.digest('hex').toUpperCase(),
        crc32: crc,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        zip64Local,
      };
      await writeAt(handle, dataDescriptor(entry), state);
      entries.push(entry);
    }

    const centralOffset = state.position;
    for (const entry of entries) {
      const { header, nameBuffer, extra } = centralHeader(entry, threshold);
      await writeAt(handle, Buffer.concat([header, nameBuffer, extra]), state);
    }
    const centralSize = state.position - centralOffset;
    await writeAt(handle, endOfCentralDirectory(entries.length, centralSize, centralOffset, threshold), state);
    await handle.sync();
  } finally {
    await handle.close();
  }

  return entries;
}

async function readExact(handle, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (bytesRead === 0) throw new Error('Unexpected end of ZIP');
    offset += bytesRead;
  }
  return buffer;
}

async function parseCentralDirectory(zipPath) {
  const handle = await fsp.open(zipPath, 'r');
  try {
    const stats = await handle.stat();
    const tailLength = Math.min(stats.size, 0xffff + 22);
    const tail = await readExact(handle, tailLength, stats.size - tailLength);
    let endOffset = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === END_OF_CENTRAL_DIRECTORY) {
        endOffset = index;
        break;
      }
    }
    if (endOffset === -1) throw new Error('ZIP end-of-central-directory record is missing');
    let entryCount = tail.readUInt16LE(endOffset + 10);
    let centralSize = tail.readUInt32LE(endOffset + 12);
    let centralOffset = tail.readUInt32LE(endOffset + 16);
    const commentLength = tail.readUInt16LE(endOffset + 20);
    if (commentLength !== 0) throw new Error('NSW release ZIP comments are forbidden');
    const hasLocator = endOffset >= 20 && tail.readUInt32LE(endOffset - 20) === ZIP64_END_LOCATOR;
    if (hasLocator) {
      const zip64EndOffset = Number(tail.readBigUInt64LE(endOffset - 12));
      const zip64End = await readExact(handle, 56, zip64EndOffset);
      if (zip64End.readUInt32LE(0) !== ZIP64_END_OF_CENTRAL_DIRECTORY) throw new Error('Zip64 end-of-central-directory record is missing');
      const zip64EntryCount = Number(zip64End.readBigUInt64LE(32));
      const zip64CentralSize = Number(zip64End.readBigUInt64LE(40));
      const zip64CentralOffset = Number(zip64End.readBigUInt64LE(48));
      // Classic fields are either the 0xFFFF/0xFFFFFFFF sentinel or must agree with the Zip64 record.
      if ((entryCount !== MAX_UINT16 && entryCount !== zip64EntryCount)
        || (centralSize !== MAX_UINT32 && centralSize !== zip64CentralSize)
        || (centralOffset !== MAX_UINT32 && centralOffset !== zip64CentralOffset)) {
        throw new Error('ZIP/Zip64 end-of-central-directory records disagree');
      }
      if (zip64CentralOffset + zip64CentralSize !== zip64EndOffset) throw new Error('Zip64 central directory is out of place');
      entryCount = zip64EntryCount;
      centralSize = zip64CentralSize;
      centralOffset = zip64CentralOffset;
    } else if (entryCount === MAX_UINT16 || centralSize === MAX_UINT32 || centralOffset === MAX_UINT32) {
      throw new Error('ZIP uses Zip64 sentinels without a Zip64 end-of-central-directory locator');
    }
    if (centralOffset + centralSize > stats.size) throw new Error('ZIP central directory is out of range');
    const central = await readExact(handle, centralSize, centralOffset);
    const entries = [];
    let cursor = 0;
    while (cursor < central.length) {
      if (central.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_HEADER) throw new Error('Invalid ZIP central directory entry');
      const versionNeeded = central.readUInt16LE(cursor + 6);
      const flags = central.readUInt16LE(cursor + 8);
      const method = central.readUInt16LE(cursor + 10);
      const crc32 = central.readUInt32LE(cursor + 16);
      let compressedSize = central.readUInt32LE(cursor + 20);
      let uncompressedSize = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const commentSize = central.readUInt16LE(cursor + 32);
      let localHeaderOffset = central.readUInt32LE(cursor + 42);
      const recordLength = 46 + nameLength + extraLength + commentSize;
      if (cursor + recordLength > central.length) throw new Error('Truncated ZIP central directory entry');
      const archivePath = central.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
      const extra = central.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength);
      let zip64 = null;
      for (let at = 0; at + 4 <= extra.length;) {
        const id = extra.readUInt16LE(at);
        const size = extra.readUInt16LE(at + 2);
        if (at + 4 + size > extra.length) throw new Error(`Truncated ZIP extra field for ${archivePath}`);
        if (id === ZIP64_EXTRA_ID) zip64 = extra.subarray(at + 4, at + 4 + size);
        at += 4 + size;
      }
      // APPNOTE 4.5.3: Zip64 values appear only for 0xFFFFFFFF header fields, in the order uncompressed, compressed, offset.
      let zip64Cursor = 0;
      const zip64Value = () => {
        if (!zip64 || zip64Cursor + 8 > zip64.length) throw new Error(`Missing Zip64 extra value for ${archivePath}`);
        const value = Number(zip64.readBigUInt64LE(zip64Cursor));
        zip64Cursor += 8;
        if (!Number.isSafeInteger(value)) throw new Error(`Zip64 value is too large for ${archivePath}`);
        return value;
      };
      if (uncompressedSize === MAX_UINT32) uncompressedSize = zip64Value();
      if (compressedSize === MAX_UINT32) compressedSize = zip64Value();
      if (localHeaderOffset === MAX_UINT32) localHeaderOffset = zip64Value();
      if (zip64 && versionNeeded < 45) throw new Error(`Zip64 entry must need version 4.5: ${archivePath}`);
      entries.push({ archivePath, flags, method, crc32, compressedSize, uncompressedSize, localHeaderOffset });
      cursor += recordLength;
    }
    if (entries.length !== entryCount) throw new Error(`ZIP entry count mismatch: expected ${entryCount}, found ${entries.length}`);
    return { entries, stats };
  } finally {
    await handle.close();
  }
}

async function hashZipEntry(zipPath, entry) {
  const handle = await fsp.open(zipPath, 'r');
  let dataStart;
  try {
    const local = await readExact(handle, 30, entry.localHeaderOffset);
    if (local.readUInt32LE(0) !== LOCAL_FILE_HEADER) throw new Error(`Invalid local ZIP header for ${entry.archivePath}`);
    const nameLength = local.readUInt16LE(26);
    const extraLength = local.readUInt16LE(28);
    const name = (await readExact(handle, nameLength, entry.localHeaderOffset + 30)).toString('utf8');
    if (name !== entry.archivePath) throw new Error(`Local/central ZIP name mismatch for ${entry.archivePath}`);
    dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  } finally {
    await handle.close();
  }

  const hash = crypto.createHash('sha256');
  let crc = 0;
  let size = 0;
  const tracker = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      crc = updateCrc32(crc, chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });
  const source = fs.createReadStream(zipPath, {
    start: dataStart,
    end: dataStart + entry.compressedSize - 1,
  });
  if (entry.method !== DEFLATE_METHOD) throw new Error(`Unsupported ZIP compression method for ${entry.archivePath}: ${entry.method}`);
  await pipeline(source, zlib.createInflateRaw(), tracker, async (stream) => {
    for await (const _chunk of stream) { /* drain */ }
  });
  if (size !== entry.uncompressedSize) throw new Error(`Uncompressed size mismatch for ${entry.archivePath}`);
  if (crc !== entry.crc32) throw new Error(`CRC-32 mismatch for ${entry.archivePath}`);
  return { sha256: hash.digest('hex').toUpperCase(), size };
}

// The console never reads the ZIP (Zip64 matters only to the extracting PC), but FAT32 cannot store a file >= 4 GiB, so
// such a release must tell users in RELEASE_NOTES.md (beside the ZIP) that the SD card has to be exFAT.
export const FAT32_FILE_LIMIT = 2 ** 32;
export async function fat32ReleaseWarning(entries, zipPath) {
  const large = entries.filter((entry) => entry.size >= FAT32_FILE_LIMIT);
  if (large.length === 0) return null;
  const notesPath = path.join(path.dirname(path.resolve(zipPath)), 'RELEASE_NOTES.md');
  const notes = await fsp.readFile(notesPath, 'utf8').catch(() => '');
  if (/exFAT/i.test(notes)) return null;
  return `${large.length} entry(s) >= 4 GiB (${large.map((entry) => entry.path).join(', ')}) cannot be stored on FAT32; add "SD 카드가 exFAT 형식이어야 함" to 주의사항 in ${notesPath}`;
}

export async function sha256File(target) {
  return (await cachedSha256(target)).toUpperCase(); // path+size+mtime cache (scripts/lib/hash-cache.mjs)
}

export async function inspectDeterministicZip(zipPath) {
  const resolvedZip = path.resolve(zipPath);
  const { entries } = await parseCentralDirectory(resolvedZip);
  const verified = [];
  for (const entry of entries) {
    if (entry.flags !== UTF8_DATA_DESCRIPTOR_FLAGS) throw new Error(`Unexpected ZIP flags for ${entry.archivePath}`);
    if (entry.method !== DEFLATE_METHOD) throw new Error(`Unexpected ZIP compression method for ${entry.archivePath}`);
    const payload = await hashZipEntry(resolvedZip, entry);
    verified.push({ path: entry.archivePath, size: payload.size, sha256: payload.sha256 });
  }
  return { zipPath: resolvedZip, zipSha256: await sha256File(resolvedZip), entries: verified };
}

export async function validateNswRelease({ titleId, zipPath, romfsRoot = null, exefsRoot = null, allowTemporaryName = false, gameName = null }) {
  const id = normalizeTitleId(titleId);
  const contentRoot = `atmosphere/contents/${id}`;
  const resolvedZip = path.resolve(zipPath);
  if (!allowTemporaryName) {
    const fileName = path.basename(resolvedZip);
    const expectedName = nswReleaseFileName(gameName, id);
    if (fileName !== expectedName) {
      throw new Error(`NSW release filename must be exactly ${expectedName}: ${fileName}`);
    }
  }
  if (!allowTemporaryName && !RELEASE_PARENT_NAMES.has(path.basename(path.dirname(resolvedZip)).toLowerCase())) {
    throw new Error('NSW release ZIP must be directly under <title root>/_release (legacy: 60_release, 40_build/releases); version/candidate subfolders are forbidden');
  }
  const { entries } = await parseCentralDirectory(resolvedZip);
  if (entries.length === 0) throw new Error('NSW release ZIP contains no patch files');
  const romfsPrefix = `${contentRoot}/romfs/`;
  const exefsPrefix = `${contentRoot}/exefs/`;
  const seen = new Set();
  for (const entry of entries) {
    if (entry.flags !== UTF8_DATA_DESCRIPTOR_FLAGS) throw new Error(`Unexpected ZIP flags for ${entry.archivePath}`);
    const isRomfs = entry.archivePath.startsWith(romfsPrefix);
    const isExefs = entry.archivePath.startsWith(exefsPrefix);
    if (!isRomfs && !isExefs) throw new Error(`ZIP entry must use ${romfsPrefix} or ${exefsPrefix}: ${entry.archivePath}`);
    const patchPath = validatePatchRelativePath(entry.archivePath.slice(isRomfs ? romfsPrefix.length : exefsPrefix.length));
    if (isExefs && (patchPath !== 'main' || !exefsRoot)) throw new Error(`Unrecognized ExeFS release entry: ${entry.archivePath}`);
    const key = entry.archivePath.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate/case-colliding ZIP entry: ${entry.archivePath}`);
    seen.add(key);
  }

  const sourceInventory = romfsRoot ? [
    ...(await inventoryRomfs(romfsRoot)).map((file) => ({ ...file, archivePath: `${romfsPrefix}${file.patchPath}` })),
    ...(exefsRoot ? await inventoryExefs(exefsRoot) : []).map((file) => ({ ...file, archivePath: `${exefsPrefix}${file.patchPath}` })),
  ] : null;
  if (sourceInventory && sourceInventory.length !== entries.length) {
    throw new Error(`ZIP/source file count mismatch: ${entries.length} != ${sourceInventory.length}`);
  }
  const sourceByArchive = new Map(sourceInventory?.map((file) => [file.archivePath, file]) ?? []);
  const verifiedEntries = [];
  for (const entry of entries) {
    const payload = await hashZipEntry(resolvedZip, entry);
    const source = sourceByArchive.get(entry.archivePath);
    if (source) {
      const sourceHash = await sha256File(source.absolutePath);
      if (payload.size !== source.size || payload.sha256 !== sourceHash) {
        throw new Error(`ZIP/source payload mismatch: ${entry.archivePath}`);
      }
      sourceByArchive.delete(entry.archivePath);
    }
    verifiedEntries.push({ path: entry.archivePath, size: payload.size, sha256: payload.sha256 });
  }
  if (sourceByArchive.size !== 0) throw new Error(`ZIP is missing source files: ${[...sourceByArchive.keys()].join(', ')}`);
  return {
    titleId: id,
    zipPath: resolvedZip,
    zipSha256: await sha256File(resolvedZip),
    entries: verifiedEntries,
  };
}
