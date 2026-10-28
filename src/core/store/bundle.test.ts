import 'fake-indexeddb/auto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RunData } from '../contracts/run';
import { canonicalJson, definitionId, sha256Hex } from '../experiment';
import { makeRun } from './__fixtures__/synth';
import {
  createMemoryBackend,
  createRepo,
  decodeRunBundle,
  encodeRunBundle,
  buildRunBundle,
  galleryIndexJson,
  resultsDigest,
  runFileName,
  slugify,
  summariesCsv,
  trimRunData,
  trimSamples,
  trimSchedule,
  RUN_MIGRATIONS,
  type GalleryIndexV1,
  type RunBundleV1,
} from './index';

const parseBundle = (b: Uint8Array): RunBundleV1 =>
  JSON.parse(new TextDecoder().decode(b)) as RunBundleV1;

const FIXTURES = new URL('./__fixtures__/runs/', import.meta.url);
const run = await makeRun({
  sessions: 40,
  maxRounds: 60,
  chunkSize: 8,
  samples: 6,
  checkpoints: 24,
});
const dec = new TextDecoder();

async function roundTrip(
  data: RunData,
  gzip: boolean,
): Promise<{ a: Uint8Array; b: Uint8Array; back: RunData }> {
  const a = await encodeRunBundle(data, { gzip });
  const r = await decodeRunBundle(a, 'roulette');
  if ('error' in r) throw new Error(r.error);
  const b = await encodeRunBundle(r.data, { gzip });
  return { a, b, back: r.data };
}

describe('export -> import -> export', () => {
  it('is byte-identical, uncompressed', async () => {
    const { a, b, back } = await roundTrip(run, false);
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    expect(back.summary).toEqual(run.summary);
    expect(back.checkpoints).toEqual(run.checkpoints);
    expect(back.chunkStats).toEqual(run.chunkStats);
    expect(back.samples).toEqual(run.samples);
    expect(back.definition).toEqual(run.definition);
    expect(back.meta.runId).toBe(run.meta.runId);
    expect(back.meta.resultsDigest).toBe(await resultsDigest(run));
    expect(back.meta.imported).toMatchObject({
      appVersion: '0.1.0',
      trimmed: false,
      partial: false,
    });
  });
  it('is byte-identical, gzip, and detects gzip by magic bytes', async () => {
    const { a, b } = await roundTrip(run, true);
    expect(a[0]).toBe(0x1f);
    expect(a[1]).toBe(0x8b);
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    const plain = await encodeRunBundle(run, { gzip: false });
    expect(a.length).toBeLessThan(plain.length);
  });
  it('carries no timestamp of the export and sorts keys', async () => {
    const text = dec.decode(await encodeRunBundle(run, { gzip: false }));
    expect(text).not.toMatch(/importedAt|exportedAt/);
    expect(text.startsWith('{"app":{"id":"spinner","version":"0.1.0"},"checkpoints":')).toBe(true);
    expect(canonicalJson(JSON.parse(text) as never)).toBe(text);
  });
  it('is byte-identical for a partial run, which keeps its prefix and cannot resume', async () => {
    const partial: RunData = { ...run, meta: { ...run.meta, sessions: 80, chunks: 10 } };
    const { a, b, back } = await roundTrip(partial, false);
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    expect(back.sessions).toBe(40);
    expect(back.meta).toMatchObject({
      sessions: 80,
      completedSessions: 40,
      prefixSessions: 40,
      chunks: 10,
    });
    expect(back.meta.imported?.partial).toBe(true);
    expect(parseBundle(a).meta.partial).toEqual({ of: 80 });
  });
  it('is byte-identical for a trimmed run and keeps the full-run digest', async () => {
    const full = await resultsDigest(run);
    const { a, b } = await roundTrip({ ...run, meta: { ...run.meta, resultsDigest: full } }, false);
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    const t = await encodeRunBundle(run, { gzip: false, trimForGallery: true });
    const r = await decodeRunBundle(t, 'roulette');
    if ('error' in r) throw new Error(r.error);
    expect(r.data.meta.imported?.trimmed).toBe(true);
    expect(r.data.meta.resultsDigest).toBe(full);
    expect(r.data.checkpoints.schedule.length).toBe(24); // 24 <= 48: nothing to drop
    const again = await encodeRunBundle(r.data, { gzip: false });
    expect(Buffer.from(again).equals(Buffer.from(t))).toBe(true);
  });
  it('trims a long schedule to 48 checkpoints and re-exports the same trim', async () => {
    const big = await makeRun({
      sessions: 24,
      maxRounds: 400,
      chunkSize: 8,
      samples: 12,
      checkpoints: 128,
    });
    const t = await encodeRunBundle(big, { gzip: false, trimForGallery: true });
    const bundle = parseBundle(t);
    expect(bundle.schedule).toHaveLength(48);
    expect(bundle.meta.trimmed?.checkpoints).toHaveLength(48);
    expect(bundle.meta.trimmed?.samples).toBe(6);
    expect(bundle.samples).toHaveLength(6);
    expect(bundle.meta.resultsDigest).toBe(await resultsDigest(big));
    const r = await decodeRunBundle(t, 'roulette');
    if ('error' in r) throw new Error(r.error);
    expect(r.data.checkpoints.equity.length).toBe(24 * 48);
    expect(r.data.chunkStats.expCum.length).toBe(3 * 48);
    const again = await encodeRunBundle(r.data, { gzip: false, trimForGallery: true });
    expect(Buffer.from(again).equals(Buffer.from(t))).toBe(true);
    // the kept checkpoints are the right columns of the full matrix
    const keep = bundle.meta.trimmed?.checkpoints ?? [];
    for (let s = 0; s < 24; s++) {
      for (let j = 0; j < 48; j++) {
        expect(r.data.checkpoints.equity[s * 48 + j]).toBe(
          big.checkpoints.equity[s * 128 + (keep[j] as number)],
        );
      }
    }
  });
});

describe('import refusals', () => {
  const text = async (): Promise<Record<string, unknown>> =>
    JSON.parse(dec.decode(await encodeRunBundle(run, { gzip: false }))) as Record<string, unknown>;
  const enc = (o: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(o));
  const refuse = async (bytes: Uint8Array, game = 'roulette'): Promise<string> => {
    const r = await decodeRunBundle(bytes, game);
    if (!('error' in r)) throw new Error('was accepted');
    return r.error;
  };

  it('refuses another game', async () => {
    expect(await refuse(await encodeRunBundle(run, { gzip: false }), 'craps')).toBe(
      'this file is a roulette run; open it in the roulette lab',
    );
  });
  it('refuses a newer version and a library backup', async () => {
    expect(await refuse(enc({ ...(await text()), version: 2 }))).toMatch(/newer version/);
    expect(await refuse(enc({ format: 'casino-lab-library', version: 1 }))).toMatch(/library/);
  });
  it('refuses things that are not run files', async () => {
    expect(await refuse(new TextEncoder().encode('not json'))).toMatch(/not JSON/);
    expect(await refuse(enc({ hello: 1 }))).toMatch(/not a spinner run file/);
    expect(await refuse(enc([1, 2]))).toMatch(/not a spinner run file/);
    expect(await refuse(Uint8Array.from([0xff, 0xfe, 0xfd]))).toMatch(/UTF-8/);
    expect(await refuse(Uint8Array.from([0x1f, 0x8b, 1, 2, 3]))).toMatch(/cannot decompress/);
    expect(await refuse(new Uint8Array(0))).toMatch(/not JSON/);
  });
  it('refuses a damaged digest', async () => {
    const o = await text();
    (o.meta as { resultsDigest: string }).resultsDigest = '0'.repeat(64);
    expect(await refuse(enc(o))).toBe('file damaged: results digest mismatch');
  });
  it('refuses a tampered value (digest) and a tampered definition (id)', async () => {
    const o = await text();
    const cols = o.columns as { name: string; data: string }[];
    const net = cols.find((c) => c.name === 'net');
    if (!net) throw new Error('no net');
    const raw = Buffer.from(net.data, 'base64');
    raw[0] = (raw[0] as number) ^ 2;
    net.data = raw.toString('base64');
    expect(await refuse(enc(o))).toBe('file damaged: results digest mismatch');
    const p = await text();
    (p.definition as { name: string }).name = 'edited';
    expect(await refuse(enc(p))).toBe('file damaged: definitionId does not match');
  });
  it('refuses a length mismatch between a column and its shape', async () => {
    const o = await text();
    const cols = o.columns as { name: string; shape: number[] }[];
    (cols[0] as { shape: number[] }).shape = [41];
    expect(await refuse(enc(o))).toMatch(/column final: shape does not match/);
    const p = await text();
    const c2 = p.columns as { data: string; name: string }[];
    const f = c2.find((c) => c.name === 'expectedLoss') as { data: string };
    f.data = Buffer.from(f.data, 'base64').subarray(8).toString('base64');
    expect(await refuse(enc(p))).toMatch(/column expectedLoss: data length does not match shape/);
  });
  it('refuses disagreeing sessions, K and labels', async () => {
    const o = await text();
    (o.meta as { sessions: number }).sessions = 41;
    expect(await refuse(enc(o))).toMatch(/shape does not match/);
    const p = await text();
    (p.schedule as number[]).pop();
    expect(await refuse(enc(p))).toMatch(/checkpoints: shape does not match/);
    const q = await text();
    (q.labels as { categories: string[] }).categories.pop();
    expect(await refuse(enc(q))).toMatch(/shape does not match/);
  });
  it('refuses a bad column list, bad samples and a decompression bomb', async () => {
    const o = await text();
    (o.columns as unknown[]).pop();
    expect(await refuse(enc(o))).toMatch(/summary columns do not match/);
    const p = await text();
    p.samples = [{ index: 999 }];
    expect(await refuse(enc(p))).toMatch(/samples/);
    const bomb = gzipSync(Buffer.alloc(300 * 1024 * 1024));
    expect(await refuse(bomb)).toMatch(/too large/);
  }, 30_000);
  it('has an (empty) migration table ready for version 2', () => {
    expect(RUN_MIGRATIONS).toEqual({});
  });
});

describe('importRun into the library', () => {
  it('stores the run, and then says "already in your library"', async () => {
    const r = await decodeRunBundle(await encodeRunBundle(run, { gzip: false }), 'roulette');
    if ('error' in r) throw new Error(r.error);
    const repo = createRepo(createMemoryBackend());
    expect(await repo.importRun(r.data)).toEqual({ status: 'imported', runId: run.meta.runId });
    expect(await repo.importRun(r.data)).toEqual({ status: 'exists', runId: run.meta.runId });
    const loaded = await repo.loadRun(run.meta.runId);
    expect(loaded?.meta.status).toBe('done');
    expect(loaded?.meta.imported?.appVersion).toBe('0.1.0');
    expect(loaded?.summary).toEqual(run.summary);
    const def = await repo.getDefinition(run.meta.definitionId);
    expect(def?.origin).toBe('import');
    expect(def?.runIds).toEqual([run.meta.runId]);
    expect((await repo.importRun(r.data, { origin: 'gallery' })).status).toBe('exists');
  });
  it('assigns a new suffix when the runId exists with a different digest', async () => {
    const other = await makeRun({
      sessions: 40,
      maxRounds: 60,
      chunkSize: 8,
      samples: 6,
      checkpoints: 24,
      seed: 9,
    });
    const clash: RunData = { ...other, meta: { ...other.meta, runId: run.meta.runId } };
    const repo = createRepo(createMemoryBackend());
    await repo.importRun(run);
    const res = await repo.importRun(clash);
    expect(res.status).toBe('imported');
    expect(res.runId).not.toBe(run.meta.runId);
    expect(res.runId.startsWith(other.meta.definitionId.slice(0, 16))).toBe(true);
    expect((await repo.listRuns()).length).toBe(2);
  });
});

// `UPDATE_FIXTURES=1 npx vitest run src/core/store/bundle.test.ts` rewrites them.
const dir = new URL('v1/', FIXTURES);
if (process.env.UPDATE_FIXTURES === '1' || !existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    new URL('synth-small.spinner.json', dir),
    await encodeRunBundle(run, { gzip: false }),
  );
  const big = await makeRun({
    sessions: 24,
    maxRounds: 400,
    chunkSize: 8,
    samples: 12,
    checkpoints: 128,
  });
  writeFileSync(
    new URL('synth-trimmed.spinner.json.gz', dir),
    await encodeRunBundle(big, { gzip: true, trimForGallery: true }),
  );
}

describe('format fixtures', () => {
  const versions = readdirSync(FIXTURES).filter((v) => /^v\d+$/.test(v));
  it('has a directory per format version', () => {
    expect(versions).toContain('v1');
  });
  for (const v of versions) {
    for (const f of readdirSync(new URL(`${v}/`, FIXTURES))) {
      it(`${v}/${f} imports, validates and re-exports byte-identically`, async () => {
        const bytes = new Uint8Array(readFileSync(new URL(`${v}/${f}`, FIXTURES)));
        const r = await decodeRunBundle(bytes, 'roulette');
        if ('error' in r) throw new Error(r.error);
        expect(await definitionId(r.data.definition)).toBe(r.data.meta.definitionId);
        const gz = f.endsWith('.gz');
        const again = await encodeRunBundle(r.data, { gzip: gz });
        // compare the JSON text: a different zlib build may compress to different bytes
        const text = (b: Uint8Array): Buffer => (gz ? gunzipSync(b) : Buffer.from(b));
        expect(text(again).equals(text(bytes))).toBe(true);
        expect(await sha256Hex(bytes)).toBe(r.data.meta.imported?.fileSha256);
      });
    }
  }
});

describe('trim', () => {
  it('keeps the dense head (rounds <= 16) and spaces the rest evenly, ending on the last', () => {
    const schedule = Int32Array.from({ length: 128 }, (_, i) => (i <= 40 ? i : 40 + (i - 40) * 5));
    const idx = trimSchedule(schedule);
    expect(idx).toHaveLength(48);
    expect(idx.slice(0, 17)).toEqual(Array.from({ length: 17 }, (_, i) => i));
    expect(idx[47]).toBe(127);
    expect(new Set(idx).size).toBe(48);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    const gaps = idx.slice(17).map((v, i) => v - (idx[16 + i] as number));
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
  });
  it('is the identity for short schedules, and handles K = 49 and a long dense head', () => {
    expect(trimSchedule(Int32Array.from([0, 5, 10]))).toEqual([0, 1, 2]);
    const k49 = Int32Array.from({ length: 49 }, (_, i) => i * 3);
    const t = trimSchedule(k49);
    expect(t).toHaveLength(48);
    expect(t[47]).toBe(48);
    const dense = Int32Array.from({ length: 200 }, (_, i) => i / 2);
    expect(trimSchedule(dense)).toHaveLength(48);
    expect(trimSchedule(dense).at(-1)).toBe(199);
  });
  it('keeps at most 6 samples, spread over the list', () => {
    const s = Array.from({ length: 24 }, (_, i) => ({ index: i * 100 }) as never);
    const t = trimSamples(s);
    expect(t).toHaveLength(6);
    expect(t[0]).toBe(s[0]);
    expect(t[5]).toBe(s[23]);
    expect(trimSamples(s.slice(0, 4))).toHaveLength(4);
  });
  it('trimRunData keeps every summary row', async () => {
    const big = await makeRun({
      sessions: 24,
      maxRounds: 400,
      chunkSize: 8,
      samples: 12,
      checkpoints: 128,
    });
    const { data, info } = trimRunData(big);
    expect(data.summary).toBe(big.summary);
    expect(info.samples).toBe(6);
    expect(data.checkpoints.schedule.at(-1)).toBe(400);
  });
});

describe('summaries.csv', () => {
  it('has the header, CRLF line endings and exact money', () => {
    const csv = summariesCsv(run);
    const lines = csv.split('\r\n');
    expect(lines.at(-1)).toBe('');
    expect(lines).toHaveLength(run.sessions + 2);
    const header = (lines[0] as string).split(',');
    expect(header.slice(0, 19)).toEqual([
      'session',
      'final',
      'net',
      'peak',
      'trough',
      'max_drawdown',
      'rounds_played',
      'rounds_wagered',
      'wagered',
      'expected_loss',
      'sd',
      'luck_z',
      'ended_by',
      'stop_stage',
      'rejected',
      'deferred',
      'adjusted',
      'anomalies',
      'max_exposure',
    ]);
    expect(header.slice(19, 21)).toEqual(['rounds_in:main', 'rounds_in:recover']);
    expect(header).toContain('wagered:even-money');
    expect(header).toContain('net:neighbours');
    expect(header).toHaveLength(19 + 2 + 12 + 12);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    const row = (lines[1] as string).split(',');
    expect(row).toHaveLength(header.length);
    expect(row[0]).toBe('0');
    expect(row[2]).toBe(((run.summary.net[0] as number) / 100).toFixed(2));
  });
  it('formats cents exactly, including negatives, and the strategy reasons', () => {
    const r = structuredClone(run);
    r.summary.net[0] = -1;
    r.summary.net[1] = -1250;
    r.summary.net[2] = 123456789;
    r.summary.endedBy[3] = 16;
    r.summary.variance[4] = 0;
    const rows = summariesCsv(r).split('\r\n');
    expect((rows[1] as string).split(',')[2]).toBe('-0.01');
    expect((rows[2] as string).split(',')[2]).toBe('-12.50');
    expect((rows[3] as string).split(',')[2]).toBe('1234567.89');
    expect((rows[4] as string).split(',')[12]).toBe('strategy:target');
    expect((rows[5] as string).split(',')[11]).toBe('');
  });
  it('quotes cells that need it', () => {
    const r = structuredClone(run);
    r.meta.labels.stages[0] = 'a,"b"';
    expect((summariesCsv(r).split('\r\n')[0] as string).includes('"rounds_in:a,""b"""')).toBe(true);
  });
});

describe('file names and gallery index', () => {
  it('slugs names to kebab ASCII, 40 characters at most', () => {
    expect(slugify('Flat red')).toBe('flat-red');
    expect(slugify('  Martingale: red (8 levels)!  ')).toBe('martingale-red-8-levels');
    expect(slugify('Café déjà vu')).toBe('cafe-deja-vu');
    expect(slugify('日本語')).toBe('run');
    expect(slugify('')).toBe('run');
    expect(slugify('x'.repeat(60))).toHaveLength(40);
    expect(slugify('a'.repeat(39) + ' b')).toBe('a'.repeat(39));
  });
  it('names bundle files <slug>-<runId8>', () => {
    expect(runFileName('Flat red', 'f8126470b3609e8a-7k2m9qxd', 'gzip')).toBe(
      'flat-red-7k2m9qxd.spinner.json.gz',
    );
    expect(runFileName('Flat red', 'f8126470b3609e8a-7k2m9qxd', 'bundle')).toBe(
      'flat-red-7k2m9qxd.spinner.json',
    );
    expect(runFileName('Flat red', 'f8126470b3609e8a-7k2m9qxd', 'csv')).toBe(
      'flat-red-7k2m9qxd.summaries.csv',
    );
  });
  it('serializes the gallery index deterministically', () => {
    const index: GalleryIndexV1 = {
      format: 'casino-lab-gallery',
      version: 1,
      app: { id: 'spinner', version: '0.1.0' },
      totalBytes: 0,
      entries: [],
    };
    expect(galleryIndexJson(index)).toBe(
      '{"app":{"id":"spinner","version":"0.1.0"},"entries":[],"format":"casino-lab-gallery","totalBytes":0,"version":1}',
    );
  });
  it('the bundle object has the documented top-level shape', async () => {
    const b = await buildRunBundle(run);
    expect(Object.keys(b).sort()).toEqual(
      [
        'app',
        'checkpoints',
        'chunks',
        'columns',
        'core',
        'definition',
        'definitionId',
        'format',
        'game',
        'labels',
        'meta',
        'samples',
        'schedule',
        'version',
      ].sort(),
    );
    expect(b.columns.map((c) => c.name)).toEqual(run.meta.columns.map((c) => c.name));
    expect(b.checkpoints.encoding).toBe('dzv');
    expect(b.columns.find((c) => c.name === 'expectedLoss')?.encoding).toBe('le');
    expect(b.columns.find((c) => c.name === 'net')?.encoding).toBe('zv');
  });
});
