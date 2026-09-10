import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Simple CRC32 implementation for PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcBuf = Buffer.alloc(4);
  const toCrc = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(toCrc), 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function generatePng(size) {
  // RGBA buffer for image
  const rawData = Buffer.alloc(size * (size * 4 + 1));

  for (let y = 0; y < size; y++) {
    const rowOffset = y * (size * 4 + 1);
    rawData[rowOffset] = 0; // PNG filter byte 0 (None)

    for (let x = 0; x < size; x++) {
      const pxOffset = rowOffset + 1 + x * 4;

      // Normalized coordinates [0, 1]
      const nx = x / (size - 1);
      const ny = y / (size - 1);

      // Bauhaus Geometry:
      // Dark slate background: #111111
      let r = 18, g = 18, b = 20, a = 255;

      // Border: 1px equivalent border
      const borderThick = 1 / size;
      if (nx < borderThick * 2 || nx > 1 - borderThick * 2 || ny < borderThick * 2 || ny > 1 - borderThick * 2) {
        // Stark white border
        r = 255; g = 255; b = 255;
      }
      // Bold Red Deflector Diagonal Wedge: Pure Red #E53935
      else if (nx >= 0.2 && nx <= 0.8 && ny >= 0.2 && ny <= 0.8 && (nx + ny >= 0.7 && nx + ny <= 1.3)) {
        r = 229; g = 57; b = 53; // Red accent
      }
      // Cobalt Blue Accent Dot/Square: Pure Blue #1976D2
      else if (nx >= 0.25 && nx <= 0.45 && ny >= 0.25 && ny <= 0.45) {
        r = 25; g = 118; b = 210; // Blue accent
      }
      // Geometric Golden Yellow Angle: Pure Yellow #FBC02D
      else if (nx >= 0.55 && nx <= 0.75 && ny >= 0.55 && ny <= 0.75) {
        r = 251; g = 192; b = 45; // Yellow accent
      }

      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // Bit depth
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // Compression
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // Interlace
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // IDAT
  const compressed = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressed);

  // IEND
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

const sizes = [16, 48, 128];
for (const size of sizes) {
  const png = generatePng(size);
  fs.writeFileSync(path.resolve(`public/icons/icon-${size}.png`), png);
  fs.writeFileSync(path.resolve(`icons/icon-${size}.png`), png);
  console.log(`Generated icon-${size}.png (${size}x${size})`);
}
