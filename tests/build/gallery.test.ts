import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// build/ belongs to the node tsconfig project, which this (app-project) test cannot reference, so
// the plugin module is loaded dynamically and typed by the minimal shapes used here.
interface RunBundleHeader {
  format: string;
  version: number;
  core: { version: string };
  game: { id: string; version: string };
  definitionId: string;
  definition: {
    name: string;
    notes?: string;
    tags?: string[];
    session: { bankroll: number; maxRounds: number; roundsPerHour: number };
  };
  meta: {
    runId: string;
    sessions: number;
    resultsDigest: string;
    partial?: unknown;
    trimmed?: unknown;
  };
}
interface GalleryAnalyzer {
  headline: (bundle: RunBundleHeader, file: string) => unknown;
}
interface GalleryOptions {
  dir?: string;
  maxBundleBytes?: number;
  maxTotalBytes?: number;
  analyzer?: GalleryAnalyzer;
  app?: { id: string; version: string };
}
interface Built {
  index: { app: { version: string }; totalBytes: number; format: string; entries: Entry[] };
  files: Map<string, Buffer>;
}
interface Entry {
  file: string;
  bytes: number;
  sha256: string;
  slug: string;
  trimmed: boolean;
  [k: string]: unknown;
}
const modPath = '../../build/vite-plugin-gallery.ts';
const { buildGallery, canonicalJson, pendingAnalyzer } = (await import(
  /* @vite-ignore */ modPath
)) as {
  buildGallery: (o?: GalleryOptions) => Built;
  canonicalJson: (v: unknown) => string;
  pendingAnalyzer: GalleryAnalyzer;
};

const headline = {
  meanNet: -1234,
  seMean: 12,
  pAhead: 0.4,
  pAheadCI: [0.39, 0.41] as [number, number],
  pBust: 0.1,
  pBustCI: [0.09, 0.11] as [number, number],
  expectedLossPerHour: 5000,
};
const analyzer: GalleryAnalyzer = {
  headline(b) {
    if (b.meta.resultsDigest === 'bad' && !b.meta.trimmed) throw new Error('file damaged');
    return headline;
  },
};

function bundle(over: Partial<RunBundleHeader> = {}, padding = 0): Buffer {
  const b: RunBundleHeader & { pad?: string } = {
    format: 'casino-lab-run',
    version: 1,
    core: { version: '1.0.0' },
    game: { id: 'roulette', version: '1' },
    definitionId: 'def1',
    definition: {
      name: 'Flat red',
      notes: 'n',
      tags: ['flat'],
      session: { bankroll: 100000, maxRounds: 500, roundsPerHour: 60 },
    },
    meta: {
      runId: 'run1',
      sessions: 10000,
      resultsDigest: 'abc',
      trimmed: { checkpoints: [], samples: 6 },
    },
    ...over,
  };
  if (padding) b.pad = 'x'.repeat(padding);
  return Buffer.from(JSON.stringify(b));
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gallery-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const put = (name: string, data: Buffer) => writeFileSync(join(dir, name), data);

describe('buildGallery', () => {
  it('gives an empty index for an empty or missing folder', () => {
    const empty = buildGallery({ dir, analyzer });
    expect(empty.index.entries).toEqual([]);
    expect(empty.index.totalBytes).toBe(0);
    expect(empty.index.format).toBe('casino-lab-gallery');
    expect(buildGallery({ dir: join(dir, 'nope'), analyzer }).index.entries).toEqual([]);
  });

  it('indexes a plain and a gzipped bundle with hashed file names', () => {
    const raw = bundle();
    const gz = gzipSync(
      bundle({ definitionId: 'def2', meta: { runId: 'r2', sessions: 5, resultsDigest: 'd' } }),
    );
    put('a-flat.spinner.json', raw);
    put('b-other.spinner.json.gz', gz);
    const { index, files } = buildGallery({
      dir,
      analyzer,
      app: { id: 'spinner', version: '9.9.9' },
    });
    expect(index.app.version).toBe('9.9.9');
    const [a, b] = index.entries;
    expect(a).toMatchObject({
      slug: 'a-flat',
      title: 'Flat red',
      tags: ['flat'],
      trimmed: true,
      partial: false,
      sessions: 10000,
      maxRounds: 500,
      bankroll: 100000,
      roundsPerHour: 60,
      runId: 'run1',
      bytes: raw.length,
      headline,
    });
    const sha = createHash('sha256').update(raw).digest('hex');
    expect(a!.sha256).toBe(sha);
    expect(a!.file).toBe(`a-flat-${sha.slice(0, 8)}.spinner.json`);
    expect(b!.file).toMatch(/^b-other-[0-9a-f]{8}\.spinner\.json\.gz$/);
    expect(files.get(a!.file)!.equals(raw)).toBe(true);
    expect(files.get(b!.file)!.equals(gz)).toBe(true);
    expect(index.totalBytes).toBe(raw.length + gz.length);
  });

  it('is deterministic and honours order.json', () => {
    put('a.spinner.json', bundle());
    put('b.spinner.json', bundle({ definitionId: 'd2' }));
    const first = buildGallery({ dir, analyzer });
    expect(first.index.entries.map((e) => e.slug)).toEqual(['a', 'b']);
    expect(canonicalJson(buildGallery({ dir, analyzer }).index)).toBe(canonicalJson(first.index));
    put('order.json', Buffer.from('["b.spinner.json"]'));
    expect(buildGallery({ dir, analyzer }).index.entries.map((e) => e.slug)).toEqual(['b', 'a']);
  });

  it('fails a bundle over the per-bundle limit', () => {
    put('big.spinner.json', bundle({}, 2000));
    expect(() => buildGallery({ dir, analyzer, maxBundleBytes: 1000 })).toThrow(
      /big\.spinner\.json.*bundle limit/,
    );
  });

  it('fails when the folder is over the total limit', () => {
    put('a.spinner.json', bundle());
    put('b.spinner.json', bundle({ definitionId: 'd2' }));
    const one = bundle().length;
    expect(() => buildGallery({ dir, analyzer, maxTotalBytes: one + 10 })).toThrow(/folder limit/);
  });

  it('fails a bad digest (the analyzer throws), naming the file', () => {
    put('x.spinner.json', bundle({ meta: { runId: 'r', sessions: 1, resultsDigest: 'bad' } }));
    expect(() => buildGallery({ dir, analyzer })).toThrow('gallery/x.spinner.json: file damaged');
  });

  it('fails the wrong game and non-bundle content', () => {
    put('c.spinner.json', bundle({ game: { id: 'craps', version: '1' } }));
    expect(() => buildGallery({ dir, analyzer })).toThrow(/craps, expected roulette/);
    rmSync(join(dir, 'c.spinner.json'));
    put('d.spinner.json', Buffer.from('{"format":"other"}'));
    expect(() => buildGallery({ dir, analyzer })).toThrow(/not a spinner run file/);
    put('d.spinner.json', Buffer.from('nope'));
    expect(() => buildGallery({ dir, analyzer })).toThrow(/not valid JSON/);
  });

  it('rejects an order.json naming a missing bundle', () => {
    put('a.spinner.json', bundle());
    put('order.json', Buffer.from('["zzz.spinner.json"]'));
    expect(() => buildGallery({ dir, analyzer })).toThrow(/no such bundle/);
  });

  it('the default analyzer refuses until core-store lands, but an empty gallery still builds', () => {
    expect(buildGallery({ dir }).index.entries).toEqual([]);
    put('a.spinner.json', bundle());
    expect(() => buildGallery({ dir })).toThrow(/core-store/);
    expect(() =>
      pendingAnalyzer.headline(JSON.parse(bundle().toString()) as RunBundleHeader, 'f'),
    ).toThrow();
  });
});
