// core/store: IndexedDB wrapper with memory fallback, stores, export/import, RunSink
// (owner: core-store). WP0 ships throwing stubs with the signatures of harness-data-analysis.md
// §9-§10 and §16.2 (`resultsDigest` and the bundle codec live here: reconciliation R3).
import type { RunData, RunSink } from '../contracts/run';

/** The ten IndexedDB stores of schema v1 (harness-data-analysis.md §9.1; reconciliation R6). */
export const STORE_NAMES = [
  'definitions',
  'strategies',
  'runs',
  'runParts',
  'summaries',
  'checkpoints',
  'breakdowns',
  'samples',
  'groups',
  'settings',
] as const;
export type StoreName = (typeof STORE_NAMES)[number];

/** Operations inside one atomic transaction. */
export interface TxOps {
  put(store: StoreName, value: unknown): void;
  delete(store: StoreName, key: IDBValidKey): void;
}

/** Storage backend: IndexedDB, or `Map`s with `structuredClone` as the memory fallback (§9.2). */
export interface Backend {
  readonly kind: 'idb' | 'memory';
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>;
  getAll<T>(store: StoreName, index?: string, range?: IDBKeyRange): Promise<T[]>;
  tx(stores: StoreName[], mode: 'readonly' | 'readwrite', fn: (t: TxOps) => void): Promise<void>;
}

/** Never throws; falls back to the memory backend with `persistent: false` (§9.3). */
export function openStore(_name: string): Promise<{ backend: Backend; persistent: boolean }> {
  throw new Error('TODO(core-store)');
}

/** The `RunSink` the harness writes through (contracts/run.ts). */
export function createRunSink(_backend: Backend): RunSink {
  throw new Error('TODO(core-store)');
}

export function resultsDigest(_data: RunData): Promise<string> {
  throw new Error('TODO(core-store)');
}

export function encodeRunBundle(
  _data: RunData,
  _opts?: { gzip?: boolean; trimForGallery?: boolean },
): Promise<Uint8Array> {
  throw new Error('TODO(core-store)');
}

export function decodeRunBundle(
  _bytes: Uint8Array,
  _gameId: string,
): Promise<{ data: RunData } | { error: string }> {
  throw new Error('TODO(core-store)');
}

export function summariesCsv(_data: RunData): string {
  throw new Error('TODO(core-store)');
}
