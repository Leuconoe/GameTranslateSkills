#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { flag, option, parseArgs } from '../scripts/lib/args.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(scriptDirectory, 'tools.manifest.json');

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replaceAll('*', '.*').replaceAll('?', '.')}$`, 'i');
}

function asList(value) {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function inside(root, entryName) {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(rootPath, entryName.replaceAll('/', path.sep));
  const relative = path.relative(rootPath, targetPath);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || relative === '..') {
    throw new Error(`Archive entry escapes destination: ${entryName}`);
  }
  return targetPath;
}

async function extractZip(buffer, destination) {
  const minimumEndRecord = 22;
  const maximumComment = 0xffff;
  const searchStart = Math.max(0, buffer.length - minimumEndRecord - maximumComment);
  let endRecord = -1;
  for (let offset = buffer.length - minimumEndRecord; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      endRecord = offset;
      break;
    }
  }
  if (endRecord === -1) throw new Error('ZIP end-of-central-directory record not found');

  const entryCount = buffer.readUInt16LE(endRecord + 10);
  const centralDirectorySize = buffer.readUInt32LE(endRecord + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(endRecord + 16);
  if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported by the built-in extractor');
  }

  let cursor = centralDirectoryOffset;
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`Invalid ZIP central-directory entry at offset ${cursor}`);
    }

    const flags = buffer.readUInt16LE(cursor + 8);
    const compression = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new Error('ZIP64 entries are not supported by the built-in extractor');
    }

    const nameStart = cursor + 46;
    const entryName = buffer.subarray(nameStart, nameStart + nameLength).toString(flags & 0x800 ? 'utf8' : 'utf8');
    const unixMode = (externalAttributes >>> 16) & 0xffff;
    if ((unixMode & 0xf000) === 0xa000) {
      throw new Error(`Refusing to extract symlink entry: ${entryName}`);
    }

    const targetPath = inside(destination, entryName);
    const isDirectory = entryName.endsWith('/') || (externalAttributes & 0x10) !== 0;
    if (isDirectory) {
      await fs.mkdir(targetPath, { recursive: true });
    } else {
      if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new Error(`Invalid ZIP local header for ${entryName}`);
      }
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      let content;
      if (compression === 0) {
        content = compressed;
      } else if (compression === 8) {
        content = inflateRawSync(compressed);
      } else {
        throw new Error(`Unsupported ZIP compression method ${compression} for ${entryName}`);
      }
      if (content.length !== uncompressedSize) {
        throw new Error(`ZIP size mismatch for ${entryName}`);
      }
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content);
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }
}

async function downloadJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'game-translate-skills-tools',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

async function downloadBuffer(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'game-translate-skills-tools' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function printUsage() {
  console.log(`Usage: npm run tools:install -- [options]

Options:
  --tools-root <path>   Tool destination (default: GT_TOOLS or ./_tools)
  --only <name[,name]>  Install only selected manifest entries; repeatable
  --help                Show this help`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flag(args, 'help')) {
    printUsage();
    return;
  }

  const toolsRoot = path.resolve(String(option(args, 'tools-root') ?? process.env.GT_TOOLS ?? path.join(process.cwd(), '_tools')));
  const only = new Set(asList(option(args, 'only')));
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  await fs.mkdir(toolsRoot, { recursive: true });
  console.log(`도구 루트: ${toolsRoot}\n`);

  let failures = 0;
  for (const tool of manifest.tools) {
    if (only.size > 0 && !only.has(tool.name)) continue;
    console.log(`== ${tool.name} — ${tool.purpose}`);

    if (tool.mode === 'latest-github') {
      const destination = path.join(toolsRoot, tool.dest);
      if (await exists(destination)) {
        console.log(`  이미 존재: ${destination} (건너뜀)`);
        continue;
      }
      try {
        const release = await downloadJson(`https://api.github.com/repos/${tool.repo}/releases/latest`);
        const matcher = globToRegExp(tool.assetPattern);
        const asset = release.assets?.find((candidate) => matcher.test(candidate.name));
        if (!asset) {
          console.warn(`  자산 패턴 '${tool.assetPattern}' 불일치. 확인: https://github.com/${tool.repo}/releases`);
          failures += 1;
          continue;
        }
        console.log(`  다운로드: ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)}MB)`);
        const content = await downloadBuffer(asset.browser_download_url);
        await fs.mkdir(destination, { recursive: true });
        if (asset.name.toLowerCase().endsWith('.zip')) {
          await extractZip(content, destination);
        } else {
          const safeName = path.basename(asset.name.replaceAll('\\', '/'));
          await fs.writeFile(path.join(destination, safeName), content);
        }
        console.log(`  설치 완료: ${destination}`);
      } catch (error) {
        console.warn(`  실패: ${error.message}. 확인: https://github.com/${tool.repo}/releases`);
        failures += 1;
      }
    } else if (tool.mode === 'download') {
      console.log('  안내 URL:');
      for (const url of tool.urls ?? []) console.log(`    ${url}`);
      if (tool.note) console.log(`  참고: ${tool.note}`);
    } else if (tool.mode === 'manual') {
      console.log(`  [준비 필요] ${tool.note}`);
    }
    console.log('');
  }

  console.log('완료. [준비 필요] 항목은 각 플랫폼·엔진 문서의 요구사항에 따라 준비하세요.');
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exitCode = 1;
});
