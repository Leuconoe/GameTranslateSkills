export const ALPHA_COMPOSITION_ALGORITHM = 'source-outside-mask-luma-inside-v1';
export const MASK_CHANNEL = 'luminance-rec709';
export const MASK_POLARITY = 'white-opaque';
export const MASK_GRAYSCALE_TOLERANCE = 8;

export function parseEditRegions(value) {
  if (typeof value !== 'string' || value.length === 0) throw new Error('edit_regions must not be empty');
  return value.split(';').map((part, index) => {
    const cells = part.split(',');
    if (cells.length !== 4 || cells.some((cell) => !/^\d+$/.test(cell))) {
      throw new Error(`edit_regions[${index}] must be x,y,width,height using non-negative integers`);
    }
    const [x, y, width, height] = cells.map(Number);
    if (width < 1 || height < 1) throw new Error(`edit_regions[${index}] width and height must be positive`);
    return { x, y, width, height };
  });
}

export function insideEditRegions(x, y, regions) {
  return regions.some((region) => x >= region.x && x < region.x + region.width
    && y >= region.y && y < region.y + region.height);
}

export function maskLuminance(red, green, blue) {
  return Math.max(0, Math.min(255, Math.round((54 * red + 183 * green + 19 * blue) / 256)));
}

export function composeAlphaMask({ sourceRgba, candidateRgba, maskRgba, width, height, regions }) {
  const expectedLength = width * height * 4;
  if (!Number.isSafeInteger(expectedLength) || width < 1 || height < 1) throw new Error('invalid composition dimensions');
  for (const [label, buffer] of Object.entries({ sourceRgba, candidateRgba, maskRgba })) {
    if (!Buffer.isBuffer(buffer) || buffer.length !== expectedLength) throw new Error(`${label} length must equal width*height*4`);
  }

  const output = Buffer.from(candidateRgba);
  let changedAlphaPixels = 0;
  let maskPixels = 0;
  let nonOpaqueMaskPixels = 0;
  let grayscaleDriftPixels = 0;
  let rgbDriftOutsideRegions = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const inRegion = insideEditRegions(x, y, regions);
    if (!inRegion) {
      const rgbChanged = sourceRgba[offset] !== candidateRgba[offset]
        || sourceRgba[offset + 1] !== candidateRgba[offset + 1]
        || sourceRgba[offset + 2] !== candidateRgba[offset + 2];
      if (rgbChanged) rgbDriftOutsideRegions += 1;
      output[offset + 3] = sourceRgba[offset + 3];
      continue;
    }

    maskPixels += 1;
    if (maskRgba[offset + 3] !== 255) nonOpaqueMaskPixels += 1;
    const minimum = Math.min(maskRgba[offset], maskRgba[offset + 1], maskRgba[offset + 2]);
    const maximum = Math.max(maskRgba[offset], maskRgba[offset + 1], maskRgba[offset + 2]);
    if (maximum - minimum > MASK_GRAYSCALE_TOLERANCE) grayscaleDriftPixels += 1;
    const alpha = maskLuminance(maskRgba[offset], maskRgba[offset + 1], maskRgba[offset + 2]);
    if (alpha !== candidateRgba[offset + 3]) changedAlphaPixels += 1;
    output[offset + 3] = alpha;
  }
  return {
    rgba: output,
    metrics: {
      changedAlphaPixels,
      maskPixels,
      nonOpaqueMaskPixels,
      grayscaleDriftPixels,
      rgbDriftOutsideRegions,
    },
  };
}
