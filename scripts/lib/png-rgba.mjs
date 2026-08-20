import zlib from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_PIXELS = 100_000_000;

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function checkedPixelCount(width, height) {
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || width < 1 || height < 1 || pixels > MAX_PIXELS) {
    throw new Error(`PNG dimensions exceed the supported ${MAX_PIXELS}-pixel limit`);
  }
  return pixels;
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

export function decodePngRgba(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('input is not a PNG file');
  }

  let cursor = 8;
  let header = null;
  let seenIend = false;
  const idat = [];
  while (cursor < buffer.length) {
    if (cursor + 12 > buffer.length) throw new Error('PNG chunk header is truncated');
    const length = buffer.readUInt32BE(cursor);
    const type = buffer.toString('ascii', cursor + 4, cursor + 8);
    const dataStart = cursor + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > buffer.length) throw new Error(`PNG ${type} chunk is truncated`);
    const typeAndData = buffer.subarray(cursor + 4, dataEnd);
    if (crc32(typeAndData) !== buffer.readUInt32BE(dataEnd)) throw new Error(`PNG ${type} CRC mismatch`);

    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      if (header || length !== 13) throw new Error('PNG must contain one 13-byte IHDR chunk');
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      if (!header) throw new Error('PNG IDAT appears before IHDR');
      idat.push(data);
    } else if (type === 'IEND') {
      if (length !== 0) throw new Error('PNG IEND must be empty');
      seenIend = true;
      cursor = chunkEnd;
      break;
    } else if ((buffer[cursor + 4] & 0x20) === 0) {
      throw new Error(`unsupported critical PNG chunk ${type}`);
    }
    cursor = chunkEnd;
  }

  if (!header || !seenIend || idat.length === 0) throw new Error('PNG is missing IHDR, IDAT, or IEND');
  if (cursor !== buffer.length) throw new Error('PNG contains trailing bytes after IEND');
  if (header.bitDepth !== 8 || ![0, 2, 4, 6].includes(header.colorType)) {
    throw new Error('only 8-bit grayscale, RGB, grayscale-alpha, and RGBA PNG files are supported');
  }
  if (header.compression !== 0 || header.filter !== 0 || header.interlace !== 0) {
    throw new Error('only standard compression/filter and non-interlaced PNG files are supported');
  }

  const pixels = checkedPixelCount(header.width, header.height);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[header.colorType];
  const rowBytes = header.width * channels;
  const expectedInflated = (rowBytes + 1) * header.height;
  if (!Number.isSafeInteger(expectedInflated)) throw new Error('PNG decoded size exceeds the supported range');
  const inflated = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: expectedInflated + 1 });
  if (inflated.length !== expectedInflated) throw new Error('PNG decoded byte length does not match IHDR');

  const decoded = Buffer.allocUnsafe(rowBytes * header.height);
  let inputOffset = 0;
  for (let y = 0; y < header.height; y += 1) {
    const filterType = inflated[inputOffset];
    inputOffset += 1;
    if (filterType > 4) throw new Error(`unsupported PNG filter type ${filterType}`);
    const rowOffset = y * rowBytes;
    const previousOffset = rowOffset - rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[inputOffset + x];
      const left = x >= channels ? decoded[rowOffset + x - channels] : 0;
      const above = y > 0 ? decoded[previousOffset + x] : 0;
      const upperLeft = y > 0 && x >= channels ? decoded[previousOffset + x - channels] : 0;
      let value = raw;
      if (filterType === 1) value += left;
      else if (filterType === 2) value += above;
      else if (filterType === 3) value += Math.floor((left + above) / 2);
      else if (filterType === 4) value += paeth(left, above, upperLeft);
      decoded[rowOffset + x] = value & 0xff;
    }
    inputOffset += rowBytes;
  }

  const rgba = Buffer.allocUnsafe(pixels * 4);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const input = pixel * channels;
    const output = pixel * 4;
    if (header.colorType === 0) {
      rgba[output] = decoded[input];
      rgba[output + 1] = decoded[input];
      rgba[output + 2] = decoded[input];
      rgba[output + 3] = 255;
    } else if (header.colorType === 2) {
      rgba[output] = decoded[input];
      rgba[output + 1] = decoded[input + 1];
      rgba[output + 2] = decoded[input + 2];
      rgba[output + 3] = 255;
    } else if (header.colorType === 4) {
      rgba[output] = decoded[input];
      rgba[output + 1] = decoded[input];
      rgba[output + 2] = decoded[input];
      rgba[output + 3] = decoded[input + 1];
    } else {
      decoded.copy(rgba, output, input, input + 4);
    }
  }
  return { ...header, rgba };
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.allocUnsafe(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

export function encodePngRgba(width, height, rgba) {
  const pixels = checkedPixelCount(width, height);
  if (!Buffer.isBuffer(rgba) || rgba.length !== pixels * 4) throw new Error('RGBA byte length must equal width*height*4');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanlines = Buffer.allocUnsafe((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const output = y * (width * 4 + 1);
    scanlines[output] = 0;
    rgba.copy(scanlines, output + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function resizeRgbaBilinear(rgba, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const sourcePixels = checkedPixelCount(sourceWidth, sourceHeight);
  const targetPixels = checkedPixelCount(targetWidth, targetHeight);
  if (!Buffer.isBuffer(rgba) || rgba.length !== sourcePixels * 4) throw new Error('source RGBA byte length must equal width*height*4');
  const output = Buffer.allocUnsafe(targetPixels * 4);
  const sample = (x, y, channel) => rgba[(y * sourceWidth + x) * 4 + channel];

  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.max(0, Math.min(sourceHeight - 1, ((y + 0.5) * sourceHeight / targetHeight) - 0.5));
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(sourceHeight - 1, y0 + 1);
    const fy = sourceY - y0;
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.max(0, Math.min(sourceWidth - 1, ((x + 0.5) * sourceWidth / targetWidth) - 0.5));
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const fx = sourceX - x0;
      const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
      const points = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
      let alpha = 0;
      const premultiplied = [0, 0, 0];
      const straight = [0, 0, 0];
      for (let index = 0; index < 4; index += 1) {
        const [sampleX, sampleY] = points[index];
        const weight = weights[index];
        const sampleAlpha = sample(sampleX, sampleY, 3);
        alpha += sampleAlpha * weight;
        for (let channel = 0; channel < 3; channel += 1) {
          const sampleColor = sample(sampleX, sampleY, channel);
          premultiplied[channel] += sampleColor * sampleAlpha * weight;
          straight[channel] += sampleColor * weight;
        }
      }
      const offset = (y * targetWidth + x) * 4;
      output[offset + 3] = Math.max(0, Math.min(255, Math.round(alpha)));
      for (let channel = 0; channel < 3; channel += 1) {
        const color = alpha === 0 ? straight[channel] : premultiplied[channel] / alpha;
        output[offset + channel] = Math.max(0, Math.min(255, Math.round(color)));
      }
    }
  }
  return output;
}
