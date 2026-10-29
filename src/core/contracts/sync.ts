/**
 * Google Drive sync: the frozen contract (docs/design/sync.md §4.1). FROZEN once WP-S0 merges.
 * Types and constants only (plus `RemoteError`). Game-agnostic: nothing here knows about
 * roulette. Imports only `./experiment`, `./layout` and `./run`.
 */
import type { DefinitionRecord, ExperimentGroup, StrategyRecord } from './experiment';
import type { LayoutRecord } from './layout';
import type { RunStatus } from './run';

// ------------------------------------------------------------------ identity and ordering

/** Random per browser profile (an installed PWA shares it with the Chrome tab: same origin). */
export type DeviceId = string; // DEVICE_ID_PATTERN (Crockford base32, 50 bits)
export const DEVICE_ID_PATTERN = /^[0-9a-hjkmnp-tv-z]{10}$/;

/**
 * Hybrid logical clock, encoded so that string order is causal order:
 * `<wall ms, base36, 9 chars>.<counter, base36, 4 chars>.<deviceId>`, e.g.
 * `0mh3k2z1c.0000.7k2m9qxd4a`. Ties are impossible (the device id is part of it).
 */
export type Hlc = string;
export const HLC_PATTERN = /^[0-9a-z]{9}\.[0-9a-z]{4}\.[0-9a-hjkmnp-tv-z]{10}$/;

/** What a sync entry holds. `run` entries carry a stub; the bundle is a separate file. */
export type SyncKind = 'def' | 'strategy' | 'layout' | 'group' | 'setting' | 'run';
export const SYNC_KINDS: readonly SyncKind[] = [
  'def',
  'strategy',
  'layout',
  'group',
  'setting',
  'run',
];

/** `<kind>:<id>`, e.g. `def:f8126470…`, `layout:corners-and-red`, `setting:framing`. */
export type SyncKey = `${SyncKind}:${string}`;

/** Settings that follow the account. Every other setting key stays on its device. */
export const SYNCED_SETTING_KEYS = ['framing', 'pace'] as const;

// ------------------------------------------------------------------ values

/** JSON-safe run summary: what lists need without the results (no typed arrays). */
export interface RunStub {
  runId: string;
  definitionId: string;
  /** For Sweep and "already ran" matching without the run on this device. */
  simKey: string;
  runKey: string;
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
  /**
   * Device that made (and alone rewrites) this run. Absent for a run imported from a file or the
   * gallery: same runId + same digest is one shared entry any device may write (review B6).
   */
  owner?: DeviceId;
  /** `RunMeta` fields a bundle does not carry, restored after download. */
  extra: {
    device: { cores: number; workers: number; ua: string };
    timing: { startedAt?: string; finishedAt?: string; elapsedMs: number };
    resumes: { at: string; completedSessions: number }[];
    /** Copied verbatim, unknown keys included (e.g. `trimInfo`). */
    imported?: {
      appVersion: string;
      importedAt: string;
      fileSha256: string;
      trimmed: boolean;
      partial: boolean;
      [k: string]: unknown;
    };
  };
  /** `RunMeta.error` of an errored run (stub only). */
  error?: { code: string; message: string };
  interrupted?: boolean;
  /** The results file on the remote: done runs only (review B3). */
  bundle?: RunBundleRef;
}

export interface RunBundleRef {
  /** `run.<runId>.<resultsDigest first 16>.spinner.json.gz` */
  name: string;
  bytes: number;
  /** sha256 hex of the gzip bytes this entry's writer uploaded (checked before decoding). */
  sha256: string;
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
  /** Minted from the edit time (`syncDirty.at`), not the push time (review B5). */
  hlc: Hlc;
  /** HLC of the entry this one was edited from (its parent); null when created fresh. */
  basis: Hlc | null;
  /**
   * Per-key version vector: edits per device along this entry's history. The transitive form of
   * the parent pointers: A descends from B iff vv(A) >= vv(B) pointwise (sync.md §7.4). This
   * device's component is a fresh value of the persistent, never-reset `syncMeta.vvCounter` (N1).
   */
  vv: Record<DeviceId, number>;
  /** Fingerprint (sync.md §7.2): sha256 of canonicalJson(value minus volatile fields); `''` for a tombstone. */
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
  list(opts?: { signal?: AbortSignal }): Promise<RemoteFile[]>;
  download(
    fileId: string,
    opts?: { onProgress?: TransferProgress; signal?: AbortSignal },
  ): Promise<Uint8Array>;
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
  delete(fileId: string, opts?: { signal?: AbortSignal }): Promise<void>;
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
  | { state: 'expired'; email: string } // a tap on Reconnect fixes it (user gesture)
  | { state: 'redirecting' }; // top-level navigation to Google is under way (sync.md §5.4)

/** Access tokens only; there is no refresh token in a browser-only app (sync.md §5). */
export interface TokenSource {
  /** A valid token, or null. Never prompts and never opens a window. */
  current(): string | null;
  /**
   * Interactive: must run inside a user gesture (click handler), or the popup is blocked. With
   * `silent`, uses `prompt: ''` and the stored hint: no account chooser, no consent screen once
   * consent was given; the popup still flashes open and closed. `mode` picks the flow
   * (sync.md §5.1): `auto` chooses popup or redirect from the platform.
   */
  acquire(opts: { silent: boolean; mode?: 'auto' | 'popup' | 'redirect' }): Promise<string>;
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
  | 'local-full' // IndexedDB quota while applying
  | 'waiting-run'; // first sync waits for the active run to finish (sync.md §7.3)

/** Why the sync is in `error` (or why a cycle failed); the UI picks its copy from this. */
export type SyncErrorCode =
  | 'newer-layout'
  | 'access-removed'
  | 'account-mismatch'
  | 'erased'
  | 'network'
  | 'quota'
  | 'auth'
  | 'local-full' // IndexedDB quota on this device
  | 'unknown';

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
  error?: { code: SyncErrorCode; message: string };
  /** Why `off` although the user may want sync: this build has no persistent store. */
  disabledReason?: 'memory-backend';
  /** Name of a device whose clock is far from ours (HLC skew warning). */
  clockSkewDevice?: string;
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

// ------------------------------------------------------------------ engine results

/** Progress of the phase in flight (`SyncStatus.progress`, `SyncEngineDeps.onProgress`). */
export type SyncProgress = NonNullable<SyncStatus['progress']>;

/** What the first-sync sheet shows (sync.md §8.3). Counts only; no records. */
export interface FirstSyncPreview {
  /** The remote has no library (new account, or hidden app data deleted from Google's side). */
  remoteEmpty: boolean;
  remote: {
    /** Device that wrote the newest lib file, and when. */
    fromName?: string;
    syncedAt?: string;
    experiments: number;
    strategies: number;
    layouts: number;
    runs: number;
    runBytes: number;
  };
  local: {
    experiments: number;
    strategies: number;
    layouts: number;
    runs: number;
    runBytes: number;
  };
}

/** How one `cycle()` or `begin()` ended. */
export interface CycleResult {
  /**
   * `busy` is not produced by the engine: the app service (S5a) wraps `cycle` in the Web Lock
   * `spinner:sync` (ifAvailable) and synthesises `busy` when another tab holds it.
   */
  outcome: 'ok' | 'busy' | 'needs-auth' | 'waiting-run' | 'offline' | 'error' | 'off' | 'timeout';
  /** Requests made to the remote (a no-change cycle makes exactly 1). */
  requests: number;
  pushed: number;
  applied: number;
  copies: number;
  /** Kinds of local records this cycle changed (screens refresh from it). */
  changed: SyncKind[];
  /** Set when `outcome` is `error` (or another non-ok outcome that has a cause). */
  error?: { code: SyncErrorCode; message: string };
}

// ------------------------------------------------------------------ local sync records (S1)

/** `syncIndex` record: the fold winner per key plus what the next local edit descends from. */
export interface SyncIndexRecord {
  key: SyncKey;
  kind: SyncKind;
  /** The fold winner, published as-is (never re-stamped). */
  entry: SyncEntry;
  /** Join of every vv folded for this key: basis of the next local edit; local only. */
  seen: Record<DeviceId, number>;
  /** 1 when the record exists locally, 0 for an opaque (newer-schema) or tombstoned entry. */
  local: 0 | 1;
}

/** `syncDirty` record: one mark per edited key. */
export interface SyncDirtyRecord {
  key: SyncKey;
  /** Latest edit time (epoch ms); the HLC is minted from it. */
  last: number;
  /** Nonce: a commit drops the mark only if it is unchanged. */
  n: string;
}

/** The `syncMeta` keys (sync.md §4.2). */
export type SyncMetaKey =
  | 'device'
  | 'prefs'
  | 'account'
  | 'clock'
  | 'seen'
  | 'files'
  | 'uploads'
  | 'last'
  | 'conflicts'
  | 'gcAt'
  | 'libSha'
  | 'copies'
  | 'vvCounter'
  | 'bundles';

/** This device's account binding (sync.md §7.10). */
export interface SyncAccountRecord {
  accountId: string;
  email: string;
  boundAt: string;
}

/** A remote file this device knows by id (taken from `syncMeta`, not from a listing). */
export interface SyncFileRef {
  id: string;
  version?: string;
}

/** The value of each `syncMeta` key. */
export interface SyncMetaValues {
  /** Random per browser profile; a new id starts a new vv component. */
  device: { id: DeviceId; createdAt: string };
  prefs: SyncDevicePrefs;
  account: SyncAccountRecord;
  /** Last HLC this device minted or received. */
  clock: Hlc;
  /** Remote file id -> `version` fully applied. */
  seen: Record<string, string>;
  files: { root?: SyncFileRef; ownLib?: SyncFileRef };
  /** Resumable upload `resumeKey` -> session URI. */
  uploads: Record<string, string>;
  /** ISO time of the last successful cycle. */
  last: string;
  /** At most 50, newest last. */
  conflicts: ConflictNotice[];
  /** Epoch ms of the last GC. */
  gcAt: number;
  /** sha256 of the lib bytes last uploaded (skips a no-change upload). */
  libSha: string;
  /** Copy ids this device has made (live or tombstoned): never copy a copy twice. */
  copies: string[];
  /** Monotone, never reset by any reset path (N1). */
  vvCounter: number;
  /** Bundle refs of this device's done runs, written by the run upload (S2c), read by the engine. */
  bundles: Record<string, RunBundleRef>;
}

/** `syncMeta` record: a typed key/value row. */
export type SyncMetaRecord<K extends SyncMetaKey = SyncMetaKey> = {
  [P in K]: { k: P; v: SyncMetaValues[P] };
}[K];

// ------------------------------------------------------------------ UI-facing shapes

/** One device that has written a lib file (Settings -> Account, "Your devices"). */
export interface SyncDeviceInfo {
  id: DeviceId;
  name: string;
  lastSyncedAt: string;
  appVersion: string;
}

/** The Account card's storage line: the Drive account plus what this device holds. */
export interface SyncAbout extends RemoteAbout {
  /** Bytes of synced data on this device. */
  deviceBytes: number;
}
