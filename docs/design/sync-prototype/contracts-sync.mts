/**
 * PROTOTYPE of `src/core/contracts/sync.ts` (sync.md §4). WP-S0 copies this file, with the
 * relative imports pointed at `./experiment`, `./layout` and `./run`. Types and constants only.
 * Game-agnostic: nothing here knows about roulette.
 */
import type { DefinitionRecord, ExperimentGroup, StrategyRecord } from '../../../src/core/contracts/experiment';
import type { LayoutRecord } from '../../../src/core/contracts/layout';
import type { RunStatus } from '../../../src/core/contracts/run';

// ------------------------------------------------------------------ identity and ordering

/** Random per browser profile (an installed PWA shares it with the Chrome tab: same origin). */
export type DeviceId = string; // /^[0-9a-hjkmnp-tv-z]{10}$/ (Crockford base32, 50 bits)

/**
 * Hybrid logical clock, encoded so that string order is causal order:
 * `<wall ms, base36, 9 chars>.<counter, base36, 4 chars>.<deviceId>`, e.g.
 * `0mh3k2z1c.0000.7k2m9qxd4a`. Ties are impossible (the device id is part of it).
 */
export type Hlc = string;
export const HLC_PATTERN = /^[0-9a-z]{9}\.[0-9a-z]{4}\.[0-9a-hjkmnp-tv-z]{10}$/;

/** What a sync entry holds. `run` entries carry a stub; the bundle is a separate file. */
export type SyncKind = 'def' | 'strategy' | 'layout' | 'group' | 'setting' | 'run';
export const SYNC_KINDS: readonly SyncKind[] = ['def', 'strategy', 'layout', 'group', 'setting', 'run'];

/** `<kind>:<id>`, e.g. `def:f8126470…`, `layout:corners-and-red`, `setting:framing`. */
export type SyncKey = `${SyncKind}:${string}`;

/** Settings that follow the account. Every other setting key stays on its device. */
export const SYNCED_SETTING_KEYS = ['framing', 'pace'] as const;

// ------------------------------------------------------------------ values

/** JSON-safe run summary: what lists need without the results (no typed arrays). */
export interface RunStub {
  runId: string;
  definitionId: string;
  /** The definition's name, for lists that have not got the definition yet. */
  name: string;
  status: RunStatus;
  sessions: number;
  completedSessions: number;
  prefixSessions: number;
  createdAt: string;
  finishedAt?: string;
  appVersion: string;
  gameId: string;
  gameVersion: string;
  coreVersion: string;
  /** Present when `bundle` is. */
  resultsDigest?: string;
  /** The Home verdict numbers, so a run that is not downloaded still shows its one-liner. */
  verdict?: {
    meanNet: number;
    halfWidth: number | null;
    pAhead: number;
    pBust: number;
    n: number;
    roundsPerSession: number;
    roundsPerHour: number;
  };
  /** Device that made (and alone rewrites) this run. */
  owner: DeviceId;
  /** `RunMeta` fields a bundle does not carry, restored after download. */
  extra: {
    device: { cores: number; workers: number; ua: string };
    timing: { startedAt?: string; finishedAt?: string; elapsedMs: number };
    resumes: { at: string; completedSessions: number }[];
    imported?: { appVersion: string; importedAt: string; fileSha256: string; trimmed: boolean; partial: boolean };
  };
  /** The results file on the remote; absent while the run is not done (or cancelled, see §6.5). */
  bundle?: RunBundleRef;
}

export interface RunBundleRef {
  /** `run.<runId>.<resultsDigest first 16>.spinner.json.gz` */
  name: string;
  bytes: number;
  /** sha256 hex of the gzip bytes as uploaded (checked before decoding). */
  sha256: string;
  /** Prefix-only bundle of a cancelled run (`partial.of` in the bundle). */
  partial?: true;
}

/** The value an entry carries, by kind. `null` for a tombstone. */
export interface SyncValueByKind {
  def: DefinitionRecord;
  strategy: StrategyRecord;
  layout: LayoutRecord;
  group: ExperimentGroup;
  setting: { key: string; value: unknown };
  run: RunStub;
}

/** One record's replicated state (a last-writer-wins register with a tombstone). */
export interface SyncEntry<K extends SyncKind = SyncKind> {
  key: SyncKey;
  kind: K;
  /** Store id (definition id, slug, run id, setting key). */
  id: string;
  hlc: Hlc;
  /** sha256 hex of canonicalJson(value); `''` for a tombstone. */
  hash: string;
  /** Tombstone. */
  deleted?: true;
  /** Record schema of the value (`v` of the record); readers keep entries newer than they know. */
  v: number;
  value: SyncValueByKind[K] | null;
}

// ------------------------------------------------------------------ remote files

export const SYNC_FORMAT = 'spinner-sync' as const;
export const SYNC_LAYOUT_VERSION = 1 as const;

/** `spinner-sync.json`: written once; a reader refuses a newer `version`. */
export interface SyncRootV1 {
  format: typeof SYNC_FORMAT;
  version: typeof SYNC_LAYOUT_VERSION;
  createdAt: string;
  createdBy: DeviceId;
  /** Set by "Remove my data from Drive"; other devices stop syncing (sync.md §7.10). */
  erased?: { at: string; by: DeviceId };
}

/** `lib.<deviceId>.json.gz`: the device's whole merged view. Only that device writes it. */
export interface LibFileV1 {
  format: 'spinner-sync-lib';
  version: 1;
  device: { id: DeviceId; name: string; appVersion: string; coreVersion: string };
  /** Highest HLC in `entries` (also the writer's clock when it wrote). */
  hlc: Hlc;
  writtenAt: string;
  /** Sorted by key. Tombstones included until GC (sync.md §6.8). */
  entries: SyncEntry[];
}

/** One file as listed by the remote. */
export interface RemoteFile {
  id: string;
  name: string;
  bytes: number;
  /** Changes on every content change (Drive `version`). */
  version: string;
  /** Drive `md5Checksum` of the content. */
  md5?: string;
  modifiedTime: string;
  appProperties: Record<string, string>;
}

export type RemoteErrorCode =
  | 'auth' // 401: token missing or expired -> needs-auth
  | 'forbidden' // 403 other than rate limits (scope revoked, API disabled)
  | 'rate' // 403 userRateLimitExceeded / rateLimitExceeded, 429 -> backoff
  | 'quota' // 403 storageQuotaExceeded -> paused until the user frees Drive space
  | 'not-found' // 404
  | 'server' // 5xx -> backoff
  | 'network' // fetch rejected, offline
  | 'bad-response'; // unparseable or unexpected

export class RemoteError extends Error {
  readonly code: RemoteErrorCode;
  readonly status: number;
  readonly retryAfterMs: number | undefined;
  constructor(code: RemoteErrorCode, status: number, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'RemoteError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface TransferProgress {
  (doneBytes: number, totalBytes: number): void;
}

/**
 * The remote, as the engine sees it: a flat folder of named blobs. Drive's appDataFolder in the app;
 * an in-memory map in tests. Every method rejects with `RemoteError` only.
 */
export interface RemoteStore {
  readonly kind: 'drive' | 'memory';
  /** Every file in the folder (all pages). */
  list(): Promise<RemoteFile[]>;
  download(fileId: string, opts?: { onProgress?: TransferProgress; signal?: AbortSignal }): Promise<Uint8Array>;
  /**
   * Create a file. Uploads above `RESUMABLE_THRESHOLD` use a resumable session; `resumeKey` lets a
   * reloaded page continue an unfinished session (the store persists its URI under that key).
   */
  create(
    name: string,
    bytes: Uint8Array,
    opts?: {
      appProperties?: Record<string, string>;
      contentType?: string;
      resumeKey?: string;
      onProgress?: TransferProgress;
      signal?: AbortSignal;
    },
  ): Promise<RemoteFile>;
  /** Replace a file's content (same id). Atomic: readers see the old or the new content. */
  update(fileId: string, bytes: Uint8Array, opts?: { signal?: AbortSignal }): Promise<RemoteFile>;
  delete(fileId: string): Promise<void>;
  /** Account and storage, for the Account card. */
  about(): Promise<RemoteAbout>;
}

export interface RemoteAbout {
  email: string;
  displayName: string;
  /** Stable account id (Drive `permissionId`): binds this device's sync state to one account. */
  accountId: string;
  /** Drive storage, bytes; `limit` null for unlimited. */
  usage: number;
  limit: number | null;
}

/** Bytes; Drive recommends resumable uploads above 5 MB. */
export const RESUMABLE_THRESHOLD = 5 * 1024 * 1024;
/** Resumable chunk; must be a multiple of 256 KiB. */
export const RESUMABLE_CHUNK = 8 * 1024 * 1024;

// ------------------------------------------------------------------ auth

export type AuthState =
  | { state: 'unconfigured' } // the build has no client id
  | { state: 'signed-out' }
  | { state: 'signed-in'; email: string; expiresAt: number }
  | { state: 'expired'; email: string }; // a tap on Reconnect fixes it (user gesture)

/** Access tokens only; there is no refresh token in a browser-only app (sync.md §5). */
export interface TokenSource {
  /** A valid token, or null. Never prompts and never opens a window. */
  current(): string | null;
  /**
   * Interactive: must run inside a user gesture (click handler), or the popup is blocked. With
   * `silent`, uses `prompt: ''` and the stored hint: no account chooser, no consent screen once
   * consent was given; the popup still flashes open and closed.
   */
  acquire(opts: { silent: boolean }): Promise<string>;
  /** Revoke at Google and forget everything local. */
  revoke(): Promise<void>;
  subscribe(fn: (s: AuthState) => void): () => void;
  readonly state: AuthState;
}

// ------------------------------------------------------------------ engine status

export type SyncPhase = 'list' | 'pull' | 'apply' | 'upload-runs' | 'push' | 'download-runs' | 'gc';

export type SyncState =
  | 'off' // never signed in on this device
  | 'idle' // up to date
  | 'syncing'
  | 'needs-auth'
  | 'offline'
  | 'backoff' // a retryable error; next attempt at `retryAt`
  | 'drive-full'
  | 'error' // not retryable without the user (e.g. newer remote layout, account mismatch)
  | 'local-full'; // IndexedDB quota while applying

export interface SyncStatus {
  state: SyncState;
  email?: string;
  lastSyncedAt?: string;
  /** Local changes not yet pushed. */
  pending: number;
  /** Runs on the remote that are not on this device, and their bytes. */
  remoteOnly: { runs: number; bytes: number };
  progress?: { phase: SyncPhase; done: number; total: number; bytes?: number };
  retryAt?: number;
  error?: { code: string; message: string };
  /** Unread conflict notices (sync.md §6.4). */
  conflicts: number;
}

/** One "kept both" or "kept the edit" event, listed in Settings -> Account. */
export interface ConflictNotice {
  id: string;
  at: string;
  key: SyncKey;
  kind: SyncKind;
  /** English, e.g. "“Big Martingale” was changed on two devices; this device's copy is now “Big Martingale (Laptop)”." */
  message: string;
  /** Id of the copy that was created, when one was. */
  copyId?: string;
  read: boolean;
}

/** Per-device sync preferences (stored in `syncMeta`, never synced). */
export interface SyncDevicePrefs {
  enabled: boolean;
  deviceName: string;
  /** `all`: download every run in the background. `onOpen`: fetch a run when it is opened. */
  runDownload: 'all' | 'onOpen';
}
