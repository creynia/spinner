// Gallery plumbing (decisions #8; harness-data-analysis.md §15 with architecture.md §9 naming).
// Reads gallery/*.spinner.json[.gz], enforces both size gates, validates the header, and emits
// gallery/index.json (GalleryIndexV1) plus the bundles, renamed `<slug>-<sha8>.<ext>`, into dist.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Plugin } from 'vite';

export interface GalleryHeadline {
  meanNet: number;
  seMean: number;
  pAhead: number;
  pAheadCI: [number, number];
  pBust: number;
  pBustCI: [number, number];
  expectedLossPerHour: number;
}

/** The header fields of a RunBundleV1 that the index needs (harness-data-analysis.md §10.1). */
export interface RunBundleHeader {
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

/**
 * Decodes the summary columns and computes the headline metrics. It must throw on a digest mismatch
 * for an untrimmed bundle. The real implementation calls core-store's bundle decoder and
 * core-analysis; until core-store merges the default throws for any non-empty gallery.
 */
export interface GalleryAnalyzer {
  headline(bundle: RunBundleHeader, file: string): GalleryHeadline;
}

export const pendingAnalyzer: GalleryAnalyzer = {
  headline() {
    throw new Error(
      `headline decoding needs core-store's bundle decoder (not merged yet); pass an analyzer`,
    );
  },
};

export interface GalleryOptions {
  dir?: string;
  maxBundleBytes?: number;
  maxTotalBytes?: number;
  analyzer?: GalleryAnalyzer;
  app?: { id: string; version: string };
}

export interface GalleryEntry {
  file: string;
  bytes: number;
  sha256: string;
  slug: string;
  title: string;
  notes?: string;
  tags: string[];
  game: { id: string; version: string };
  coreVersion: string;
  definitionId: string;
  runId: string;
  resultsDigest: string;
  trimmed: boolean;
  partial: boolean;
  sessions: number;
  maxRounds: number;
  bankroll: number;
  roundsPerHour: number;
  headline: GalleryHeadline;
}

export interface GalleryIndexV1 {
  format: 'casino-lab-gallery';
  version: 1;
  app: { id: string; version: string };
  totalBytes: number;
  entries: GalleryEntry[];
}

export interface GalleryBuild {
  index: GalleryIndexV1;
  /** Published file name (`<slug>-<sha8>.<ext>`) to bytes, unchanged from the committed file. */
  files: Map<string, Buffer>;
}

const BUNDLE_RE = /^(.+)\.spinner\.json(\.gz)?$/;
const MB = 1024 * 1024;

/** Canonical JSON: sorted keys, no whitespace. The index has no timestamps. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, sort(x)]),
          )
        : v;
  return JSON.stringify(sort(value));
}

function orderOf(dir: string, names: string[]): string[] {
  const p = join(dir, 'order.json');
  if (!existsSync(p)) return [...names].sort();
  const order = JSON.parse(readFileSync(p, 'utf8')) as unknown;
  if (!Array.isArray(order) || order.some((x) => typeof x !== 'string'))
    throw new Error('gallery/order.json: must be an array of file names');
  for (const n of order as string[])
    if (!names.includes(n)) throw new Error(`gallery/order.json: no such bundle ${n}`);
  const rest = names.filter((n) => !(order as string[]).includes(n)).sort();
  return [...(order as string[]), ...rest];
}

function parseHeader(raw: Buffer, file: string): RunBundleHeader {
  const text = (raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString('utf8');
  let b: RunBundleHeader;
  try {
    b = JSON.parse(text) as RunBundleHeader;
  } catch (e) {
    throw new Error(`gallery/${file}: not valid JSON (${(e as Error).message})`, {
      cause: e,
    });
  }
  if (b?.format !== 'casino-lab-run') throw new Error(`gallery/${file}: not a spinner run file`);
  if (b.version !== 1) throw new Error(`gallery/${file}: unsupported bundle version ${b.version}`);
  if (b.game?.id !== 'roulette')
    throw new Error(`gallery/${file}: game is ${String(b.game?.id)}, expected roulette`);
  if (!b.definition || !b.meta?.runId || !b.meta.resultsDigest)
    throw new Error(`gallery/${file}: missing definition or run metadata`);
  return b;
}

/** Pure: read `dir`, validate, and build the index and the files to publish. Throws on any violation. */
export function buildGallery(opts: GalleryOptions = {}): GalleryBuild {
  const dir = opts.dir ?? 'gallery';
  const maxBundle = opts.maxBundleBytes ?? 2 * MB;
  const maxTotal = opts.maxTotalBytes ?? 20 * MB;
  const analyzer = opts.analyzer ?? pendingAnalyzer;
  const app = opts.app ?? { id: 'spinner', version: '0.0.0' };

  const names = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && BUNDLE_RE.test(e.name))
        .map((e) => e.name)
    : [];
  const orderPath = join(dir, 'order.json');
  let total = existsSync(orderPath) ? statSync(orderPath).size : 0;
  for (const n of names) {
    const bytes = statSync(join(dir, n)).size;
    if (bytes > maxBundle)
      throw new Error(`gallery/${n}: ${bytes} bytes is over the ${maxBundle} byte bundle limit`);
    total += bytes;
  }
  if (total > maxTotal)
    throw new Error(`gallery: ${total} bytes is over the ${maxTotal} byte folder limit`);

  const files = new Map<string, Buffer>();
  const entries: GalleryEntry[] = [];
  let totalBytes = 0;
  for (const n of orderOf(dir, names)) {
    const raw = readFileSync(join(dir, n));
    const m = BUNDLE_RE.exec(n)!;
    const slug = m[1]!;
    const sha256 = createHash('sha256').update(raw).digest('hex');
    const b = parseHeader(raw, n);
    let headline: GalleryHeadline;
    try {
      headline = analyzer.headline(b, n);
    } catch (e) {
      throw new Error(`gallery/${n}: ${(e as Error).message}`, { cause: e });
    }
    const file = `${slug}-${sha256.slice(0, 8)}.spinner.json${m[2] ?? ''}`;
    files.set(file, raw);
    totalBytes += raw.length;
    entries.push({
      file,
      bytes: raw.length,
      sha256,
      slug,
      title: b.definition.name,
      notes: b.definition.notes,
      tags: b.definition.tags ?? [],
      game: b.game,
      coreVersion: b.core.version,
      definitionId: b.definitionId,
      runId: b.meta.runId,
      resultsDigest: b.meta.resultsDigest,
      trimmed: !!b.meta.trimmed,
      partial: !!b.meta.partial,
      sessions: b.meta.sessions,
      maxRounds: b.definition.session.maxRounds,
      bankroll: b.definition.session.bankroll,
      roundsPerHour: b.definition.session.roundsPerHour,
      headline,
    });
  }
  return { index: { format: 'casino-lab-gallery', version: 1, app, totalBytes, entries }, files };
}

export function galleryPlugin(opts: GalleryOptions = {}): Plugin {
  let root = process.cwd();
  const options = (): GalleryOptions => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
    return {
      app: { id: 'spinner', version: pkg.version },
      ...opts,
      dir: resolve(root, opts.dir ?? 'gallery'),
    };
  };
  let built: GalleryBuild | undefined;
  return {
    name: 'spinner-gallery',
    configResolved(config) {
      root = config.root;
    },
    buildStart() {
      try {
        built = buildGallery(options());
      } catch (e) {
        this.error((e as Error).message);
      }
    },
    generateBundle() {
      if (!built) return;
      this.emitFile({
        type: 'asset',
        fileName: 'gallery/index.json',
        source: canonicalJson(built.index),
      });
      for (const [file, source] of built.files) {
        this.emitFile({ type: 'asset', fileName: `gallery/${file}`, source });
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/gallery\/([^/?]+)(?:\?.*)?$/.exec(req.url ?? '');
        if (!m) return next();
        try {
          const g = buildGallery(options());
          if (m[1] === 'index.json') {
            res.setHeader('content-type', 'application/json');
            res.end(canonicalJson(g.index));
            return;
          }
          const f = g.files.get(decodeURIComponent(m[1]!));
          if (!f) return next();
          res.setHeader(
            'content-type',
            m[1]!.endsWith('.gz') ? 'application/gzip' : 'application/json',
          );
          res.end(f);
        } catch (e) {
          res.statusCode = 500;
          res.end((e as Error).message);
        }
      });
    },
  };
}
