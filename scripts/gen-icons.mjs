// Placeholder icon generator (WP0). Writes solid felt-green tiles with a gold ring and a red
// centre as PNGs of the right sizes so `predev`/`prebuild` work; the infra WP replaces the art
// (a roulette wheel, architecture.md §8.3) with the same zero-dependency PNG encoder.
// Outputs (gitignored): public/icons/{icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const FELT = [0x0d, 0x3b, 0x2e];
const GOLD = [0xd4, 0xaf, 0x37];
const RED = [0xc0, 0x39, 0x2b];

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** RGB colour at (x, y) of a size x size tile; `ring` draws the gold ring (not for maskable). */
function colorAt(x, y, size, ring) {
  const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / size;
  if (ring && Math.abs(r - 0.4) < 0.025) return GOLD;
  if (r < 0.1) return RED;
  return FELT;
}

function png(size, ring) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = colorAt(x, y, size, ring);
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = fileURLToPath(new URL('../public/icons/', import.meta.url));
mkdirSync(outDir, { recursive: true });
const icons = [
  ['icon-192.png', 192, true],
  ['icon-512.png', 512, true],
  ['icon-maskable-512.png', 512, false],
  ['apple-touch-icon.png', 180, true],
];
for (const [name, size, ring] of icons) writeFileSync(outDir + name, png(size, ring));
