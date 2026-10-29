// Run bundle `<slug>-<runId8>.spinner.json[.gz]` (harness-data-analysis.md §10.1-§10.2):
// canonical JSON, no timestamps, so export -> import -> export is byte-identical.
import type { Json } from '../contracts/game';
import type { NormalizedDefinition } from '../contracts/experiment';
import {
  RUN_FORMAT,
  RUN_FORMAT_VERSION,
  type ChunkStatsColumns,
  type ColumnSpec,
  type RunData,
  type RunLabels,
  type RunMeta,
  type SampleSession,
  type SessionError,
  type SummaryColumn,
} from '../contracts/run';
import {
  canonicalJson,
  compressBytes,
  decompressBytes,
  definitionId as hashDefinition,
  DefinitionFormatError,
  hasCompression,
  isGzip,
  migrateDefinition,
  runId8,
  runKey,
  runMigrations,
  sha256Hex,
  simKey,
  type MigrationTable,
} from '../experiment';
import {
  columnsOf,
  SUMMARY_COLUMN_DEFS,
  summaryColumnSpecs,
  tableFrom,
  type TypedArray,
} from './columns';
import { decodeArray, defaultEncoding, encodeArray, type EncodedArray } from './codec';
import { resultsDigest } from './digest';

export const APP_ID = 'spinner';
/** The gallery trim (decisions.md, "Later user decisions"; harness-data-analysis.md §10.1). */
export const GALLERY_TRIM = { checkpoints: 48, samples: 6 } as const;
/** Decompressed size above which an import is refused. */
export const MAX_BUNDLE_BYTES = 256 * 1024 * 1024;

export interface RunBundleV1 {
  format: typeof RUN_FORMAT;
  version: 1;
  app: { id: string; version: string };
  core: { version: string };
  game: { id: string; version: string };
  definitionId: string;
  definition: NormalizedDefinition;
  meta: {
    runId: string;
    createdAt: string;
    sessions: number;
    chunkSize: number;
    resultsDigest: string;
    partial?: { of: number };
    trimmed?: { checkpoints: number[]; samples: number };
  };
  labels: RunLabels;
  schedule: number[];
  columns: EncodedArray[];
  checkpoints: EncodedArray;
  chunks: {
    expCum: EncodedArray;
    catExpected: EncodedArray;
    stageWagered: EncodedArray;
    stageNet: EncodedArray;
    stageExpected: EncodedArray;
    transitions: EncodedArray;
    rejectedByReason: Record<string, number>[];
    deferredByReason: Record<string, number>[];
    errors: SessionError[];
    errorCount: number;
  };
  samples: SampleSession[];
}

/** Past bundle versions migrate here (`RUN_MIGRATIONS[v]`: v -> v + 1). Version 1 is current. */
export const RUN_MIGRATIONS: MigrationTable = {};

/** `imported` carries one extra field so a trimmed run re-exports with the same trim record. */
type TrimInfo = { checkpoints: number[]; samples: number };
function trimInfoOf(meta: RunMeta): TrimInfo | undefined {
  const imported = meta.imported as { trimInfo?: TrimInfo } | undefined;
  return imported?.trimInfo;
}

// ---------------------------------------------------------------- slug and file names

/** Kebab-cased ASCII, at most 40 characters, `run` if empty (§10.1). */
export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return s || 'run';
}

/** `<slug>-<runId8>.spinner.json[.gz]` or `.summaries.csv`. */
export function runFileName(
  definitionName: string,
  runId: string,
  kind: 'bundle' | 'gzip' | 'csv',
): string {
  const base = `${slugify(definitionName)}-${runId8(runId)}`;
  return kind === 'csv'
    ? `${base}.summaries.csv`
    : `${base}.spinner.json${kind === 'gzip' ? '.gz' : ''}`;
}

// ---------------------------------------------------------------- the gallery trim

/**
 * Indices into `schedule` that the trim keeps: every dense-head point up to round 16, then evenly
 * spaced by index, always the last; `keep` in all (or everything when the schedule is short).
 */
export function trimSchedule(
  schedule: ArrayLike<number>,
  keep: number = GALLERY_TRIM.checkpoints,
): number[] {
  const K = schedule.length;
  if (K <= keep) return Array.from({ length: K }, (_, i) => i);
  let head = 0;
  while (head < K && (schedule[head] as number) <= 16) head++;
  head = Math.min(head, keep - 1);
  const out: number[] = [];
  for (let i = 0; i < head; i++) out.push(i);
  const slots = keep - head;
  const span = K - head; // indices head..K-1 are candidates; the last one is always taken
  for (let j = 1; j <= slots; j++) {
    // head - 1 + round(j * span / slots), exact integer arithmetic
    out.push(head - 1 + Math.floor((2 * j * span + slots) / (2 * slots)));
  }
  return out;
}

/** At most `keep` samples, evenly spaced over the list (first and last included). */
export function trimSamples(
  samples: SampleSession[],
  keep: number = GALLERY_TRIM.samples,
): SampleSession[] {
  if (samples.length <= keep) return samples;
  const out: SampleSession[] = [];
  for (let i = 0; i < keep; i++) {
    out.push(
      samples[
        Math.floor((2 * i * (samples.length - 1) + (keep - 1)) / (2 * (keep - 1)))
      ] as SampleSession,
    );
  }
  return out;
}

function pickColumns(src: Int32Array | Float64Array, rows: number, width: number, pick: number[]) {
  const out = new (src.constructor as { new (n: number): Int32Array | Float64Array })(
    rows * pick.length,
  );
  for (let r = 0; r < rows; r++) {
    for (let j = 0; j < pick.length; j++)
      out[r * pick.length + j] = src[r * width + (pick[j] as number)] as number;
  }
  return out;
}

/** Applies the gallery trim to run data: K' checkpoints (also in `expCum`), at most 6 samples. */
export function trimRunData(data: RunData): {
  data: RunData;
  info: { checkpoints: number[]; samples: number };
} {
  const pick = trimSchedule(data.checkpoints.schedule);
  const K = data.checkpoints.schedule.length;
  const sched = Int32Array.from(pick.map((i) => data.checkpoints.schedule[i] as number));
  const samples = trimSamples(data.samples);
  const cs = data.chunkStats;
  return {
    info: { checkpoints: pick, samples: samples.length },
    data: {
      ...data,
      checkpoints: {
        schedule: sched,
        equity: pickColumns(data.checkpoints.equity, data.sessions, K, pick) as Int32Array,
      },
      chunkStats: { ...cs, expCum: pickColumns(cs.expCum, cs.chunks, K, pick) as Float64Array },
      samples,
    },
  };
}

// ---------------------------------------------------------------- encode

function chunkArrays(
  cs: ChunkStatsColumns,
  K: number,
  C: number,
  S: number,
): RunBundleV1['chunks'] {
  const f = (name: string, a: Float64Array, w: number): EncodedArray =>
    encodeArray(a, 'f64', [cs.chunks, w], 'le', name);
  return {
    expCum: f('expCum', cs.expCum, K),
    catExpected: f('catExpected', cs.catExpected, C),
    stageWagered: f('stageWagered', cs.stageWagered, S),
    stageNet: f('stageNet', cs.stageNet, S),
    stageExpected: f('stageExpected', cs.stageExpected, S),
    transitions: encodeArray(cs.transitions, 'i32', [cs.chunks, S * S], 'zv', 'transitions'),
    rejectedByReason: cs.rejectedByReason,
    deferredByReason: cs.deferredByReason,
    errors: cs.errors,
    errorCount: cs.errorCount,
  };
}

/** The bundle object (before serialization) for run data; mostly for tests and the gallery. */
export async function buildRunBundle(
  data: RunData,
  opts: { trimForGallery?: boolean } = {},
): Promise<RunBundleV1> {
  const { meta } = data;
  const digest = meta.resultsDigest ?? (await resultsDigest(data));
  let out = data;
  let trimmed = trimInfoOf(meta);
  if (opts.trimForGallery && !trimmed) {
    const t = trimRunData(data);
    out = t.data;
    trimmed = t.info;
  }
  const cols = columnsOf(out.summary);
  const K = out.checkpoints.schedule.length;
  const C = meta.labels.categories.length;
  const S = meta.labels.stages.length;
  return {
    format: RUN_FORMAT,
    version: RUN_FORMAT_VERSION,
    app: { id: APP_ID, version: meta.appVersion },
    core: { version: meta.coreVersion },
    game: { id: meta.gameId, version: meta.gameVersion },
    definitionId: meta.definitionId,
    definition: out.definition,
    meta: {
      runId: meta.runId,
      createdAt: meta.createdAt,
      sessions: out.sessions,
      chunkSize: meta.chunkSize,
      resultsDigest: digest,
      ...(meta.sessions > out.sessions ? { partial: { of: meta.sessions } } : {}),
      ...(trimmed ? { trimmed } : {}),
    },
    labels: meta.labels,
    schedule: Array.from(out.checkpoints.schedule),
    columns: meta.columns.map((spec) =>
      encodeArray(
        cols[spec.name],
        spec.dtype,
        spec.width === 1 && !isWide(spec.name) ? [out.sessions] : [out.sessions, spec.width],
        defaultEncoding(spec.dtype),
        spec.name,
      ),
    ),
    checkpoints: encodeArray(
      out.checkpoints.equity,
      'i32',
      [out.sessions, K],
      'dzv',
      'checkpoints',
    ),
    chunks: chunkArrays(out.chunkStats, K, C, S),
    samples: out.samples,
  };
}

const isWide = (name: SummaryColumn): boolean =>
  SUMMARY_COLUMN_DEFS.find((c) => c.name === name)?.wide !== undefined;

export async function encodeRunBundle(
  data: RunData,
  opts: { gzip?: boolean; trimForGallery?: boolean } = {},
): Promise<Uint8Array> {
  return (await encodeRunBundleWithDigest(data, opts)).bytes;
}

/** `encodeRunBundle` plus the `resultsDigest` it wrote into the bundle (sync.md §4.1). */
export async function encodeRunBundleWithDigest(
  data: RunData,
  opts: { gzip?: boolean; trimForGallery?: boolean } = {},
): Promise<{ bytes: Uint8Array; resultsDigest: string }> {
  const bundle = await buildRunBundle(data, opts.trimForGallery ? { trimForGallery: true } : {});
  const bytes = new TextEncoder().encode(canonicalJson(bundle as unknown as Json));
  const gz = opts.gzip ?? hasCompression();
  return {
    bytes: gz ? await compressBytes(bytes, 'gzip') : bytes,
    resultsDigest: bundle.meta.resultsDigest,
  };
}

// ---------------------------------------------------------------- decode and validate

export interface DecodeOptions {
  /** Import timestamp (default: now). Not written to files. */
  now?: () => string;
}

class BundleError extends Error {}
const fail = (m: string): never => {
  throw new BundleError(m);
};
const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isPosInt = (x: unknown): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 1;
const isUint = (x: unknown): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;

function strings(x: unknown, what: string): string[] {
  if (!Array.isArray(x) || !x.every(isStr)) fail(`${what} must be a list of strings`);
  return x as string[];
}

function decodeShaped(e: unknown, what: string, shape: number[], dtype: string): TypedArray {
  if (!isObj(e)) return fail(`${what}: not an encoded array`);
  const a = e as unknown as EncodedArray;
  if (a.dtype !== dtype) fail(`${what}: expected dtype ${dtype}`);
  if (
    !Array.isArray(a.shape) ||
    a.shape.length !== shape.length ||
    a.shape.some((n, i) => n !== shape[i])
  ) {
    fail(`${what}: shape does not match the run (expected [${shape.join(', ')}])`);
  }
  try {
    return decodeArray(a, what);
  } catch (err) {
    return fail(err instanceof Error ? err.message : `${what}: cannot decode`);
  }
}

async function parseBundle(
  bytes: Uint8Array,
  gameId: string,
  opts: DecodeOptions,
): Promise<RunData> {
  let raw = bytes;
  if (isGzip(raw)) {
    try {
      raw = await decompressBytes(raw, 'gzip', MAX_BUNDLE_BYTES);
    } catch (e) {
      fail(e instanceof RangeError ? 'file too large' : 'file damaged: cannot decompress');
    }
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return fail('not a spinner run file: not UTF-8 text');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('not a spinner run file: not JSON');
  }
  if (!isObj(parsed)) return fail('not a spinner run file');
  if (parsed.format === 'casino-lab-library') {
    return fail('this is a library backup, not a run: use the library import');
  }
  if (parsed.format !== RUN_FORMAT) fail('not a spinner run file');
  if (typeof parsed.version === 'number' && parsed.version > RUN_FORMAT_VERSION) {
    fail('made with a newer version: update the app to open this file');
  }
  let doc: Record<string, unknown>;
  try {
    doc = runMigrations(
      parsed,
      RUN_FORMAT_VERSION,
      RUN_MIGRATIONS,
      'run file',
      (m) => new BundleError(m),
      'version',
    );
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'cannot migrate the run file');
  }
  const b = doc as unknown as RunBundleV1;
  if (!isObj(b.game) || !isStr(b.game.id) || !isStr(b.game.version)) fail('file damaged: game');
  if (b.game.id !== gameId)
    fail(`this file is a ${b.game.id} run; open it in the ${b.game.id} lab`);
  if (!isObj(b.app) || !isStr(b.app.version)) fail('file damaged: app');
  if (!isObj(b.core) || !isStr(b.core.version)) fail('file damaged: core');
  if (!isObj(b.meta)) return fail('file damaged: meta');
  const m = b.meta;
  if (!isStr(m.runId) || !isStr(m.createdAt) || !isStr(m.resultsDigest)) fail('file damaged: meta');
  if (!isPosInt(m.sessions) || !isPosInt(m.chunkSize)) fail('file damaged: sessions or chunkSize');
  const sessions = m.sessions;
  if (
    m.partial !== undefined &&
    !(isObj(m.partial) && isPosInt(m.partial.of) && m.partial.of >= sessions)
  ) {
    fail('file damaged: partial');
  }
  if (
    m.trimmed !== undefined &&
    !(
      isObj(m.trimmed) &&
      Array.isArray(m.trimmed.checkpoints) &&
      m.trimmed.checkpoints.every(isUint) &&
      isUint(m.trimmed.samples)
    )
  ) {
    fail('file damaged: trimmed');
  }

  // definition
  let definition: NormalizedDefinition;
  try {
    definition = migrateDefinition(b.definition) as NormalizedDefinition;
  } catch (e) {
    return fail(e instanceof DefinitionFormatError ? e.message : 'file damaged: definition');
  }
  if ((await hashDefinition(definition)) !== b.definitionId)
    fail('file damaged: definitionId does not match');

  // labels, schedule, columns
  if (!isObj(b.labels)) return fail('file damaged: labels');
  const labels: RunLabels = {
    stages: strings(b.labels.stages, 'labels.stages'),
    categories: strings(b.labels.categories, 'labels.categories'),
    reasons: strings(b.labels.reasons, 'labels.reasons'),
  };
  const S = labels.stages.length;
  const C = labels.categories.length;
  if (!Array.isArray(b.schedule) || b.schedule.length === 0 || !b.schedule.every(isUint)) {
    fail('file damaged: schedule');
  }
  for (let i = 1; i < b.schedule.length; i++) {
    if ((b.schedule[i] as number) <= (b.schedule[i - 1] as number))
      fail('file damaged: schedule is not increasing');
  }
  const K = b.schedule.length;
  const specs = summaryColumnSpecs(S, C);
  if (!Array.isArray(b.columns) || b.columns.length !== specs.length) {
    fail('file damaged: summary columns do not match this version');
  }
  const decoded: Partial<Record<SummaryColumn, TypedArray>> = {};
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i] as ColumnSpec;
    const e = b.columns[i] as EncodedArray;
    if (!isObj(e) || e.name !== spec.name) fail(`file damaged: expected column ${spec.name}`);
    decoded[spec.name] = decodeShaped(
      e,
      `column ${spec.name}`,
      isWide(spec.name) ? [sessions, spec.width] : [sessions],
      spec.dtype,
    );
  }
  const summary = tableFrom(sessions, specs, (n) => decoded[n]);
  const equity = decodeShaped(b.checkpoints, 'checkpoints', [sessions, K], 'i32') as Int32Array;

  // chunk stats
  const chunks = Math.ceil(sessions / m.chunkSize);
  if (!isObj(b.chunks)) return fail('file damaged: chunks');
  const ch = b.chunks;
  const f = (
    k: 'expCum' | 'catExpected' | 'stageWagered' | 'stageNet' | 'stageExpected',
    w: number,
  ): Float64Array => decodeShaped(ch[k], `chunks.${k}`, [chunks, w], 'f64') as Float64Array;
  const perChunk = (x: unknown, what: string): Record<string, number>[] => {
    if (!Array.isArray(x) || x.length !== chunks || !x.every(isObj)) fail(`file damaged: ${what}`);
    return x as Record<string, number>[];
  };
  if (!Array.isArray(ch.errors) || !isUint(ch.errorCount)) fail('file damaged: chunk errors');
  const chunkStats: ChunkStatsColumns = {
    chunks,
    expCum: f('expCum', K),
    catExpected: f('catExpected', C),
    stageWagered: f('stageWagered', S),
    stageNet: f('stageNet', S),
    stageExpected: f('stageExpected', S),
    transitions: decodeShaped(
      ch.transitions,
      'chunks.transitions',
      [chunks, S * S],
      'i32',
    ) as Int32Array,
    rejectedByReason: perChunk(ch.rejectedByReason, 'rejectedByReason'),
    deferredByReason: perChunk(ch.deferredByReason, 'deferredByReason'),
    errors: ch.errors,
    errorCount: ch.errorCount,
  };

  // samples
  if (
    !Array.isArray(b.samples) ||
    !b.samples.every((s) => isObj(s) && isUint(s.index) && s.index < sessions)
  ) {
    fail('file damaged: samples');
  }

  // metadata
  const fullSessions = m.partial?.of ?? sessions;
  const chunkCount = Math.ceil(fullSessions / m.chunkSize);
  const bitmap = new Uint8Array(Math.ceil(chunkCount / 8));
  for (let c = 0; c < chunks; c++) bitmap[c >> 3] = (bitmap[c >> 3] as number) | (1 << (c & 7));
  const trimmed = m.trimmed !== undefined;
  const meta: RunMeta = {
    v: 1,
    runId: m.runId,
    definitionId: b.definitionId,
    simKey: await simKey(definition, b.game.version, b.core.version),
    runKey: await runKey(b.definitionId, b.game.version, b.core.version),
    gameId: b.game.id,
    gameVersion: b.game.version,
    coreVersion: b.core.version,
    appVersion: b.app.version,
    createdAt: m.createdAt,
    status: 'done',
    sessions: fullSessions,
    completedSessions: sessions,
    prefixSessions: sessions,
    chunkSize: m.chunkSize,
    chunks: chunkCount,
    bitmap,
    schedule: Int32Array.from(b.schedule),
    labels,
    columns: specs,
    storage: 'memory',
    device: { cores: 0, workers: 0, ua: '' },
    timing: { elapsedMs: 0 },
    resumes: [],
    visibility: [],
    resultsDigest: m.resultsDigest,
    imported: {
      appVersion: b.app.version,
      importedAt: (opts.now ?? (() => new Date().toISOString()))(),
      fileSha256: await sha256Hex(bytes),
      trimmed,
      partial: m.partial !== undefined,
      ...(m.trimmed ? { trimInfo: m.trimmed } : {}),
    },
  };
  const data: RunData = {
    meta,
    definition,
    sessions,
    summary,
    checkpoints: { schedule: Int32Array.from(b.schedule), equity },
    chunkStats,
    samples: b.samples,
  };
  // 6. Unless trimmed, the digest must verify.
  if (!trimmed && (await resultsDigest(data)) !== m.resultsDigest)
    fail('file damaged: results digest mismatch');
  return data;
}

/**
 * The import pipeline up to storage (§10.2): gunzip by magic, parse, check format and version,
 * migrate, refuse another game, validate every shape, verify the digest of an untrimmed bundle.
 * The result's `meta.imported` is set; the caller stores it. Never throws.
 */
export async function decodeRunBundle(
  bytes: Uint8Array,
  gameId: string,
  opts: DecodeOptions = {},
): Promise<{ data: RunData } | { error: string }> {
  try {
    return { data: await parseBundle(bytes, gameId, opts) };
  } catch (e) {
    if (e instanceof BundleError) return { error: e.message };
    return { error: 'cannot read this file' };
  }
}
