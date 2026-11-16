import { parseEditRegions } from './image-alpha-mask.mjs';

const text = (value) => typeof value === 'string' && value.trim().length > 0;

export function sameImageText(actual, expected) {
  if (typeof actual === 'string' && typeof expected === 'string') return actual === expected;
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length
    && actual.every((value, index) => typeof value === 'string' && value === expected[index]);
}

export function validImageTextPair(source, korean, editRegions) {
  if (text(source) && text(korean)) return true;
  if (!Array.isArray(source) || !Array.isArray(korean) || !source.length
      || source.length !== korean.length || !source.every(text) || !korean.every(text)) return false;
  try { return source.length === parseEditRegions(editRegions).length; } catch { return false; }
}

export function parsePromptContract(prompt, row, issues) {
  const fields = new Map();
  for (const [index, rawLine] of prompt.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (fields.has(key)) {
      issues.push(`line ${row.__line}: imagegen prompt duplicates ${key} at prompt line ${index + 1}`);
      continue;
    }
    fields.set(key, value);
  }
  for (const key of ['source_text', 'korean_text']) {
    const jsonKey = key + '_json';
    if (!fields.has(jsonKey)) continue;
    if (fields.has(key)) {
      issues.push(`line ${row.__line}: imagegen prompt conflicts ${key} and ${jsonKey}`);
      continue;
    }
    try { fields.set(key, JSON.parse(fields.get(jsonKey))); }
    catch { issues.push(`line ${row.__line}: imagegen prompt invalid JSON ${jsonKey}`); }
  }
  if (!validImageTextPair(fields.get('source_text'), fields.get('korean_text'), row.edit_regions)) {
    issues.push(`line ${row.__line}: imagegen prompt text must be nonempty strings or ordered string arrays matching edit_regions`);
  }
  return fields;
}

// Metadata-only text/header preflight; this does not replace image/provenance QA.
export function validatePromptTextPreflight(prompt, row, expected, issues = []) {
  const fields = parsePromptContract(prompt, row, issues);
  for (const key of ['source_text', 'korean_text', 'edit_regions', 'reference_sha256', 'tool', 'execution_surface']) {
    if (!Object.hasOwn(expected ?? {}, key)) {
      issues.push(`line ${row.__line}: prompt preflight requires expected ${key}`);
    }
  }
  for (const [key, value] of Object.entries(expected ?? {})) {
    if (!sameImageText(fields.get(key), value)) issues.push(`line ${row.__line}: prompt preflight mismatch ${key}`);
  }
  return fields;
}
