import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ICONS: [file: string, size: number][] = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],
  ['apple-touch-icon.png', 180],
];

describe('generated icons', () => {
  beforeAll(() => {
    execFileSync('node', ['scripts/gen-icons.mjs'], { cwd: root, stdio: 'pipe' });
  });

  it.each(ICONS)('%s is a PNG of %i px square, RGBA 8-bit', (file, size) => {
    const png = readFileSync(new URL(`public/icons/${file}`, root));
    expect(png.subarray(0, 8).equals(SIGNATURE)).toBe(true);
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(6);
    expect(png.subarray(-8, -4).toString('ascii')).toBe('IEND');
  });

  it('the manifest lists the generated PNGs (not the apple-touch icon) plus the SVG', () => {
    const m = JSON.parse(readFileSync(new URL('public/manifest.webmanifest', root), 'utf8')) as {
      icons: { src: string; sizes: string }[];
    };
    const srcs = m.icons.map((i) => i.src).sort();
    const manifested = ICONS.filter(([f]) => f !== 'apple-touch-icon.png');
    expect(srcs).toEqual(['icon.svg', ...manifested.map(([f]) => `icons/${f}`)].sort());
  });

  it('icon.svg is the 37-pocket wheel', () => {
    const svg = readFileSync(new URL('public/icon.svg', root), 'utf8');
    expect(svg.match(/<path d="M[^"]+Z"/g)).toHaveLength(37);
  });
});
