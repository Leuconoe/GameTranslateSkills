import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

const TITLE_ID_PATTERN = /^[0-9A-F]{16}$/;
const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const DATA_DESCRIPTOR = 0x08074b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const UTF8_DATA_DESCRIPTOR_FLAGS = 0x0808;
const DEFLATE_METHOD = 8;
const DOS_TIME = 0;
const DOS_DATE = 0x0021; // 1980-01-01, the earliest DOS timestamp.
const MAX_UINT32 = 0xffffffff;
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

function updateCrc32(current, buffer) {
  let value = current;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return value >>> 0;
}

function finalCrc32(current) {
  return (~current) >>> 0;
}

function assertUint32(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_UINT32) {
    throw new Error(`${label} exceeds the non-Zip64 NSW release limit`);
  }
}

export function normalizeTitleId(value) {
  const titleId = String(value ?? '').trim().toUpperCase();
  if (!TITLE_ID_PATTERN.test(titleId)) throw new Error(`Invalid base Title ID: ${value}`);
  return titleId;
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

function localHeader(nameBuffer) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_FILE_HEADER, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(UTF8_DATA_DESCRIPTOR_FLAGS, 6);
  header.writeUInt16LE(DEFLATE_METHOD, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt16LE(nameBuffer.length, 26);
  return header;
}

function dataDescriptor(entry) {
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(DATA_DESCRIPTOR, 0);
  descriptor.writeUInt32LE(entry.crc32, 4);
  descriptor.writeUInt32LE(entry.compressedSize, 8);
  descriptor.writeUInt32LE(entry.uncompressedSize, 12);
  return descriptor;
}

function centralHeader(entry) {
  const nameBuffer = Buffer.from(entry.archivePath, 'utf8');
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_DIRECTORY_HEADER, 0);
  header.writeUInt16LE(0x0314, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(UTF8_DATA_DESCRIPTOR_FLAGS, 8);
  header.writeUInt16LE(DEFLATE_METHOD, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(entry.crc32, 16);
  header.writeUInt32LE(entry.compressedSize, 20);
  header.writeUInt32LE(entry.uncompressedSize, 24);
  header.writeUInt16LE(nameBuffer.length, 28);
  header.writeUInt32LE(0o100644 * 0x10000, 38);
  header.writeUInt32LE(entry.localHeaderOffset, 42);
  return { header, nameBuffer };
}

function endOfCentralDirectory(entryCount, centralSize, centralOffset) {
  if (entryCount > 0xffff) throw new Error('NSW release contains too many ZIP entries');
  const record = Buffer.alloc(22);
  record.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  return record;
}

export async function createDeterministicNswZip({ titleId, romfsRoot, outputPath }) {
  const id = normalizeTitleId(titleId);
  const files = await inventoryRomfs(romfsRoot);
  return createDeterministicZip({
    files: files.map((file) => ({
      ...file,
      archivePath: `${id}/romfs/${file.patchPath}`,
    })),
    outputPath,
  });
}

export async function createDeterministicZip({ files, outputPath }) {
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
      assertUint32(sourceStats.size, `Release file ${file.archivePath}`);
      const archivePath = file.archivePath;
      const nameBuffer = Buffer.from(archivePath, 'utf8');
      if (nameBuffer.length > 0xffff) throw new Error(`ZIP entry name is too long: ${archivePath}`);
      const localHeaderOffset = state.position;
      assertUint32(localHeaderOffset, 'ZIP local header offset');
      await writeAt(handle, localHeader(nameBuffer), state);
      await writeAt(handle, nameBuffer, state);

      let crc = 0xffffffff;
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
      assertUint32(uncompressedSize, `Release file ${file.archivePath}`);
      assertUint32(compressedSize, `Compressed release file ${file.archivePath}`);
      const entry = {
        archivePath,
        sourcePath: file.absolutePath,
        sourceSha256: sourceSha.digest('hex').toUpperCase(),
        crc32: finalCrc32(crc),
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      };
      await writeAt(handle, dataDescriptor(entry), state);
      entries.push(entry);
    }

    const centralOffset = state.position;
    assertUint32(centralOffset, 'ZIP central directory offset');
    for (const entry of entries) {
      const { header, nameBuffer } = centralHeader(entry);
      await writeAt(handle, header, state);
      await writeAt(handle, nameBuffer, state);
    }
    const centralSize = state.position - centralOffset;
    assertUint32(centralSize, 'ZIP central directory size');
    await writeAt(handle, endOfCentralDirectory(entries.length, centralSize, centralOffset), state);
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
    const entryCount = tail.readUInt16LE(endOffset + 10);
    const centralSize = tail.readUInt32LE(endOffset + 12);
    const centralOffset = tail.readUInt32LE(endOffset + 16);
    const commentLength = tail.readUInt16LE(endOffset + 20);
    if (commentLength !== 0) throw new Error('NSW release ZIP comments are forbidden');
    if (centralOffset + centralSize > stats.size) throw new Error('ZIP central directory is out of range');
    const central = await readExact(handle, centralSize, centralOffset);
    const entries = [];
    let cursor = 0;
    while (cursor < central.length) {
      if (central.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_HEADER) throw new Error('Invalid ZIP central directory entry');
      const flags = central.readUInt16LE(cursor + 8);
      const method = central.readUInt16LE(cursor + 10);
      const crc32 = central.readUInt32LE(cursor + 16);
      const compressedSize = central.readUInt32LE(cursor + 20);
      const uncompressedSize = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const commentSize = central.readUInt16LE(cursor + 32);
      const localHeaderOffset = central.readUInt32LE(cursor + 42);
      const recordLength = 46 + nameLength + extraLength + commentSize;
      if (cursor + recordLength > central.length) throw new Error('Truncated ZIP central directory entry');
      const archivePath = central.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
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
  let crc = 0xffffffff;
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
  if (finalCrc32(crc) !== entry.crc32) throw new Error(`CRC-32 mismatch for ${entry.archivePath}`);
  return { sha256: hash.digest('hex').toUpperCase(), size };
}

export async function sha256File(target) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(target), async (stream) => {
    for await (const chunk of stream) hash.update(chunk);
  });
  return hash.digest('hex').toUpperCase();
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

export async function validateNswRelease({ titleId, zipPath, romfsRoot = null, allowTemporaryName = false }) {
  const id = normalizeTitleId(titleId);
  const resolvedZip = path.resolve(zipPath);
  const expectedName = `${id}.zip`;
  if (!allowTemporaryName && path.basename(resolvedZip) !== expectedName) {
    throw new Error(`NSW release filename must be exactly ${expectedName}`);
  }
  if (!allowTemporaryName && path.basename(path.dirname(resolvedZip)).toLowerCase() !== 'releases') {
    throw new Error('NSW release ZIP must be directly under 40_build/releases (version/candidate subfolders are forbidden)');
  }
  const { entries } = await parseCentralDirectory(resolvedZip);
  if (entries.length === 0) throw new Error('NSW release ZIP contains no patch files');
  const prefix = `${id}/romfs/`;
  const seen = new Set();
  for (const entry of entries) {
    if (entry.flags !== UTF8_DATA_DESCRIPTOR_FLAGS) throw new Error(`Unexpected ZIP flags for ${entry.archivePath}`);
    if (!entry.archivePath.startsWith(prefix)) throw new Error(`ZIP entry must use ${prefix}<patch-file>: ${entry.archivePath}`);
    const patchPath = validatePatchRelativePath(entry.archivePath.slice(prefix.length));
    const key = patchPath.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate/case-colliding ZIP entry: ${entry.archivePath}`);
    seen.add(key);
  }

  const sourceInventory = romfsRoot ? await inventoryRomfs(romfsRoot) : null;
  if (sourceInventory && sourceInventory.length !== entries.length) {
    throw new Error(`ZIP/source file count mismatch: ${entries.length} != ${sourceInventory.length}`);
  }
  const sourceByArchive = new Map(sourceInventory?.map((file) => [`${id}/romfs/${file.patchPath}`, file]) ?? []);
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
  if (sourceByArchive.size !== 0) throw new Error(`ZIP is missing RomFS source files: ${[...sourceByArchive.keys()].join(', ')}`);
  return {
    titleId: id,
    zipPath: resolvedZip,
    zipSha256: await sha256File(resolvedZip),
    entries: verifiedEntries,
  };
}
