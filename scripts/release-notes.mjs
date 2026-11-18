#!/usr/bin/env node
// Generate RELEASE_NOTES.md in the fixed gt-release §3 format (7 items, blank line between items).
// usage: node scripts/release-notes.mjs --out <_release/RELEASE_NOTES.md> --title "<한국어 제목>"
//   --game-date <YYYY-MM-DD|미확인> [--date-basis "유럽판 Switch 기준"] --patch-version v0.0.1
//   --support-version "v1.0.2 (업데이트 1.0.2 설치 필요)" --lang-method "설정 불필요"
//   [--changelog "v0.0.1 - 초도 배포"]... [--caution "..."]... [--zip <release.zip>] [--release-date YYYY-MM-DD]
// - `*` is appended to the game date when the release date is earlier than game date + 24 months.
// - With --zip, any entry >= 4 GiB adds the exFAT caution automatically.
// - Without --changelog, changelog lines of an existing --out file are kept.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { option, parseArgs, requiredOption } from './lib/args.mjs';

export const EXFAT_CAUTION = 'SD 카드가 exFAT 형식이어야 함 (4GB를 넘는 파일 포함, FAT32 불가)';
const list = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export function gameDateText(gameDate, releaseDate, basis) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gameDate)) return '미확인';
  const [y, m, d] = gameDate.split('-').map(Number);
  const limit = new Date(Date.UTC(y + 2, m - 1, d));
  const star = new Date(`${releaseDate}T00:00:00Z`) < limit ? '*' : '';
  return `${gameDate}${star}${basis ? ` (${basis})` : ''}`;
}

export function zipHasLargeEntry(zipPath) {
  // Central directory scan: Zip64 extra (0x0001) or a 0xFFFFFFFF size marks an entry >= 4 GiB.
  // Reads only the tail and the central directory (release ZIPs can be > 4 GiB).
  const fd = fs.openSync(zipPath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    for (let i = tailLen - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) !== 0x06054b50) continue;
      const cdSize = tail.readUInt32LE(i + 12);
      const cdOff = tail.readUInt32LE(i + 16);
      if (cdOff === 0xffffffff || cdSize === 0xffffffff) return true; // Zip64 EOCD in use
      const cd = Buffer.alloc(cdSize);
      fs.readSync(fd, cd, 0, cdSize, cdOff);
      for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50;
        p += 46 + cd.readUInt16LE(p + 28) + cd.readUInt16LE(p + 30) + cd.readUInt16LE(p + 32)) {
        if (cd.readUInt32LE(p + 24) === 0xffffffff) return true;
      }
      return false;
    }
    throw new Error(`no end-of-central-directory in ${zipPath}`);
  } finally {
    fs.closeSync(fd);
  }
}

export function renderNotes({ title, gameDate, patchVersion, supportVersion, langMethod, changelog, cautions }) {
  const sub = (items) => (items.length ? items : ['없음']).map((s) => `   - ${s}`).join('\n');
  return [
    `# ${title} 한국어 패치`, '',
    `1. 게임명 - ${title}`, '',
    `2. 게임 출시일 - ${gameDate}`, '',
    `3. 패치 버전 - ${patchVersion}`, '',
    `4. 게임 지원 버전 - ${supportVersion}`, '',
    `5. 언어 선택 방법 - ${langMethod}`, '',
    '6. 체인지로그', sub(changelog), '',
    '7. 주의사항', sub(cautions), '',
  ].join('\n');
}

function existingChangelog(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => /^\d+\. 체인지로그/.test(l));
  if (start < 0) return [];
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (/^\d+\. /.test(l)) break;
    const m = l.match(/^\s+-\s+(.*)$/);
    if (m) out.push(m[1]);
  }
  return out;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const out = path.resolve(requiredOption(a, 'out'));
  const releaseDate = option(a, 'release-date') ?? new Date().toISOString().slice(0, 10);
  const cautions = list(option(a, 'caution'));
  const zip = option(a, 'zip');
  if (zip && zipHasLargeEntry(zip) && !cautions.some((c) => c.includes('exFAT'))) cautions.unshift(EXFAT_CAUTION);
  const changelog = list(option(a, 'changelog'));
  const text = renderNotes({
    title: requiredOption(a, 'title'),
    gameDate: gameDateText(requiredOption(a, 'game-date'), releaseDate, option(a, 'date-basis')),
    patchVersion: requiredOption(a, 'patch-version'),
    supportVersion: requiredOption(a, 'support-version'),
    langMethod: requiredOption(a, 'lang-method'),
    changelog: changelog.length ? changelog : existingChangelog(out),
    cautions,
  });
  fs.writeFileSync(`${out}.tmp`, text, 'utf8');
  fs.renameSync(`${out}.tmp`, out);
  console.log(out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
