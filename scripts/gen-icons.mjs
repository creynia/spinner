// Dependency-free PNG icon generator: a roulette wheel (architecture.md §8.3), drawn procedurally
// with 4x4 supersampled antialiasing and encoded with node:zlib. `public/icon.svg` is the same
// design as vector art (see wheelSvg below; `node scripts/gen-icons.mjs --svg` rewrites it).
// Outputs (gitignored): public/icons/{icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const FELT = [0x0d, 0x3b, 0x2e];
const FELT_DARK = [0x08, 0x26, 0x1d];
const GOLD = [0xd4, 0xaf, 0x37];
const RED = [0xc0, 0x39, 0x2b];
const BLACK = [0x14, 0x14, 0x14];
const GREEN = [0x1e, 0x8a, 0x4c];
const CREAM = [0xf8, 0xf5, 0xec];

const POCKETS = 37;
/** Radii in 512-space: rim, pocket ring, hub. */
const R = { rimOut: 236, rimIn: 204, pocketIn: 128, hub: 112, cone: 40 };
/** Pocket i spans angle [i, i+1) / 37 of a turn clockwise from 12 o'clock; pocket 0 is the green zero. */
const pocketColor = (i) => (i === 0 ? GREEN : i % 2 === 1 ? RED : BLACK);

function inRoundRect(px, py, x, y, w, h, r) {
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (
    (px - cx) ** 2 + (py - cy) ** 2 <= r * r && px >= x && px <= x + w && py >= y && py <= y + h
  );
}

/** Colour of the design at (px,py) in 512-space, or null when transparent. */
function sample(px, py, { rounded }) {
  if (rounded && !inRoundRect(px, py, 0, 0, 512, 512, 96)) return null;
  const dx = px - 256;
  const dy = py - 256;
  const r = Math.hypot(dx, dy);
  const turn = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1; // clockwise from 12 o'clock
  if (r <= R.rimOut && r > R.rimIn) return GOLD;
  if (r <= R.rimIn && r > R.pocketIn) {
    const t = turn * POCKETS;
    const frac = t - Math.floor(t);
    // thin gold dividers between pockets, about 3px wide at mid radius
    const half = 1.5 / ((2 * Math.PI * 166) / POCKETS);
    if (frac < half || frac > 1 - half) return GOLD;
    // the ball sits in pocket 12 (a black one), just inside the rim
    const ball = Math.hypot(
      dx - 166 * Math.sin(12.5 * ((2 * Math.PI) / POCKETS)),
      dy + 166 * Math.cos(12.5 * ((2 * Math.PI) / POCKETS)),
    );
    if (ball <= 17) return CREAM;
    return pocketColor(Math.floor(t) % POCKETS);
  }
  if (r <= R.pocketIn && r > R.hub) return GOLD;
  if (r <= R.hub) {
    if (r <= R.cone) return GOLD;
    // four spokes
    const a = Math.min(Math.abs(dx), Math.abs(dy));
    if (a <= 6) return GOLD;
    return FELT_DARK;
  }
  return FELT;
}

/** @returns {Uint8Array} RGBA pixels. scale < 1 shrinks the design about the centre (maskable safe zone). */
function render(size, { rounded = true, scale = 1 } = {}) {
  const SS = 4;
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = ((x + (sx + 0.5) / SS) / size) * 512;
          const uy = ((y + (sy + 0.5) / SS) / size) * 512;
          const px = 256 + (ux - 256) / scale;
          const py = 256 + (uy - 256) / scale;
          const c =
            scale < 1 && (px < 0 || px > 512 || py < 0 || py > 512)
              ? FELT
              : sample(px, py, { rounded });
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 1;
          }
        }
      }
      const i = (y * size + x) * 4;
      if (a > 0) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
        out[i + 3] = Math.round((a / (SS * SS)) * 255);
      }
    }
  }
  return out;
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const pt = (r, turn) => {
  const a = turn * 2 * Math.PI;
  return `${(256 + r * Math.sin(a)).toFixed(2)} ${(256 - r * Math.cos(a)).toFixed(2)}`;
};
/** The same wheel as vector art. */
function wheelSvg() {
  const sectors = Array.from({ length: POCKETS }, (_, i) => {
    const a = i / POCKETS;
    const b = (i + 1) / POCKETS;
    const ro = R.rimIn;
    const ri = R.pocketIn;
    return `  <path d="M${pt(ro, a)}A${ro} ${ro} 0 0 1 ${pt(ro, b)}L${pt(ri, b)}A${ri} ${ri} 0 0 0 ${pt(ri, a)}Z" fill="${hex(pocketColor(i))}" stroke="${hex(GOLD)}" stroke-width="3" />`;
  }).join('\n');
  const ball = pt(166, 12.5 / POCKETS).split(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="${hex(FELT)}" />
  <circle cx="256" cy="256" r="${(R.rimOut + R.rimIn) / 2}" fill="none" stroke="${hex(GOLD)}" stroke-width="${R.rimOut - R.rimIn}" />
${sectors}
  <circle cx="256" cy="256" r="${(R.pocketIn + R.hub) / 2}" fill="none" stroke="${hex(GOLD)}" stroke-width="${R.pocketIn - R.hub}" />
  <circle cx="256" cy="256" r="${R.hub}" fill="${hex(FELT_DARK)}" />
  <path d="M256 ${256 - R.hub}V${256 + R.hub}M${256 - R.hub} 256H${256 + R.hub}" stroke="${hex(GOLD)}" stroke-width="12" />
  <circle cx="256" cy="256" r="${R.cone}" fill="${hex(GOLD)}" />
  <circle cx="${ball[0]}" cy="${ball[1]}" r="17" fill="${hex(CREAM)}" />
</svg>
`;
}

if (process.argv.includes('--svg')) {
  writeFileSync(fileURLToPath(new URL('../public/icon.svg', import.meta.url)), wheelSvg());
  console.log('gen-icons: wrote public/icon.svg');
} else {
  const outDir = fileURLToPath(new URL('../public/icons/', import.meta.url));
  mkdirSync(outDir, { recursive: true });
  const icons = {
    'icon-192.png': [192, {}],
    'icon-512.png': [512, {}],
    // Maskable: full-bleed felt, wheel inside the 80% safe zone.
    'icon-maskable-512.png': [512, { rounded: false, scale: 0.8 }],
    // iOS applies its own mask and dislikes transparency: full-bleed.
    'apple-touch-icon.png': [180, { rounded: false, scale: 0.9 }],
  };
  for (const [name, [size, opts]] of Object.entries(icons)) {
    writeFileSync(outDir + name, encodePng(size, render(size, opts)));
  }
  console.log(`gen-icons: wrote ${Object.keys(icons).length} icons to public/icons/`);
}
