// The sync engine (sync.md §4.4, §7.3). STUB from WP-S0; WP-S2b writes cycle/apply/push,
// WP-S2c the runs, GC, first-sync and erase parts.
import type { DefinitionRecord } from '../contracts/experiment';
import type { RunMeta } from '../contracts/run';
import type {
  CycleResult,
  FirstSyncPreview,
  RemoteStore,
  RunStub,
  SyncKey,
  SyncProgress,
} from '../contracts/sync';
import type { Backend } from '../store';
import { notImplemented } from './stub';

/**
 * A backend with change tracking: `createTrackedBackend()` from WP-S1's `core/store/tracking.ts`
 * returns this shape (`TrackedBackend`). Declared structurally here because core/sync may not
 * import a file of another module; WP-S1's type is assignable to it.
 */
export interface SyncBackend extends Backend {
  /** The untracked backend: writes through it leave no dirty mark. */
  readonly raw: Backend;
  onDirty(fn: (keys: SyncKey[]) => void): () => void;
}

export interface SyncEngineDeps {
  backend: SyncBackend;
  remote: RemoteStore;
  now: () => number;
  appVersion: string;
  coreVersion: string;
  gameId: string;
  deviceName: () => string;
  describeRun(meta: RunMeta): Promise<RunStub['verdict'] | undefined>;
  /** `DRY_RUN_TAG` definitions never reach the remote. */
  isDryRun(def: DefinitionRecord): boolean;
  /** No argument: any run active in this tab. */
  isRunActive(runId?: string): boolean;
  onProgress(p: SyncProgress): void;
  signal?: AbortSignal;
}

export interface SyncEngine {
  preview(): Promise<FirstSyncPreview>;
  begin(choice: 'merge' | 'replace'): Promise<CycleResult>;
  cycle(o?: { uploadRuns?: boolean; timeBudgetMs?: number }): Promise<CycleResult>;
  downloadRun(runId: string, o?: DownloadRunOptions): Promise<'ok' | 'missing' | 'corrupt'>;
  remoteRuns(): Promise<RunStub[]>;
  evict(runId: string): Promise<void>;
  eraseRemote(): Promise<void>;
  resetLocalSyncState(): Promise<void>;
}

export interface DownloadRunOptions {
  onProgress?: (doneBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
}

export function createSyncEngine(_d: SyncEngineDeps): SyncEngine {
  return notImplemented('S2b', 'createSyncEngine');
}
