#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { flag, option, parseArgs, requiredOption } from './lib/args.mjs';

const requiredManifestColumns = [
  'codepoint', 'character', 'glyph_id', 'atlas_page', 'atlas_width', 'atlas_height',
  'x', 'y', 'width', 'height', 'bearing_x', 'bearing_y', 'advance_x', 'line_height',
  'padding', 'uv_origin', 'source_sha256', 'target_sha256', 'roundtrip_status',
  'render_probe_status', 'status', 'notes',
];

function parseRows(text, source) {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length < 2) throw new Error(`${source} must contain a header and at least one glyph row`);
  const header = lines[0].split('\t');
  const rows = lines.slice(1).map((line, index) => {
    const cells = line.split('\t');
    const row = {};
    for (let column = 0; column < header.length; column += 1) row[header[column]] = cells[column] ?? '';
    row.__line = index + 2;
    return row;
  });
  return { header, rows };
}

function integer(value, label, issues, row) {
  if (!/^-?\d+$/.test(value)) {
    issues.push(`line ${row.__line}: ${label} must be an integer, got ${JSON.stringify(value)}`);
    return null;
  }
  return Number(value);
}

function numeric(value, label, issues, row) {
  if (!/^-?(?:\d+|\d*\.\d+)$/.test(value)) {
    issues.push(`line ${row.__line}: ${label} must be numeric, got ${JSON.stringify(value)}`);
    return null;
  }
  return Number(value);
}

async function validateCoverage(manifestRows, coveragePath, issues) {
  if (!coveragePath) return;
  let text;
  try {
    text = await fs.readFile(coveragePath, 'utf8');
  } catch (error) {
    issues.push(`coverage file cannot be read: ${coveragePath} (${error.message})`);
    return;
  }
  let parsed;
  try {
    parsed = parseRows(text, coveragePath);
  } catch (error) {
    issues.push(error.message);
    return;
  }
  for (const column of ['codepoint', 'status']) if (!parsed.header.includes(column)) issues.push(`coverage is missing required column: ${column}`);
  if (issues.some((issue) => issue.startsWith('coverage'))) return;
  const manifestSet = new Set(manifestRows.map((row) => row.codepoint.toUpperCase()));
  const coverageSet = new Set();
  for (const row of parsed.rows) {
    const codepoint = row.codepoint.toUpperCase();
    if (coverageSet.has(codepoint)) issues.push(`coverage line ${row.__line}: duplicate codepoint ${codepoint}`);
    coverageSet.add(codepoint);
    if (!['verified', 'covered', 'no-op'].includes(row.status.toLowerCase())) issues.push(`coverage line ${row.__line}: unsupported status ${row.status}`);
  }
  for (const codepoint of manifestSet) if (!coverageSet.has(codepoint)) issues.push(`coverage is missing manifest codepoint ${codepoint}`);
  for (const codepoint of coverageSet) if (!manifestSet.has(codepoint)) issues.push(`coverage contains codepoint absent from manifest ${codepoint}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flag(args, 'help')) {
    console.log('Usage: node scripts/validate-font-atlas.mjs --manifest <FONT_ATLAS_MANIFEST.tsv> [--coverage <FONT_COVERAGE.tsv>]');
    return;
  }
  const manifestPath = path.resolve(requiredOption(args, 'manifest'));
  const coveragePath = option(args, 'coverage') ? path.resolve(option(args, 'coverage')) : null;
  const issues = [];
  let parsed;
  try {
    parsed = parseRows(await fs.readFile(manifestPath, 'utf8'), manifestPath);
  } catch (error) {
    throw new Error(error.message);
  }
  for (const column of requiredManifestColumns) if (!parsed.header.includes(column)) issues.push(`manifest is missing required column: ${column}`);
  if (issues.length === 0) {
    const seenCodepoints = new Set();
    const rectangles = new Map();
    for (const row of parsed.rows) {
      const codepoint = row.codepoint.toUpperCase();
      if (!/^U\+[0-9A-F]{4,6}$/.test(codepoint)) issues.push(`line ${row.__line}: invalid codepoint ${row.codepoint}`);
      if (seenCodepoints.has(codepoint)) issues.push(`line ${row.__line}: duplicate codepoint ${codepoint}`);
      seenCodepoints.add(codepoint);
      const atlasWidth = integer(row.atlas_width, 'atlas_width', issues, row);
      const atlasHeight = integer(row.atlas_height, 'atlas_height', issues, row);
      const x = integer(row.x, 'x', issues, row);
      const y = integer(row.y, 'y', issues, row);
      const width = integer(row.width, 'width', issues, row);
      const height = integer(row.height, 'height', issues, row);
      const padding = integer(row.padding, 'padding', issues, row);
      const glyphId = integer(row.glyph_id, 'glyph_id', issues, row);
      const atlasPage = integer(row.atlas_page, 'atlas_page', issues, row);
      const lineHeight = integer(row.line_height, 'line_height', issues, row);
      if (glyphId !== null && glyphId < 0) issues.push(`line ${row.__line}: glyph_id must be non-negative`);
      if (atlasPage !== null && atlasPage < 0) issues.push(`line ${row.__line}: atlas_page must be non-negative`);
      if (lineHeight !== null && lineHeight <= 0) issues.push(`line ${row.__line}: line_height must be positive`);
      numeric(row.bearing_x, 'bearing_x', issues, row);
      numeric(row.bearing_y, 'bearing_y', issues, row);
      numeric(row.advance_x, 'advance_x', issues, row);
      if ([atlasWidth, atlasHeight, x, y, width, height, padding].every((value) => value !== null)) {
        if (atlasWidth <= 0 || atlasHeight <= 0) issues.push(`line ${row.__line}: atlas dimensions must be positive`);
        if (x < 0 || y < 0 || width <= 0 || height <= 0 || padding < 0) issues.push(`line ${row.__line}: invalid atlas rectangle or padding`);
        if (x - padding < 0 || y - padding < 0 || x + width + padding > atlasWidth || y + height + padding > atlasHeight) issues.push(`line ${row.__line}: rectangle exceeds atlas bounds including padding`);
        const page = String(row.atlas_page);
        const pageRects = rectangles.get(page) ?? [];
        const current = { x, y, width, height, padding, line: row.__line };
        for (const previous of pageRects) {
          const overlap = current.x - current.padding < previous.x + previous.width + previous.padding
            && current.x + current.width + current.padding > previous.x - previous.padding
            && current.y - current.padding < previous.y + previous.height + previous.padding
            && current.y + current.height + current.padding > previous.y - previous.padding;
          if (overlap) issues.push(`lines ${previous.line}/${row.__line}: overlapping glyph rectangles or padding on atlas page ${page}`);
        }
        pageRects.push(current);
        rectangles.set(page, pageRects);
      }
      if (!['top-left', 'bottom-left'].includes(row.uv_origin)) issues.push(`line ${row.__line}: uv_origin must be top-left or bottom-left`);
      if (!/^[0-9a-f]{64}$/i.test(row.source_sha256) || !/^[0-9a-f]{64}$/i.test(row.target_sha256)) issues.push(`line ${row.__line}: source_sha256 and target_sha256 must be 64-hex SHA-256 values`);
      if (!['pass', 'no-op'].includes(row.roundtrip_status.toLowerCase())) issues.push(`line ${row.__line}: roundtrip_status must be pass or no-op`);
      if (!['pass', 'no-op'].includes(row.render_probe_status.toLowerCase())) issues.push(`line ${row.__line}: render_probe_status must be pass or no-op`);
      if (!['verified', 'no-op'].includes(row.status.toLowerCase())) issues.push(`line ${row.__line}: status must be verified or no-op`);
    }
    await validateCoverage(parsed.rows, coveragePath, issues);
  }
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Glyph rows: ${parsed.rows.length}`);
  console.log(`Issues: ${issues.length}`);
  for (const issue of issues) console.log(`ERROR\t${issue}`);
  if (issues.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exitCode = 1;
});
