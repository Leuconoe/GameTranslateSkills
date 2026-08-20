export const IMAGE_MANIFEST_COLUMNS = [
  'stable_key', 'source_path', 'source_sha256', 'reference_path', 'reference_sha256',
  'candidate_path', 'candidate_sha256', 'source_rgba_path', 'source_rgba_sha256',
  'candidate_rgba_path', 'candidate_rgba_sha256', 'source_width', 'source_height',
  'candidate_width', 'candidate_height', 'source_format', 'candidate_format',
  'source_color_mode', 'candidate_color_mode', 'alpha_policy', 'edit_regions', 'source_anchors',
  'candidate_anchors', 'atlas_page', 'source_atlas_rect', 'candidate_atlas_rect',
  'origin', 'generator', 'tool', 'model', 'quality', 'generation_mode', 'prompt_path', 'prompt_sha256',
  'receipt_path', 'receipt_sha256', 'style_contract', 'atmosphere_contract',
  'style_status', 'atmosphere_status', 'original_feel_status', 'source_text_removal_status',
  'alpha_status', 'layout_status', 'korean_text_status', 'roundtrip_status', 'status', 'notes',
];

export function parseImageManifest(text, source) {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length < 2) throw new Error(`${source} must contain the exact header and at least one row`);
  const header = lines[0].split('\t');
  if (header.join('\t') !== IMAGE_MANIFEST_COLUMNS.join('\t')) {
    throw new Error(`${source} header must exactly match common/image-translation-contract.md`);
  }
  return lines.slice(1).map((line, index) => {
    const cells = line.split('\t');
    if (cells.length !== header.length) {
      throw new Error(`${source} line ${index + 2} has ${cells.length} cells; expected ${header.length}`);
    }
    return { ...Object.fromEntries(header.map((column, columnIndex) => [column, cells[columnIndex]])), __line: index + 2 };
  });
}

export function serializeImageManifest(rows) {
  const lines = [IMAGE_MANIFEST_COLUMNS.join('\t')];
  for (const row of rows) {
    const cells = IMAGE_MANIFEST_COLUMNS.map((column) => {
      const value = String(row[column] ?? '');
      if (/[\t\r\n]/.test(value)) throw new Error(`${column} contains a TSV control character`);
      return value;
    });
    lines.push(cells.join('\t'));
  }
  return `${lines.join('\n')}\n`;
}
