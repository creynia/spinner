# Sync across devices with Google Drive (design spike)

Owner request (2026-10-28): *"I would also like to be able to share experiments and other data
across devices seamlessly by logging into my google account."*

Owner decisions (fixed inputs to this design):

- **Store:** the owner's own **Google Drive `appDataFolder`**. Sign in with Google in the browser.
  No backend, no Firebase.
- **Scope:** sync **everything**: definitions, strategies, layouts, groups, settings, run meta and
  full run results.

This doc is written for the Sonnet swarm. §13 has the work packages. §4 holds the contracts that
WP-S0 freezes. The prototype in `docs/design/sync-prototype/` (§15) runs the GIS token flow and the
Drive client against fakes. Run it with
`npx vitest run --root docs/design/sync-prototype`; it typechecks with
`npx tsc -p docs/design/sync-prototype`.

---

## 1. Decisions

| # | Topic | Decision | Main alternative (rejected because) |
|---|---|---|---|
| D1 | Auth | **Google Identity Services (GIS) token model** (`google.accounts.oauth2.initTokenClient`), scope **`drive.appdata` only**. A popup is the primary flow. A redirect fallback (`oauth-return.html`, OAuth implicit grant) is used when the popup cannot open (§5.4). | PKCE code flow: Google's *Web application* clients need the client secret at the token endpoint. A browser-only app would have to embed that secret, and it would keep a long-lived refresh token in browser storage. |
| D2 | Tokens | An **access token only** (about 1 h). There is **no refresh token** client-side. The token is kept in memory plus `sessionStorage` (this tab only). `localStorage` keeps only the email used as the login hint. When the token expires, the user gets a **one-tap Reconnect**, because a silent popup needs a user gesture. | Background refresh needs a backend or a hidden iframe. Third-party-cookie blocking breaks the iframe. |
| D3 | Account email | From Drive `about.get` (`user.emailAddress`, `permissionId`), which works with `drive.appdata`. No `openid email` scope is requested. | Add `openid email`: a second consent line for no gain. |
| D4 | GIS script | Loaded **lazily at runtime** from `https://accounts.google.com/gsi/client`, only when the Account card renders or on sign-in or reconnect. It is **not** an npm dependency and has no SRI. Google forbids self-hosting it and does not version it. This is a documented exception to the pinning rule, like a browser API. | Self-host or pin: not allowed or not possible. |
| D5 | Drive layout | **One "lib" file per device** (`lib.<deviceId>.json.gz`), holding that device's whole merged state. Only that device writes it. Each finished run is stored as **one immutable bundle file** (`run.<runId>.<digest16>.spinner.json.gz`), byte-for-byte the existing gzip run-bundle export. A root marker `spinner-sync.json` sits beside them (§6). | One file per record: thousands of requests on first sync, plus write races. A single shared manifest: Drive v3 has no compare-and-swap, so two devices would overwrite each other. |
| D6 | Merge model | A **state-based CRDT**: each record is a last-writer-wins register ordered by a **hybrid logical clock (HLC)**, with tombstones. Merging the lib files is commutative, associative and idempotent, so any read order converges. A **3-way check** against the last synced hash detects true concurrent edits (§7.4). | `updatedAt` LWW: device clock skew silently loses edits. |
| D7 | Change tracking | A **tracking `Backend` decorator** writes a `syncDirty` mark **in the same IndexedDB transaction** as every put or delete on a synced store. The sync engine writes through the **raw** backend, so applying remote data never re-marks it. | Instrument each call site: 15+ writers today (§3.3), and new ones would forget. |
| D8 | Schema | **DB v3** adds `syncIndex`, `syncDirty` and `syncMeta`. It follows the v2 discipline: `V2_STORE_NAMES` is frozen, and upgrade 3 creates only its own stores, each guarded by `contains`. The existing record shapes are unchanged. The only contract change is the additive `RunMeta.synced?`. | Add fields to existing records: touches frozen contracts and every writer. |
| D9 | Definitions | Content-addressed and immutable (`id = sha256(normalized)`), so they **never conflict on content**. The record metadata merges field by field: `runIds` is unioned (minus deleted runs), `displayName` (from the rename work) is LWW by HLC, `createdAt` takes the minimum, `updatedAt` the maximum. | n/a |
| D10 | Strategies, layouts | Both have **mutable content under a stable user slug id**: `saveStrategy` and `saveLayout` overwrite by id. A true concurrent edit, including the same new slug created on two devices with different content, becomes a **conflicted copy**: the remote keeps the id, and the local copy gets a new id and the name "… (this device's name)". A notice is shown. Stages hold frozen copies (`x-chips`), so re-keying a layout breaks nothing. | Plain LWW: silently loses a whole strategy. |
| D11 | Runs | **Only the device that made a run writes its entry.** Running and queued runs are not pushed. A paused or errored run is pushed as a **stub** (meta and progress, no results). A cancelled run is pushed as a stub plus a **prefix bundle**. A done run is pushed as a stub plus its **full bundle**. Done runs are immutable. Resuming another device's run is not in v1 (§14 Q3). | Sync run parts while running: heavy, racy, and needs shared Web Locks. |
| D12 | Run download | **Every run is uploaded** (owner: "everything"). Downloads follow a per-device setting: **`onOpen`** (the default on phones) or **`all`** (the default on desktops). A run that is not downloaded still appears in every list with its verdict line, because the stub carries it. Opening it downloads it with progress. | Pull everything everywhere: a phone would be forced to fetch gigabytes. |
| D13 | Settings | **Synced:** `framing`, `pace` (`SYNCED_SETTING_KEYS`). **Per device:** `theme`, everything else in `settings`, and all sync preferences (`syncMeta`). Worker count and perf are already per-device (not in the store). | Sync theme too: see Q1. |
| D14 | Integrity | A downloaded bundle is checked three times: the sha256 of the gzip bytes against the stub, the bundle `resultsDigest` recomputed by `decodeRunBundle`, and the digest against the stub. Each lib entry's `hash` is recomputed, and a definition id is recomputed from its content. A failed check writes nothing and shows a notice. All local writes are single transactions, so a partial download never touches IndexedDB. | n/a |
| D15 | Atomicity on Drive | A bundle is uploaded **before** the lib entry that references it. A Drive upload becomes visible only when it completes. A lib file update is a single media `PATCH`, so readers see the old or the new content. Bundle uploads are idempotent by name. GC removes orphans (§7.9). | n/a |
| D16 | Triggers | Sync runs on sign-in, on app start (when a token is valid), when the app becomes visible (if more than 60 s since the last sync), 5 s after the last local change (at most 30 s), every 5 min while visible, on the `online` event, and on **Sync now**. Retryable errors back off exponentially. One tab syncs at a time (Web Lock `spinner:sync`). | Background Sync / Periodic Sync: needs a token in the SW; unreliable on Android. |
| D17 | Delete on this device | Settings → "Delete all data" becomes **"Delete everything on this device"**. It writes through the raw backend and resets the sync state, so Drive keeps its copy. Removing Drive data is a separate, explicit action that leaves an **erase marker**, so other devices stop syncing instead of re-uploading. | A tracked delete-all: would erase every device. |
| D18 | Client ID | The client ID is public by design. Build-time `VITE_GOOGLE_CLIENT_ID` comes from a GitHub repository **variable**, with a committed fallback in `src/app/services/sync/config.ts`. With no ID, the Account card says "Sync is not set up in this build". | Secret: it isn't one. |
| D19 | CSP | Add a **meta CSP to production builds** (a build plugin). It allows Google only where needed (§5.5). The SW already ignores cross-origin requests; this stays and is tested. Drive calls use `cache: 'no-store'`. | No CSP: we now hold an access token in the page. |
| D20 | Code location | Pure engine in a new core module **`src/core/sync`** (allowed edges: `contracts`, `experiment`, `store`). Browser adapters (GIS, Drive fetch, redirect, service orchestration) live in **`src/app/services/sync/`**. | All in app: the engine would not be testable in node without the DOM. |

---

## 2. Architecture

```
                        ┌───────────────────────────── browser tab (one per device) ─────────────────────────────┐
                        │                                                                                         │
  screens (Define,      │  services/db.ts  getRepo()/getBackend() ──► TrackedBackend ──► IDB Backend (spinner v3)  │
  Library, Run, …) ─────┼──► writes ──────────────────────────────┐   │ adds syncDirty marks   │                    │
                        │                                         │   │ in the same tx         │  definitions …     │
                        │                                         ▼   ▼                        │  layouts           │
                        │                                  ┌──────────────┐  raw backend      │  syncIndex  (new)  │
                        │  services/sync/service.ts ───────► │ core/sync    │ ─────────────────►│  syncDirty  (new)  │
                        │   triggers, Web Lock, backoff,     │  engine      │  (no marks)       │  syncMeta   (new)  │
                        │   status store, run download       │  hlc, merge, │                   └────────────────────┘
                        │        │            ▲              │  libfile, gc │
                        │        │ token      │ status       └──────┬───────┘
                        │        ▼            │                     │ RemoteStore (interface)
                        │  services/sync/gis.ts               services/sync/drive.ts  (fetch, cache:no-store)
                        │   TokenSource (memory+session)            │
                        └────────┼──────────────────────────────────┼────────────────────────────────────────────┘
                                 │ popup / redirect                 │ HTTPS, Bearer token (SW does not intercept)
                                 ▼                                  ▼
                     accounts.google.com (GIS)        www.googleapis.com/drive/v3 … appDataFolder
                                                       ├─ spinner-sync.json            root marker / erase marker
                                                       ├─ lib.<deviceA>.json.gz        A's merged state (A writes)
                                                       ├─ lib.<deviceB>.json.gz        B's merged state (B writes)
                                                       └─ run.<runId>.<digest16>.spinner.json.gz   immutable bundles
```

Tests swap the bottom row for fakes: `MemoryRemoteStore` in node, a fake Drive HTTP handler behind
Playwright `page.route` in e2e, and a stub GIS script.

---

## 3. What exists today (findings)

### 3.1 Stores, ids, timestamps and hashes

| Store | Key | `updatedAt` | Hash | Id unique across devices? | Mutable under the same id? |
|---|---|---|---|---|---|
| `definitions` | `id` = sha256(normalized) | yes | the id *is* the hash | **yes** (content-addressed) | metadata only: `runIds`, `updatedAt`, the new `displayName` (rename work) |
| `strategies` | `id` = the strategy's own slug (`s.id`) | yes | `hash` (sha256 canonical) | **no**: two devices can save `my-mart` with different content | **yes**: `saveStrategy` overwrites |
| `layouts` | `id` = slug from the name (`allocLayoutId`) | yes | `hash` = `layoutHash` (ignores id, name, notes) | **no**: two devices can allocate the same slug | **yes**: `saveLayout`, rename |
| `groups` | `newRunId(base)` (40 random bits) | yes | none | yes | yes: `runIds`, name |
| `runs` (+ `runParts`, `summaries`, `checkpoints`, `breakdowns`, `samples`) | `runId` = def16 + 40 random bits | no (`createdAt`, `timing`) | `resultsDigest` when done | yes (collision about 2⁻⁴⁰) | while running, paused or cancelled; **immutable once done** |
| `settings` | `key` | no | none | n/a | yes |

There is **no store-level version or HLC** today, and deletes leave no trace. Adding per-record
fields would change frozen contracts and every writer. So v3 keeps all sync bookkeeping in new
side stores (§4.2), and the existing records stay untouched.

### 3.2 Platform facts

- **No CSP** today (`index.html` has none; GitHub Pages cannot send headers, so a CSP must be a
  `<meta>` tag).
- **The SW ignores cross-origin requests** (`if (url.origin !== own) return;` in `src/pwa/sw.ts`),
  so Drive and Google requests are never cached. Keep it so; §11 adds a test.
- Hash routing; `base: './'`; served at `https://creynia.github.io/spinner/`; e2e uses
  `vite preview --base /spinner/ --port 4173`.
- Measured bundle sizes (`bundle-size.test.ts`, 10,000 × 500, 128 checkpoints): **1.1–2.1 MB**
  untrimmed gzip. With the maximum `auto` checkpoint budget, or 100k sessions, expect 5–20 MB. So
  resumable uploads are needed.

### 3.3 Every writer goes through `getBackend()`

These writers all reach IndexedDB through `services/db.ts → getBackend()` or `getRepo()`:

- `Define/data.ts` (definitions, strategies, deletes);
- `services/layouts.ts`;
- `services/runs.ts` (sink, `putDefinition`);
- `Sweep/sweep.ts` (definitions, groups);
- `Import/*` (`importRun`, `putDefinition`);
- `Library/*` (deletes);
- `Settings/benchmark.ts`;
- `settings.ts` (`setSetting`);
- `db.ts` (`importDefinitions`, `deleteAll`).

**Wrapping the backend once in `getRepo()` therefore tracks all of them.** The exception is
`deleteAll`, which must switch to the raw backend (D17).

---

## 4. Contracts (WP-S0 freezes these)

### 4.1 `src/core/contracts/sync.ts` (new)

The full text is `docs/design/sync-prototype/contracts-sync.mts`; WP-S0 copies it and fixes the
imports. The key types:

```ts
export type DeviceId = string;               // 10 chars Crockford base32
export type Hlc = string;                    // `<ms base36 ×9>.<counter base36 ×4>.<deviceId>`, string order = causal order
export type SyncKind = 'def' | 'strategy' | 'layout' | 'group' | 'setting' | 'run';
export type SyncKey = `${SyncKind}:${string}`;
export const SYNCED_SETTING_KEYS = ['framing', 'pace'] as const;

export interface SyncEntry<K extends SyncKind = SyncKind> {
  key: SyncKey; kind: K; id: string;
  hlc: Hlc;
  hash: string;            // sha256(canonicalJson(value)); '' for a tombstone
  deleted?: true;
  v: number;               // record schema; readers keep (never drop) entries newer than they know
  value: SyncValueByKind[K] | null;
}
// SyncValueByKind: def → DefinitionRecord, strategy → StrategyRecord, layout → LayoutRecord,
//                  group → ExperimentGroup, setting → { key, value }, run → RunStub

export interface RunStub {
  runId; definitionId; name; status; sessions; completedSessions; prefixSessions;
  createdAt; finishedAt?; appVersion; gameId; gameVersion; coreVersion; resultsDigest?;
  verdict?: { meanNet; halfWidth; pAhead; pBust; n; roundsPerSession; roundsPerHour };
  owner: DeviceId;                               // the only device that writes this entry
  extra: { device; timing; resumes; imported? }; // RunMeta fields a bundle lacks
  bundle?: { name: string; bytes: number; sha256: string; partial?: true };
}

export interface LibFileV1 {
  format: 'spinner-sync-lib'; version: 1;
  device: { id: DeviceId; name: string; appVersion: string; coreVersion: string };
  hlc: Hlc; writtenAt: string;
  entries: SyncEntry[];                          // sorted by key, tombstones included
}
export interface SyncRootV1 { format: 'spinner-sync'; version: 1; createdAt: string; createdBy: DeviceId;
                              erased?: { at: string; by: DeviceId } }   // §7.10

export interface RemoteFile { id; name; bytes; version; md5?; modifiedTime; appProperties: Record<string,string> }
export class RemoteError extends Error { code: 'auth'|'forbidden'|'rate'|'quota'|'not-found'|'server'|'network'|'bad-response'; status; retryAfterMs? }

export interface RemoteStore {
  readonly kind: 'drive' | 'memory';
  list(): Promise<RemoteFile[]>;
  download(fileId, opts?: { onProgress?, signal? }): Promise<Uint8Array>;
  create(name, bytes, opts?: { appProperties?, contentType?, resumeKey?, onProgress?, signal? }): Promise<RemoteFile>;
  update(fileId, bytes, opts?: { signal? }): Promise<RemoteFile>;     // atomic content swap
  delete(fileId): Promise<void>;                                     // 404 is success
  about(): Promise<{ email; displayName; accountId; usage; limit: number | null }>;
}
export const RESUMABLE_THRESHOLD = 5 * 1024 * 1024;
export const RESUMABLE_CHUNK = 8 * 1024 * 1024;   // multiple of 256 KiB

export type AuthState = { state: 'unconfigured' } | { state: 'signed-out' }
  | { state: 'signed-in'; email; expiresAt } | { state: 'expired'; email };
export interface TokenSource {
  current(): string | null;                       // never prompts
  acquire(o: { silent: boolean }): Promise<string>; // MUST be called inside a user gesture
  revoke(): Promise<void>;
  subscribe(fn): () => void; readonly state: AuthState;
}

export type SyncState = 'off' | 'idle' | 'syncing' | 'needs-auth' | 'offline' | 'backoff'
  | 'drive-full' | 'error' | 'local-full';
export interface SyncStatus { state; email?; lastSyncedAt?; pending: number;
  remoteOnly: { runs: number; bytes: number };
  progress?: { phase: SyncPhase; done; total; bytes? }; retryAt?; error?: { code; message }; conflicts: number }
export interface ConflictNotice { id; at; key; kind; message; copyId?; read: boolean }
export interface SyncDevicePrefs { enabled: boolean; deviceName: string; runDownload: 'all' | 'onOpen' }
```

`src/core/contracts/run.ts` gets one additive change: `RunMeta.synced?: { from: DeviceId; fromName: string; at: string }`.
It is set on runs downloaded from Drive, and Analyze → Overview shows "from Laptop". There is
**no `CORE_VERSION` bump**: simulation output does not change (same rule as layouts D12).

### 4.2 Store v3 (`src/core/store/backend.ts`)

```ts
export const V2_STORE_NAMES = [...V1_STORE_NAMES, 'layouts'] as const;           // FROZEN
export const STORE_NAMES = [...V2_STORE_NAMES, 'syncIndex', 'syncDirty', 'syncMeta'] as const;
export const DB_VERSION = 3;
STORE_DEFS.syncIndex = { keyPath: 'key', indexes: { byKind: 'kind' } };
STORE_DEFS.syncDirty = { keyPath: 'key', indexes: {} };
STORE_DEFS.syncMeta  = { keyPath: 'k',   indexes: {} };
DB_UPGRADES[3] = (db) => createStores(db, ['syncIndex', 'syncDirty', 'syncMeta']);
/** Kinds of store whose writes are tracked; sync stores never are. */
export const SYNCED_STORES: Partial<Record<StoreName, SyncKind>> = {
  definitions: 'def', strategies: 'strategy', layouts: 'layout', groups: 'group', settings: 'setting',
  runs: 'run', runParts: 'run', summaries: 'run', checkpoints: 'run', breakdowns: 'run', samples: 'run',
};
```

The record shapes of the new stores:

```ts
/** syncIndex: the last state agreed with the remote, per key (the base of the 3-way check). */
interface SyncIndexRecord {
  key: SyncKey; kind: SyncKind;
  entry: SyncEntry;              // incl. value: building our lib file needs no other store
  /** 1 = the record is in the local stores (runs: results downloaded); 0 = remote-only/opaque. */
  local: 0 | 1;
}
/** syncDirty: "something under this key changed locally since the last push". */
interface SyncDirtyRecord { key: SyncKey; at: number; n: string /* random nonce */ }
/** syncMeta: k/v. Keys: 'device' {id,name} · 'prefs' SyncDevicePrefs · 'account' {accountId,email,boundAt}
 *  · 'clock' {hlc} · 'seen' {[fileId]: version} · 'files' {root?, ownLib?} · 'uploads' {[resumeKey]: uri}
 *  · 'last' {at, ok, error?} · 'conflicts' ConflictNotice[] (cap 50) · 'gcAt' string · 'libSha' string */
interface SyncMetaRecord { k: string; v: unknown }
```

A new `Backend` method: an atomic read-modify-write. The engine needs it to check "is this key
dirty?" and apply in one transaction. WP-S0 adds the signature and the memory implementation;
WP-S1 adds the IDB implementation.

```ts
export interface TxReader { get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> }
export interface Backend {
  // …existing…
  /**
   * One readwrite transaction in which `fn` may await `r.get` (requests on the same transaction
   * only: awaiting anything else lets IndexedDB auto-commit) and queue writes on `w`.
   * All or nothing; a thrown error aborts.
   */
  update(stores: StoreName[], fn: (r: TxReader, w: TxOps) => Promise<void>): Promise<void>;
}
```

### 4.3 Change tracking (`src/core/store/tracking.ts`, new)

```ts
export interface TrackedBackend extends Backend {
  readonly raw: Backend;
  /** Fires after a committed transaction that marked at least one key. */
  onDirty(fn: (keys: SyncKey[]) => void): () => void;
}
/**
 * Wraps `inner`. For readwrite `tx`/`update` touching any SYNCED_STORES, adds 'syncDirty' to the
 * transaction and, for each put/delete, queues `put('syncDirty', { key, at: Date.now(), n })`:
 *   runParts [runId, n] / summaries / … → `run:<runId>`; settings → only SYNCED_SETTING_KEYS.
 * Reads pass through. An aborted transaction leaves no mark (same transaction).
 */
export function createTrackedBackend(inner: Backend): TrackedBackend;
/** Deletes a run's results and meta but leaves `definitions.runIds` (free space, keep on Drive). */
export function evictRunResults(raw: Backend, runId: string): Promise<void>;
```

The sink flushes `runs` and `runParts` every 2 s while a run is going. Each flush re-puts the
same `run:<id>` mark, which costs one extra small put per flush. The engine skips running runs
(§7.6).

### 4.4 `src/core/sync` (new core module)

The public entry is `src/core/sync/index.ts`. WP-S0 writes stubs with these frozen signatures:

```ts
// hlc.ts
export function createClock(device: DeviceId, now: () => number, last?: Hlc): {
  tick(): Hlc; recv(remote: Hlc): void; readonly last: Hlc };
export function hlcWall(h: Hlc): number;
// entries.ts
export function entryOf<K extends SyncKind>(kind: K, id: string, value: SyncValueByKind[K] | null, hlc: Hlc): Promise<SyncEntry<K>>;
export function verifyEntry(e: SyncEntry): Promise<'ok' | 'bad-hash' | 'bad-id' | 'unknown-kind' | 'newer'>;
export const SUPPORTED_V: Record<SyncKind, number>;   // def 1, strategy 1, layout 1, group 1, setting 1, run 1
// libfile.ts
export function encodeLib(f: LibFileV1): Promise<Uint8Array>;           // canonical JSON → gzip
export function decodeLib(b: Uint8Array): Promise<LibFileV1>;           // throws SyncFileError
export const LIB_NAME = (d: DeviceId) => `lib.${d}.json.gz`;
export const ROOT_NAME = 'spinner-sync.json';
export const runBundleName = (runId: string, digest: string) => `run.${runId}.${digest.slice(0, 16)}.spinner.json.gz`;
// merge.ts
export function mergeEntries(a: SyncEntry | undefined, b: SyncEntry): SyncEntry;  // max HLC; commutative
export function mergeDefRecord(local: DefinitionRecord, remote: DefinitionRecord, deletedRuns: ReadonlySet<string>): DefinitionRecord;
export function mergeGroup(local: ExperimentGroup, remote: ExperimentGroup, deletedRuns: ReadonlySet<string>, localNewer: boolean): ExperimentGroup;
export type Resolution =
  | { do: 'apply' } | { do: 'keep-local' } | { do: 'merge' }
  | { do: 'copy-local'; notice: string } | { do: 'restore-remote'; notice: string } | { do: 'skip'; reason: string };
export function resolve(kind: SyncKind, base: SyncEntry | undefined, local: SyncEntry | undefined,
                        localDirty: boolean, remote: SyncEntry, self: DeviceId): Resolution;
// engine.ts
export interface SyncEngineDeps {
  backend: TrackedBackend; remote: RemoteStore; now: () => number;
  appVersion: string; coreVersion: string; gameId: string;
  /** App-supplied: the definition name and verdict for a stub (app has runMetrics/verdict). */
  describeRun(meta: RunMeta): Promise<Pick<RunStub, 'name' | 'verdict'>>;
  /** Runs currently executing in this tab are never deleted or replaced by a pull. */
  isRunActive(runId: string): boolean;
  onProgress(p: NonNullable<SyncStatus['progress']>): void;
  signal?: AbortSignal;
}
export interface FirstSyncPreview { remoteEmpty: boolean; devices: { id; name; writtenAt }[];
  remote: { defs; strategies; layouts; runs; runBytes }; local: { defs; strategies; layouts; runs; runBytes } }
export interface SyncEngine {
  preview(): Promise<FirstSyncPreview>;                       // list + pull, no writes
  cycle(o?: { uploadRuns?: boolean; timeBudgetMs?: number }): Promise<CycleResult>;
  begin(choice: 'merge' | 'replace'): Promise<CycleResult>;   // first sync on this device/account
  downloadRun(runId: string, o?: { onProgress?: TransferProgress; signal?: AbortSignal }): Promise<'ok' | 'missing' | 'corrupt'>;
  remoteRuns(): Promise<RunStub[]>;                           // syncIndex kind 'run', local 0, not deleted
  evict(runId: string): Promise<void>;                        // free up space; keeps it on Drive
  eraseRemote(): Promise<void>;                               // §7.10
  resetLocalSyncState(): Promise<void>;                       // keeps prefs + device
}
export interface CycleResult { pulled: number; pushed: number; uploadedRuns: number; conflicts: ConflictNotice[];
  remoteOnly: { runs: number; bytes: number }; pending: number; more: boolean /* time budget hit */ }
export function createSyncEngine(d: SyncEngineDeps): SyncEngine;
// memory-remote.ts — test double, also exported for app/e2e unit tests
export function createMemoryRemote(o?: { fault?: (op: string, name?: string) => RemoteError | undefined }): RemoteStore & { files: Map<string, …> };
```

### 4.5 App service (`src/app/services/sync/index.ts`)

WP-S0 writes this as an inert stub so the UI can build in parallel:

```ts
export const syncStatus: Store<SyncStatus>;              // state 'off' in the stub
export const syncAuth: Store<AuthState>;
export const conflictNotices: Store<ConflictNotice[]>;
export const syncPrefs: Store<SyncDevicePrefs>;
export function signIn(): Promise<void>;                 // click handler only
export function reconnect(): Promise<void>;              // click handler only (silent popup)
export function syncNow(): Promise<void>;
export function chooseFirstSync(c: 'merge' | 'replace' | 'cancel'): Promise<void>;
export const firstSyncPrompt: Store<FirstSyncPreview | null>;
export function signOut(): Promise<void>;                // revoke + stop; local data kept
export function removeDriveData(): Promise<void>;        // §7.10
export function setPrefs(p: Partial<SyncDevicePrefs>): Promise<void>;
export function remoteRun(runId: string): Promise<RunStub | null>;
export function downloadRun(runId: string, onProgress?: TransferProgress, signal?: AbortSignal): Promise<'ok' | 'missing' | 'corrupt' | 'offline' | 'needs-auth'>;
export function evictRun(runId: string): Promise<void>;
export function markConflictsRead(): void;
// config.ts
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID || COMMITTED_CLIENT_ID; // '' = unconfigured
```

---

## 5. Auth

### 5.1 Flow (GIS token model)

```
Account card renders ── loadGis() preloads https://accounts.google.com/gsi/client (async, no await)
User taps "Sign in with Google" (user gesture)
  └─ tokenClient.requestAccessToken({ prompt: 'select_account', login_hint? })
       popup: account chooser → consent "See, create and delete its own configuration data in your Google Drive"
  ◄─ callback { access_token, expires_in: 3599, scope }
  check hasGrantedAllScopes(resp, drive.appdata)   (the user can untick it → AuthError 'scope')
  about.get → { email, permissionId }               (D3)
  store { token, expiresAt, email } in memory + sessionStorage['spinner:sync:token'];
        { email } in localStorage['spinner:sync:hint']
  account binding (§7.10) → first-sync preview (§8.3) → engine.begin(choice)
```

- **The popup must open inside the click's user activation.** `acquire()` must not await
  anything slow before `requestAccessToken`. The script is preloaded when the card renders, so
  `load()` resolves at once. If the script is not loaded yet, the first tap loads it and the button
  says "Tap again to continue" (rare; tested).
- **Token lifetime: 3,599 s. No refresh token exists in this model**, so nothing long-lived is
  stored. `current()` treats a token as expired 2 minutes early.

### 5.2 Expiry and "silent" refresh

- `requestAccessToken({ prompt: '' , login_hint })` skips the chooser and consent once consent was
  given. It still **opens a popup that closes itself**, and it needs a **user gesture** (popup
  blockers). True background refresh is impossible without a backend.
- **UX:** when the token expires, the state becomes `needs-auth`. The shell indicator turns amber
  and reads "Reconnect", and the Account card shows a **Reconnect** button. One tap runs
  `acquire({ silent: true })`: a brief popup flash, no questions. The next cycle starts
  immediately.
  - **Sync now**, opening a remote run and Download all also call `acquire({ silent: true })`
    first when the token is gone, because they are user gestures too.
- **Expiry mid-sync:** every engine step is idempotent. A 401 aborts the cycle at the current
  request; nothing local is committed for an unfinished step.
  - A resumable upload keeps its session URI in `syncMeta.uploads`. It continues after Reconnect
    with the new token; a session lasts about a week.
  - The state goes to `needs-auth`; the pending count stays. There are no data-loss paths: the
    lib file is written last.
- **Proactive:** when a cycle with run uploads starts and the token has less than 10 min left, the
  engine sets `uploadRuns: false` for that cycle. The library still syncs, and the indicator shows
  "Reconnect to finish uploading". A long upload is not cut by an expiry.
- **Multi-tab:** a tab without a token asks over `BroadcastChannel('spinner-sync')` and a tab that
  has one answers. The token is held in the receiver's memory only. Same origin, so this adds no
  new trust boundary.

### 5.3 Drive client

See `sync-prototype/drive.mts`; it is tested against `fake-drive.mts`:

- `list`: `GET /drive/v3/files?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(id,name,size,version,md5Checksum,modifiedTime,appProperties)`, following every page.
- `create` ≤ 5 MB: `POST /upload/drive/v3/files?uploadType=multipart` with metadata
  `{ name, parents: ['appDataFolder'], appProperties }`.
- `create` > 5 MB: **resumable**.
  - `POST …?uploadType=resumable` returns `Location`; persist it under `resumeKey`.
  - `PUT` 8 MiB chunks with `Content-Range`; a `308` answer carries `Range`.
  - To resume, `PUT` with `Content-Range: bytes */<total>`. A `404`/`410` means the session
    expired, so start over.
- `update`: `PATCH /upload/drive/v3/files/{id}?uploadType=media`, an atomic content swap.
- `download`: `GET /drive/v3/files/{id}?alt=media`, streamed for progress. Bundles are at most
  about 20 MB, so a failed download restarts from 0 (no Range resume in v1).
- `delete`: `DELETE /drive/v3/files/{id}`; a 404 counts as success.
- `about`: `GET /drive/v3/about?fields=user(emailAddress,displayName,permissionId),storageQuota(limit,usage)`.
- Every request sends `Authorization: Bearer`, `cache: 'no-store'`, and an `AbortSignal` where
  given.
- Error mapping (`errorOf`):
  - 401 → `auth`;
  - 429, and 403 `rateLimitExceeded`/`userRateLimitExceeded` → `rate`, honouring `Retry-After`;
  - 403 `storageQuotaExceeded` → `quota`;
  - other 403 → `forbidden`;
  - 404 → `not-found`;
  - 5xx → `server`;
  - a rejected fetch → `network`.

### 5.4 Android installed PWA and the redirect fallback

- **Expected behaviour:** Chrome on Android opens a popup from a standalone PWA as a new window or
  Custom Tab, and GIS returns the token by `postMessage` to the opener. This is the **top manual
  test risk** (§11.4 step 2).
- **Fallback:** when the popup cannot complete, the Account card offers **"Sign in in this
  window"**. That happens when GIS calls `error_callback` with `popup_failed_to_open`, or with
  `popup_closed` twice in a row without a result. The redirect then works as follows:
  - Save `state` = 128 random bits and the return route in `sessionStorage`.
  - `location.assign('https://accounts.google.com/o/oauth2/v2/auth?client_id=…&redirect_uri=<origin><base>oauth-return.html&response_type=token&scope=https://www.googleapis.com/auth/drive.appdata&include_granted_scopes=true&state=…&login_hint=…&prompt=')`.
  - `public/oauth-return.html` loads `public/oauth-return.js` (a same-origin file, so no inline
    script under CSP). It parses `#access_token&expires_in&state&scope`, checks `state` against
    `sessionStorage` (CSRF), stores the token the same way §5.1 does, scrubs the fragment, and
    `location.replace('./#/settings?account=1')`.
  - A mismatch or an error shows a plain message with a link back.
- The fallback **is disabled while a run is active**: the button says "Finish or pause the run
  first". A navigation would pause the run, although Resume works.

### 5.5 Sign-out, revoke, storage, CSP, SW

- **Sign out:**
  - `google.accounts.oauth2.revoke(token)`; offline, the token dies within the hour anyway.
  - Clear the sessionStorage token and the localStorage hint.
  - `prefs.enabled = false`.
  - **Local data and `syncIndex` are kept**, so signing in again on this device is a cheap
    incremental sync.
  - The card states this.
- **Stored in the browser:**
  - **memory and sessionStorage:** the access token and its expiry;
  - **localStorage:** the email hint only;
  - **IndexedDB `syncMeta`:** device id and name, prefs, account id and email, clock, seen
    versions, resumable session URIs (useless without a token), conflict notices.
  - No secrets in the repo; the client id is public.
- **CSP** (production meta tag, injected by `build/vite-plugin-csp.ts`):

```
default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client;
connect-src 'self' https://www.googleapis.com https://accounts.google.com/gsi/ https://oauth2.googleapis.com;
frame-src https://accounts.google.com/gsi/; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style;
img-src 'self' data: blob:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'
```

  `'unsafe-inline'` for styles keeps Preact style attributes and the data-URI favicon working.
  `frame-ancestors` cannot be set by meta, and Pages cannot set it either. WP-S6 runs the **whole
  existing e2e suite** with the CSP and fails on any `securitypolicyviolation`. If a sibling
  feature needs more, the CSP is relaxed there, not dropped.
- **SW:** cross-origin requests already pass through (`return` before `respondWith`). Add a test
  that a `googleapis.com` fetch is never put in any cache. `oauth-return.html` is precached like
  every `dist` file (static, harmless).

---

## 6. Data model on Drive

```
appDataFolder/                         (hidden; counts toward the user's Drive quota; only this OAuth client sees it)
  spinner-sync.json                    SyncRootV1, plain JSON, ~150 B. Created by the first device. version > 1 → refuse (update app).
                                         `erased` set → other devices stop (§7.10).
  lib.<deviceId>.json.gz               LibFileV1 → canonical JSON → gzip. appProperties { kind: 'lib', device }.
                                         Whole merged state as seen by that device. Typical: 50–500 kB gz;
                                         1,000 definitions + 2,000 run stubs ≈ 6 MB raw ≈ 1 MB gz.
  run.<runId>.<digest16>.spinner.json.gz
                                       encodeRunBundle(data, { gzip: true }) — identical to Analyze → Export,
                                         so a user could even download it from Drive's API and import it.
                                         appProperties { kind: 'run', runId, digest16, sha32 } (each key+value ≤ 124 B,
                                         so: first 16 hex of resultsDigest, first 32 hex of sha256(gz bytes)).
                                         10k×500: 1–2 MB (measured), up to ~20 MB for 100k sessions → resumable.
```

- Small records are **inline in the lib file**, not one file each. A library sync is about 3
  requests (list, a changed peer lib or two, our lib), however large the library.
- Each device writes only its own lib file, so **there are no write conflicts on Drive**. Drive
  v3 has no reliable compare-and-swap; this layout does not need one.
- **Limits:**
  - Drive file size is not a concern (TB).
  - The binding limit is Drive's throttling of **rapid writes**. The engine paces writes with a
    token bucket of **3 writes per second, burst 5**.
  - Reads run at most 4 in parallel; uploads run 1 at a time.
  - The documented per-user query quota (thousands per minute) is far above this. Backoff for
    `rate` follows Google's guidance: `min(2ⁿ s + U(0,1) s, 64 s)`, at most 5 tries per request,
    then the cycle fails with `backoff`.

---

## 7. Sync algorithm

### 7.1 Clock

HLC per device, persisted in `syncMeta.clock` at the end of each cycle (and lazily on tick):

```
tick():   w = max(now(), last.w); c = (w == last.w) ? last.c + 1 : 0; last = (w, c); return enc(w, c, self)
recv(h):  w = max(now(), last.w, h.w); c = (w == last.w == h.w) ? max(last.c, h.c) + 1
                                          : (w == last.w) ? last.c + 1 : (w == h.w) ? h.c + 1 : 0
```

- If a remote wall time is more than 24 h ahead of `now()`, it is still accepted (convergence
  first), and the Account card shows "A device's clock looks wrong (Laptop)".

### 7.2 Building local entries

`snapshot(key)` reads the current local record and returns `entryOf(kind, id, value, clock.tick())`,
or `null` when there is nothing to push. Per kind:

| Kind | Value | Skip when |
|---|---|---|
| def | `DefinitionRecord` as stored | none |
| strategy, layout, group | record as stored | none |
| setting | `{ key, value }` | key ∉ `SYNCED_SETTING_KEYS` (the tracker already filters) |
| run | `RunStub` from `RunMeta` + `describeRun`, plus `bundle` (§7.6) | status `running`/`queued` (re-marked by the next flush); run not owned by this device and its digest matches the index; run origin from sync and unchanged |
| any | `null` (tombstone) when the record is gone | key never synced (no `syncIndex` row): just drop the mark |

If the new hash equals `syncIndex[key].entry.hash` and the deleted flag is the same, the mark is
cleared with no push. This keeps no-op writes, such as re-saving an identical layout, off Drive.

### 7.3 One cycle

```
cycle({ uploadRuns = true, timeBudgetMs = 120_000 }):
  lock 'spinner:sync' (ifAvailable) else return 'busy'
  token? else → needs-auth
  files ← remote.list()
  root ← files[ROOT_NAME] ;  if !root → create SyncRootV1     (first device ever)
         if root.version > 1 → error 'newer-layout' ; if root.erased && erased.at > account.boundAt → off + notice
  ── PULL ─────────────────────────────────────────────────────────────────
  libs ← files matching /^lib\.[0-9a-z]{10}\.json\.gz$/
  changed ← libs where seen[f.id] != f.version            (own file included: recovers after a local reset)
  remote ← Map<SyncKey, SyncEntry>
  for f in changed (≤4 parallel): L ← decodeLib(download(f.id))   (bad file → notice, skip, do not mark seen)
       for e in L.entries: if verifyEntry(e) is 'bad-hash'|'bad-id' → notice, skip
                           remote[e.key] = mergeEntries(remote[e.key], e)
  ── APPLY ────────────────────────────────────────────────────────────────
  deletedRuns ← run keys that are tombstones in remote ∪ syncIndex
  for e in remote.values() sorted (defs, strategies, layouts, groups, settings, runs):
       base ← syncIndex[e.key]
       if base && e.hlc <= base.entry.hlc: continue                    (already have it or newer)
       clock.recv(e.hlc)
       raw.update([store(e.kind), 'syncIndex', 'syncDirty', …], async (r, w) => {
          dirty ← r.get('syncDirty', e.key);  local ← r.get(store, e.id)
          switch resolve(kind, base?.entry, localEntry(local), !!dirty, e, self):   (table §7.5)
            apply:          write e.value (or delete) ; syncIndex = { entry: e, local: 1|0 }
            merge:          write merge(local, e.value) ; syncIndex = { entry: e, local: 1 } ; keep dirty if merged ≠ e.value
            keep-local:     syncIndex = { entry: e } (new base) ; keep dirty (local pushes with a newer HLC)
            copy-local:     write local under a new id (+ dirty mark for it) ; write e.value under e.id ; notice
            restore-remote: write e.value ; delete dirty ; notice
            skip:           syncIndex = { entry: e, local: 0 }   (newer schema / unknown kind: kept, passed on)
       })
  mark seen[f.id] = f.version for files fully applied
  ── PUSH ─────────────────────────────────────────────────────────────────
  if uploadRuns && !anyRunActive(): uploadPendingRuns(deadline)           (§7.6, bundles BEFORE lib)
  dirty ← syncDirty.getAll()
  for d in dirty: s ← snapshot(d.key) ; if s: pending[d.key] = s
  lib ← { entries: (syncIndex entries ⊕ pending), sorted by key, hlc: max }
  bytes ← encodeLib(lib) ; if sha256(bytes) == syncMeta.libSha && ownLib exists → skip upload
  ownLib ? remote.update(ownLib.id, bytes) : remote.create(LIB_NAME(self), bytes, { appProperties })
  raw.update(['syncIndex','syncDirty','syncMeta'], …):
       for each pushed key: syncIndex = { entry: pending[key], local: 1 } ;
                            delete syncDirty[key] only if its nonce n is unchanged (re-dirtied keys stay)
       syncMeta.libSha, seen[ownLib.id] = returned version, clock, last = { at: now, ok: true }
  ── DOWNLOAD (policy 'all') ──────────────────────────────────────────────
  if prefs.runDownload == 'all': for stub in remoteRuns() newest first, until deadline: downloadRun(stub.runId)
  ── GC (once per 24 h per device) ───────────────────────────────────────── §7.9
  emit status { idle, lastSyncedAt, pending, remoteOnly, conflicts }
```

**First sync** (`begin`) on this device or after an account change: `preview()` runs list and
pull without applying. Then:

- **merge:**
  1. Seed the outbox. Every record in every synced store gets a `syncDirty` mark, through the raw
     backend.
  2. Run `cycle()`. Keys that exist on both sides go through the normal resolution. With no base,
     identical hashes are a no-op, and different hashes follow the per-kind rule (definitions
     merge; strategies and layouts become conflicted copies).
- **replace:**
  1. Raw-delete every record in the synced stores. Prefs and the device id are kept.
  2. `resetLocalSyncState()`.
  3. Run `cycle()`. It only pulls, since nothing is dirty.

### 7.4 Conflict detection

A **true conflict** needs a dirty local key and a remote entry newer than the base, coming from
another device. The hash test then decides:

- `local.hash == remote.hash`: no conflict; the remote becomes the new base, and the mark is
  cleared.
- `base && local.hash == base.hash`: the local side did not really change (a no-op write), so
  apply the remote.
- `base && remote.hash == base.hash`: impossible when the remote is newer than the base; treat it
  as keep-local.
- Otherwise it is a conflict, handled per kind (§7.5). **No base and both present** is the
  slug-collision case (same new id created on two devices), and is a conflict too.

### 7.5 Rules per kind

| Kind | Remote newer, local clean | Both edited (true conflict) | Remote delete, local edited | Local delete (dirty), remote edited | Validation on apply |
|---|---|---|---|---|---|
| **def** | `merge` (always: `runIds` union minus deleted runs; `displayName` LWW by HLC; `createdAt` min; `updatedAt` max; `origin`/`derivedFrom` from the earlier `createdAt`) | `merge`: content is identical by construction, metadata merges. Never a notice | keep-local (re-push resurrects) | restore-remote + notice "kept: changed on Laptop" | `definitionId(rec.definition) === id`, else skip + notice |
| **strategy** | apply | **copy-local**: the local record gets id `allocCopyId(id, taken)` (`<id>-2`…, and `strategy.id` follows), name "… (Pixel)"; the remote takes `id`. Notice | keep-local + notice "kept your edit; deleted on Laptop" | restore-remote + notice | `hash === sha256(canonicalJson(strategy))`, `rec.id === strategy.id` |
| **layout** | apply | **copy-local** via `allocLayoutId(name + " (Pixel)", taken)`; `layout.id` follows; `hash` unchanged (it ignores id and name). Stages keep their `x-chips` copy, so nothing dangles; `from.id` may now point at the remote version, which is the same as today's "Update / Keep" model | keep-local + notice | restore-remote + notice | `hash === layoutHash(layout)`; built-in ids refused |
| **group** | `merge` (`runIds` union minus deleted runs; `name`, `sweep`, `variantDefinitionIds` by the newer HLC) | merge, no notice | keep-local | restore-remote | shape check |
| **setting** | apply (+ `settingsStore` refresh) | keep-local: the local edit is newer by intent and pushes with a newer HLC | n/a (settings are never deleted) | n/a | key ∈ `SYNCED_SETTING_KEYS`; value sanitized by `sanitizeSettings` |
| **run** | stub only: `syncIndex` `local: 0` (remote-only) and, with policy `all`, a download. If local exists and `owner ≠ self` and the digest differs (cancelled → done): replace on download | only the owner writes, so a conflict means a `runId` collision with a different digest: the local run is re-keyed (`newRunId`) through `importRun`'s rule, + notice | **delete locally**, unless `isRunActive(runId)`: then keep-local and re-push + notice "still running here" | the local tombstone wins (runs are not "edited" by others) | §7.6 download checks |

`skip` applies to every kind: when `e.v > SUPPORTED_V[kind]` or the kind is unknown, the entry is
stored opaquely (`local: 0`) and re-emitted unchanged in our lib file. It is **never dropped**, so
an older device does not erase data from a newer one. A single notice says "Some data is from a
newer spinner; update to see it".

### 7.6 Runs pipeline

| Local status | Pushed entry | Bundle |
|---|---|---|
| `queued`, `running` | none | none |
| `paused` (incl. interrupted), `error` | stub (progress, `completedSessions`) | none. Other devices list "Paused on Laptop · 43%", not openable |
| `cancelled` | stub | **prefix bundle** (`partial.of`), analyzable elsewhere; replaced if the run is continued |
| `done` | stub with `resultsDigest` | **full bundle** |

`uploadPendingRuns(deadline)` handles runs whose entry needs a bundle that the index lacks, or
whose bundle digest differs. It goes **newest first**, one at a time, only while no run is active
in this tab (`encodeRunBundle` is CPU-heavy on the main thread; moving it to a worker is a chip):

```
data   ← loadRun(raw, runId) ; bytes ← encodeRunBundle(data, { gzip: true }) ; sha ← sha256Hex(bytes)
name   ← runBundleName(runId, data.meta.resultsDigest)
existing ← listing has `name` with appProperties.sha == sha32 ? reuse its id     (idempotent retry)
         : remote.create(name, bytes, { resumeKey: 'run:' + runId, appProperties, onProgress })
pending[run:runId] ← stub with bundle { name, bytes, sha256: sha, partial? }
every 30 s of uploading (and at the end): write our lib file, so peers see runs appear progressively
the replaced bundle of the same run (cancelled → done) becomes an orphan → GC
```

`downloadRun(runId)` is called on open, by Download all, or by policy `all`:

```
stub ← syncIndex[run:runId].entry.value ; f ← listing file named stub.bundle.name  (else 'missing')
bytes ← remote.download(f.id, progress) ; sha256Hex(bytes) == stub.bundle.sha256 else 'corrupt'
r ← decodeRunBundle(bytes, gameId)  (recomputes resultsDigest for untrimmed) ; error → 'corrupt'
r.data.meta.resultsDigest == stub.resultsDigest else 'corrupt'
quota pre-check: estimate().quota − usage ≥ 3 × bytes   else state 'local-full'
meta ← { ...r.data.meta, ...stub.extra, status: stub.status, imported: stub.extra.imported,
         synced: { from: stub.owner, fromName, at: now } }   (drops the `imported` that decode adds)
writeCompacted(raw, { ...r.data, meta }, meta, origin)   — one tx; adds runId to the definition
syncIndex[run:runId].local = 1
```

A corrupt result writes nothing. Analyze shows "This run's file in Drive is damaged. It can be
re-uploaded from Laptop." On the owner device, the next GC re-uploads any bundle whose listed
sha32 differs from its index (self-heal).

### 7.7 Ids and collisions

- **def:** content-addressed, so the same id means the same content. Merges are metadata-only.
- **run, group:** random suffixes, globally unique. A run collision (about 2⁻⁴⁰) is handled by
  §7.5.
- **strategy, layout:** user slugs. A collision is a conflict, resolved as copy-local.
  `allocCopyId` and `allocLayoutId` check `taken` against the **local store ∪ the incoming remote
  keys**, so the copy cannot collide with another incoming record.
- **setting:** a fixed key namespace.

### 7.8 Determinism and "never corrupt local data"

- Pulls never write partial records. Each apply is one `update()` transaction per key, and a run
  download is one `writeCompacted` transaction after full verification.
- The engine writes only through `raw`, so applied data never echoes back as a local change, and
  the tracked marks stay in the same transaction as the user's writes.
- Definitions keep their id = hash; run results keep `resultsDigest`. The sync layer never
  re-normalizes or re-encodes a definition. A bundle is the same canonical bytes as Export, so an
  export → import → export of a synced run stays byte-identical.
- Watch and resume rules are unchanged: re-simulation still requires equal game and core versions.

### 7.9 GC (once per 24 h per device, after a successful push)

1. **Duplicates:**
   - Several `lib.<self>` files: merge all, keep `syncMeta.files.ownLib`, delete the rest.
   - Several roots: keep the earliest `modifiedTime`.
   - Several copies of the same bundle name: keep one.
2. **Stale devices:** delete a lib file whose `writtenAt` is more than 180 days old. Its entries
   are already in everyone's merged state. That device starts over by merging if it ever returns.
3. **Tombstones:** drop tombstone *T* from our lib file only when **every** remaining lib file
   contains *T*, or a newer entry for that key. All lib files are read anyway, so this is exact,
   and no stale copy can resurrect the record.
4. **Orphan bundles:** delete `run.*` files referenced by no entry in any lib file and modified
   more than 1 h ago (the upload-then-reference window).
5. **Pacing:** deletes go through the write token bucket. GC is skipped on metered or low battery
   if the browser tells us (`navigator.connection.saveData`).

### 7.10 Account binding, erase, sign-out

- **Binding:** `syncMeta.account = { accountId, email, boundAt }` is set at first sync. A
  different `permissionId` at sign-in opens a sheet: "This device synced with a@…; you signed in
  as b@…". The choices are **Sync this device's data to b@** (`resetLocalSyncState` then `begin`)
  or **Cancel** (revoke).
- **Remove my data from Drive** (confirm sheet):
  1. Rewrite the root as `{ …, erased: { at, by: self } }`.
  2. Delete every other file (paced; progress shown).
  3. `resetLocalSyncState()`, then sign out. Local data is untouched.
  4. Other devices, on their next cycle, see `erased.at > boundAt`. They stop (`off`) and show a
     notice: "Sync was turned off and your Drive data was removed from Pixel. Turn on again?"
  5. Signing in again later rewrites the root without `erased`.
  6. The ~200 B marker stays in Drive; it is listed in "hidden app data" with the rest.
- Users can also remove everything from Google's side: Google Drive → Settings → Manage apps →
  spinner → Delete hidden app data. Then the root is missing, so the next cycle treats Drive as
  empty and asks before uploading (`preview().remoteEmpty`, §8.3).

### 7.11 Triggers, backoff, multi-tab

| Trigger | Condition | Kind |
|---|---|---|
| sign-in | | `begin` |
| app start | prefs.enabled, a valid token in sessionStorage, 3 s after first paint | cycle |
| `visibilitychange → visible` | last cycle > 60 s ago | cycle |
| `onDirty` | debounce 5 s, max wait 30 s | cycle |
| interval | every 5 min while visible | cycle |
| `online` | | cycle |
| Sync now | always (gets a token first if needed: a user gesture) | cycle, resets backoff |
| a run finishes | 10 s after `done` | cycle (uploads its bundle) |

- **Never while hidden:** no Background Sync, no SW token.
- **During an active run:** library sync proceeds; bundle encoding, upload and download wait
  until no run is active.
- **Backoff for `network`, `server`, `rate`:** 30 s, 1 m, 2 m, 5 m, 10 m, then 15 m (cap), with
  ±20 % jitter. `Retry-After` wins when it is longer.
- **Other errors:**
  - `auth` → `needs-auth`, with no timer;
  - `quota` → `drive-full`, retried hourly or on Sync now;
  - `forbidden` → `error` ("Access was removed. Sign in again.");
  - offline (`navigator.onLine === false` or a `network` error) → `offline`, waiting for `online`.
- **Multi-tab:**
  - Each cycle takes the Web Lock `spinner:sync` with `ifAvailable`; a busy lock means another tab
    is syncing.
  - The lock holder broadcasts `SyncStatus` on `BroadcastChannel('spinner-sync')`, and other tabs
    mirror it.
  - After applying, the holder broadcasts `{ changed: kinds[] }`. Every tab bumps `libraryVersion`
    (Define/data), the layouts touch, `recentRuns`, `settingsStore`, and calls `clearRunCache`
    and `clearVerdictCache` for replaced runs.

### 7.12 Storage budget

- **Account card:**
  - **Drive:** spinner's bytes (sum of listed file sizes) and the account's usage and limit
    (`about`).
  - **This device:** `navigator.storage.estimate()` and persisted state.
  - **Runs only on Drive:** count and bytes (`remoteOnly`), with **Download all**.
  - Per run, in Library → Runs: **Remove download (keep on Drive)** (`evict`).
- **Policy defaults (D12):**
  - `onOpen` when `navigator.userAgentData?.mobile` is true, or the viewport is narrower than
    768 px and the pointer is coarse;
  - `all` otherwise.
  - Download all, and policy `all`, first check `quota − usage ≥ 1.5 × remoteOnly.bytes`. Otherwise
    the device downloads what fits and the card says "Not enough space on this device".
- **Local `QuotaExceededError` during a download:** the state becomes `local-full`, the policy
  switches to `onOpen` with a notice, and nothing partial is written (single transaction).
- **Uploads are not optional** (owner: everything). The first sign-in shows the total ("Upload 30
  runs, 48 MB"). Uploads run in the background, newest first, and are resumable.

---

## 8. UX (phone first, 360 px portrait)

### 8.1 Settings → Account (first card on Settings; anchor `#/settings?account=1`)

```
Signed out                              Signed in
┌────────────────────────────────┐      ┌────────────────────────────────┐
│ Account and sync               │      │ Account and sync               │
│ Use your library and runs on   │      │ owner@gmail.com                │
│ all your devices. spinner keeps│      │ ✓ Up to date · 2 min ago       │
│ them in a hidden folder in     │      │ This device: Pixel 11  [Rename]│
│ your own Google Drive.         │      │ ┌────────────┐                 │
│ ┌────────────────────────────┐ │      │ │  Sync now  │                 │
│ │ G  Sign in with Google     │ │      │ └────────────┘                 │
│ └────────────────────────────┘ │      │ Google Drive  182 MB of 15 GB  │
│ spinner sees only its own      │      │ This device    96 MB           │
│ folder, never your other files.│      │ 12 runs only in Drive (31 MB)  │
│ How sync works ›               │      │ [ Download all ]               │
└────────────────────────────────┘      │ Download runs                  │
                                        │ (•) When I open them           │
Not configured (no client id)           │ ( ) All, in the background     │
┌────────────────────────────────┐      │ ⚠ 1 notice                 ›   │
│ Account and sync               │      │ Devices: Pixel 11 (this),      │
│ Sync is not set up in this     │      │   Laptop (yesterday)       ›   │
│ build.                         │      │ [ Sign out ]                   │
└────────────────────────────────┘      │ Remove my data from Drive…     │
                                        └────────────────────────────────┘
```

The status line has one text per state. Colour is never the only signal; each state also has an
icon and a word.

| State | Status line | Action |
|---|---|---|
| `idle` | ✓ Up to date · 2 min ago | Sync now |
| `syncing` | ↻ Syncing… uploading run 3 of 12 (14 MB) | progress bar, `aria-valuenow` |
| `offline` | ⦸ Offline · 4 changes waiting | none |
| `needs-auth` | ! Sign-in expired · 4 changes waiting | **Reconnect** (primary) |
| `backoff` | ! Google Drive is busy · retrying in 2 min | Sync now |
| `drive-full` | ! Your Google Drive is full | "Free up space in Google Drive" link + Sync now |
| `local-full` | ! This device is out of space · runs stay in Drive | Library › Runs |
| `error` | ! Drive data is from a newer spinner. Update the app. / Access was removed. Sign in again. | Check for updates / Sign in |

### 8.2 Shell indicator (`SyncIndicator`, TopBar on phones, NavRail on wide screens)

```
TopBar 360 px:  ┌──────────────────────────────────────────────┐
                │ ←  Library                 [☁✓] [Running 43%]│
                └──────────────────────────────────────────────┘
```

- **Hidden** when sync is `off`.
- **Visible states:**
  - `☁✓` idle: muted;
  - `☁↻` syncing: rotates, static under `prefers-reduced-motion`;
  - `☁⦸` offline;
  - `☁!` needs attention: amber. On widths ≥ 400 px it adds the text "Reconnect".
- **Target and labels:** 44 × 44 px. `aria-label` is the status line ("Sync: up to date, 2 minutes
  ago"). A polite live region announces only changes into or out of the attention states.
- **Tap:** in `needs-auth`, it calls `reconnect()` (inside the click: a user gesture). Otherwise it
  opens `#/settings?account=1`.

### 8.3 First sign-in on a second device (bottom sheet)

```
┌────────────────────────────────┐   Drive empty:
│ Your Drive already has data    │   ┌────────────────────────────────┐
│ From Laptop · synced yesterday │   │ Upload this device's library?  │
│  42 experiments · 9 strategies │   │ 5 experiments · 2 strategies   │
│  6 layouts · 18 runs (31 MB)   │   │ 30 runs (48 MB)                │
│ On this phone                  │   │ Runs upload in the background. │
│  5 experiments · 2 runs        │   │ [ Start syncing ]              │
│ [ Merge both  (recommended) ]  │   │ [ Not now ]                    │
│ [ Replace this phone's data ]  │   └────────────────────────────────┘
│ [ Not now ]                    │
└────────────────────────────────┘
```

- **Replace** asks again ("Delete 5 experiments and 2 runs on this phone?").
- With no local data, the sheet is skipped and the device simply pulls.

### 8.4 Runs that are not on this device

- **Lists (Home, Library → Runs):** the normal row, verdict included (from the stub), plus a
  `☁ In Drive` badge. A paused remote run shows "Paused on Laptop · 43%", greyed, and does not
  open.
- **Analyze / Watch on a remote-only run** (`RemoteRunCard` replaces "not found"):

```
┌────────────────────────────────┐
│ Martingale red · 10,000 × 500  │
│ mean −$41 ± $6 · P(ahead) 38%  │
│ In your Google Drive (1.8 MB), │
│ made on Laptop.                │
│ ▓▓▓▓▓▓▓░░░  Downloading 62%    │
│ [ Cancel ]                     │
└────────────────────────────────┘
```

- **Behaviour of the card:**
  - It downloads automatically when online with a valid token.
  - With no token it shows `[ Reconnect and download ]`.
  - Offline: "You're offline. It will download when you're back online." The download
    auto-starts on `online`.
  - Corrupt: the message from §7.6.
- **Conflict toast** (once per cycle, aggregated): "“Big Martingale” was changed on two devices.
  Both are kept; this device's copy is “Big Martingale (Pixel)”." The toast has a **View** action
  that opens the notices list in Account. Notices are capped at 50 and can be marked read.

### 8.5 Other copy

- Settings → Storage: "Delete all data" becomes **"Delete everything on this device"**, with the
  sub-line "Your Google Drive copy is kept." (shown when signed in).
- **Remove my data from Drive** confirm: "Remove all spinner data from your Google Drive? It stays
  on this device. Your other devices stop syncing." `[Remove from Drive]` (danger) `[Cancel]`.
  Progress: "Removing 48 files…".

---

## 9. Error and offline handling

| Situation | Behaviour |
|---|---|
| App offline at start | Everything works locally. Sync stays `offline` and the GIS script is not loaded. Remote-only runs show the offline card |
| Network drops mid-cycle | The current request fails as `network`; nothing is committed for that step. State `offline`, then a retry on `online` (or backoff) |
| 401 mid-cycle | `needs-auth`, Reconnect. Resumable sessions continue after it |
| 403 rate / 429 | Per-request retries (≤ 5, exponential, `Retry-After`), then cycle `backoff` |
| 403 storage quota | `drive-full`. Uploads stop and library pulls continue (pulls need no space) |
| 5xx | as rate |
| Lib file undecodable, or hash mismatch per entry | That file or entry is skipped with a notice naming the device. Other data still syncs. Its `seen` is not advanced, so it is retried after the peer rewrites it |
| Root `version > 1` | `error`: "Drive data is from a newer spinner. Update the app." Nothing is written |
| Bundle missing (404) | Remote-only card: "This run's file is missing in Drive." The owner device re-uploads it at its next GC |
| Bundle corrupt | Nothing written; notice; owner self-heals |
| Local quota during apply or download | `local-full`; policy to `onOpen`; library records are tiny and still apply |
| IndexedDB unavailable (memory backend) | Sync is **disabled** on this device, with the card note "Sync needs storage that persists". A memory-only device must not push tombstones for everything after a reload |
| Clock skew > 24 h | Accepted (HLC); a warning names the device |
| Popup blocked or closed | Toast "The sign-in window didn't open", plus the "Sign in in this window" button (§5.4) |
| GIS script fails to load | "Couldn't reach Google. Check your connection." Retry is allowed (`scriptPromise` resets) |
| Another tab is syncing | This tab mirrors its status; Sync now says "Syncing in another tab" |
| A run deleted remotely while running here | Kept; re-pushed after it finishes; notice |

---

## 10. Privacy and security

- **Scope:** only `https://www.googleapis.com/auth/drive.appdata`. Google shows it as *"See,
  create, and delete its own configuration data in your Google Drive"*. spinner **cannot see,
  list or change any other Drive file**. The folder is hidden from the Drive UI. It counts toward
  the user's storage and can be deleted from Drive → Settings → Manage apps.
- **No server:** data goes only between the browser and Google. There is no analytics, and
  spinner sees nothing.
- **Tokens:**
  - Memory plus sessionStorage only, about 1 h, never in localStorage or IndexedDB, never logged
    (the error reports from §6.5 of architecture.md must redact `Authorization` and
    `access_token`).
  - No refresh tokens. A revoke happens on sign-out.
  - The redirect fallback checks `state` and scrubs the URL fragment before routing.
- **Client ID:** public by design. Its authorised JavaScript origins are only
  `https://creynia.github.io` plus localhost for development, so a copy of the ID on another
  origin is refused by Google. There is no client secret in the repo, in CI or in the build.
- **Data integrity is not confidentiality:** Drive data is not end-to-end encrypted. It is
  readable by the account owner (and by Google). That is acceptable for simulation data, and it is
  stated. Client-side encryption with a passphrase is a chip.
- **CSP** (§5.5) limits where scripts and connections may go.
- **About** (add after the decisions #11 disclaimer, verbatim):

  > **Google Drive sync (optional).** If you sign in with Google, spinner keeps a copy of your
  > library and runs in a hidden app folder in your own Google Drive. spinner can see only that
  > folder, never your other files, and there is no spinner server: your data goes only between
  > this browser and Google. To remove it, use Settings → Account → Remove my data from Drive, or
  > Google Drive → Settings → Manage apps → spinner → Delete hidden app data. You can revoke access
  > at myaccount.google.com/permissions.

  The README gets the same paragraph under "Privacy".

---

## 11. Test strategy

### 11.1 Unit (node, Vitest, `VITEST_MAX_WORKERS=2`)

- **core/store:**
  - Upgrade tests with fake-indexeddb: a fresh v3 has 14 stores; a v2 database seeded with every
    store's data keeps all of it and gains 3 stores; a v1 database upgrades through 2 and 3.
  - The memory backend has 14 stores.
  - `update()` atomicity on both backends: a throw aborts both the read and the writes.
  - Tracking marks for every writer path in §3.3, in the same transaction; an aborted transaction
    leaves no mark; a raw write leaves none; `theme` gives no mark and `framing` does.
- **core/sync, pure parts:**
  - HLC monotonicity and `recv`;
  - entry hash vectors (pinned);
  - lib round trip byte-identical;
  - decode refusals;
  - every row of the §7.5 table as a test;
  - property tests (seeded, using `core/rng`) that `mergeEntries` is commutative, associative and
    idempotent.
- **core/sync, engine with `createMemoryRemote`:** the key acceptance tests.
  - **Convergence fuzz:**
    - 3 devices (each its own memory backend, all sharing one remote) run 300 random operations.
      The operations are create, edit, delete and rename of strategies, layouts, defs and groups;
      setting changes; and finishing, cancelling or deleting fake runs.
    - The devices sync in a random interleaving, then all sync twice more.
    - **Assert:** every device has identical synced stores (canonical dump). No record is lost
      except by delete or a conflict copy. Every conflict produced exactly one notice.
  - **Crash injection:** a fault on the *k*-th remote call, for every *k* across a cycle. Then
    sync again. Assert convergence and that no local record changed except by a resolution rule.
  - **Run lifecycle:**
    - paused stub → done bundle;
    - cancelled prefix → continued → done supersedes and the old bundle is GC'd;
    - remote delete while active;
    - a corrupted bundle byte (sha mismatch) and a tampered digest are both rejected, with nothing
      written.
  - **Forward compatibility:** a `v: 2` entry survives a round trip through an older device
    untouched.
  - **GC:** tombstone retention across a stale device; orphan bundle removal after 1 h only.
  - **Erase marker:** other devices go `off`.
  - Comparisons of large byte arrays must use length plus a hash or a loop, **never `toEqual` on
    multi-MB typed arrays**: it exhausted the heap in the prototype.
- **app/services/sync:**
  - The Drive client against `tests/fakes/drive-server.ts`, as in the prototype: paging,
    multipart, resumable resume, an expired session (404) restarting, a missing `Range`, abort,
    every error mapping.
  - The GIS token source with a fake `google.accounts.oauth2` (prototype tests, plus a
    sessionStorage restore after "reload").
  - The redirect return script: `state` mismatch, error fragments.
  - The service with a fake engine and fake timers: triggers, debounce, backoff schedule, the lock.

### 11.2 Component (happy-dom)

- `Account` renders every `SyncState` with text.
- `reconnect()` is called synchronously inside the click handler: the spy is called before any
  `await` resolves.
- `SyncIndicator` has an `aria-label` for every state.
- `RemoteRunCard` covers progress, offline and corrupt.
- The first-sync sheet's buttons map to `chooseFirstSync`.

### 11.3 E2E (Playwright, `res browser`, `PW_WORKERS ≤ 2`)

- **Fakes:** `tests/e2e/fakes/route.ts` installs, per browser context:
  - `page.route('https://accounts.google.com/gsi/client', …)` serving `tests/fakes/gis-fake.js`.
    It defines `google.accounts.oauth2` and grants a token at once. Tests can make it block the
    popup, deny, or expire via `window.__gisFake`.
  - `page.route('https://www.googleapis.com/**', …)`, forwarding to **one shared
    `createFakeDrive()` instance in the test process**.
  - Two `browser.newContext()` therefore act as **two devices on one account**.
- **Scenarios** (`tests/e2e/sync.spec.ts`; `phone-360` and `desktop` projects):
  1. A: sign in → the Drive-empty sheet → Start → a definition, a layout and a finished small run
     (200 sessions) upload. The indicator ends at ✓.
  2. B with its own local definition: sign in → the merge sheet shows the counts → Merge. B lists
     A's run with a verdict and `☁ In Drive`. Opening it downloads it, and Analyze matches A's
     headline numbers (same `resultsDigest`).
  3. Edit a layout on A, then Sync now on B: B shows the edit.
  4. Edit the same strategy on A and on B (offline), then sync both: both copies exist on both
     devices, and B has a notice.
  5. Delete a run on B and sync both: it is gone on A.
  6. B offline (`context.setOffline(true)`): edits queue ("Offline · 2 changes waiting"). Online
     again: pushed.
  7. Token expiry (`__gisFake.expireAll()`): the indicator shows Reconnect. Tapping it (silent
     grant) lets the sync finish.
  8. Popup blocked: the "Sign in in this window" fallback round trip through `oauth-return.html`
     (the fake auth endpoint is routed as well).
  9. Remove my data from Drive on A: B shows "Sync was turned off…", and the fake Drive holds only
     the erase marker.
  10. CSP: the whole existing suite plus this one, with zero `securitypolicyviolation` events. An
      axe scan of Account and the sheets at 360 px. No horizontal scroll.

### 11.4 Manual plan for the owner (real Google, after deploy)

1. On a laptop in Chrome at https://creynia.github.io/spinner/: Settings → Account → Sign in. The
   consent screen shows the "unverified app" or test-user notice and **only** the "its own
   configuration data" permission. Run a 10,000 × 500 experiment, then check that the Account card
   shows ✓ and the Drive usage grows by about 1–2 MB.
2. **Pixel, installed PWA:** sign in from the installed app. Note whether the popup returned to
   the app. If not, use "Sign in in this window" and report which worked. Choose Merge. The runs
   appear with verdicts; open one and it downloads; the numbers match the laptop's.
3. Turn the phone's network off, edit a strategy, and turn it back on: it syncs within 5 s of
   coming back.
4. Leave the phone app open for more than 1 hour: the indicator shows Reconnect, and one tap fixes
   it with a quick flash and no questions.
5. Edit the same strategy on both devices while one is offline: both copies remain, and there is a
   notice.
6. https://myaccount.google.com/permissions lists spinner with "Google Drive: see, create and
   delete its own configuration data". Sign out on the laptop: the entry disappears or the token is
   revoked.
7. Remove my data from Drive on the laptop: the phone shows "Sync was turned off". Drive →
   Settings → Manage apps → spinner shows (almost) no hidden data.
8. Add a row to `docs/perf.md`: the time to first sync and to download a run on the phone.

---

## 12. Owner setup (Google Cloud), about 10 minutes

Google renamed the console's "OAuth consent screen" pages to **Google Auth Platform** (Branding,
Audience, Data access, Clients). The older names are in parentheses.

1. **Project.** Open https://console.cloud.google.com/ → the project picker (top bar) → **New
   project** → name `spinner` → **Create**, then select it.
2. **Enable the Drive API.** ☰ → **APIs & Services → Library** → search "Google Drive API" →
   **Google Drive API** → **Enable**.
3. **Consent screen.** ☰ → **Google Auth Platform** (APIs & Services → OAuth consent screen) →
   **Get started**:
   - App information: app name `spinner`, User support email = your Gmail → Next.
   - Audience: **External** → Next.
   - Contact information: your Gmail → Next.
   - Agree to the policy → **Create**.
4. **Scope.** Google Auth Platform → **Data access** → **Add or remove scopes**:
   - Filter for `drive.appdata` and tick
     `https://www.googleapis.com/auth/drive.appdata` ("See, create, and delete its own
     configuration data in your Google Drive").
   - **Update**, then **Save**.
   - It is a non-sensitive scope, so it needs no verification review.
5. **Who can sign in.** Google Auth Platform → **Audience**:
   - **Recommended:** leave Publishing status at **Testing**, then **Test users → Add users** →
     your Gmail → Save. Only listed test users (up to 100) can sign in. Sign-in shows a "Google
     hasn't verified this app" step: click **Continue**. Testing mode has no other limit that
     matters here (its 7-day refresh-token expiry does not apply, because there are no refresh
     tokens).
   - **Alternative:** **Publish app** (In production). Anyone with a Google account can then sign
     in. With only a non-sensitive scope there is no security review, but the consent screen may
     still show "unverified" until you complete brand verification (Branding page: home page and
     privacy policy URLs, e.g. the README).
6. **Client.** Google Auth Platform → **Clients** (APIs & Services → Credentials → Create
   credentials → OAuth client ID) → **Create client**:
   - Application type: **Web application**; Name: `spinner web`.
   - **Authorised JavaScript origins:**
     - `https://creynia.github.io`;
     - `http://localhost:5173` (vite dev);
     - `http://localhost:4173` (vite preview and e2e).
   - **Authorised redirect URIs** (for the §5.4 fallback):
     - `https://creynia.github.io/spinner/oauth-return.html`;
     - `http://localhost:5173/oauth-return.html`;
     - `http://localhost:4173/spinner/oauth-return.html`.
   - **Create**. Copy the **Client ID** (`1234…-abc….apps.googleusercontent.com`). Ignore the
     client secret: spinner never uses it, and you may delete it from the client's page.
   - Origin changes can take a few minutes to apply.
7. **Give the ID to the build.** It is public, so either way is fine:
   - **(a) recommended:** GitHub → creynia/spinner → Settings → Secrets and variables → Actions →
     **Variables** tab → **New repository variable** → Name `GOOGLE_CLIENT_ID`, value = the ID.
     WP-S6 adds `env: VITE_GOOGLE_CLIENT_ID: ${{ vars.GOOGLE_CLIENT_ID }}` to the build step of
     `pages.yml`.
   - **(b):** paste it into chat, and the orchestrator commits it as `COMMITTED_CLIENT_ID` in
     `src/app/services/sync/config.ts`.
   - Local development: put `VITE_GOOGLE_CLIENT_ID=…` in `.env.local` (gitignored by Vite's
     defaults; add it to `.gitignore` if it is missing).
8. **Check.** After the next deploy, Settings → Account shows **Sign in with Google**, not "not set
   up". Then follow §11.4.

---

## 13. Work packages

These rules apply to every WP:

- **Branches:** `claude/spinner-sync-<wp>`.
- **Ownership:** exclusive; everything else is read-only. The orchestrator grants batons
  (`BATON REQUEST <path> <why>`).
- **Done means green** on `npm run check`. Vitest runs through `res cpu`, Playwright through
  `res browser`.
- **Rename coordination:** **no rename feature** in these WPs. `DefinitionRecord.displayName?` is
  added by the parallel rename work. S2a's `mergeDefRecord` merges it by HLC if present, and must
  compile with or without the field: treat it as an optional unknown key until the rename lands.

### DAG and waves

```
Wave 1:  S0 contracts + stubs + layering edge
            │
Wave 2:  ┌──┴──────────┬───────────────┬────────────────┐
         S1 store v3   S2a sync pure   S3 auth + Drive  S4 UI (vs S0 stub)
         + tracking    (hlc, entries,  client + fakes
            │          merge, libfile)       │                │
            └─────┬────────┘                 │                │
Wave 3:        S2b engine (+ memory remote, runs, gc)         │
                  │                          │                │
Wave 4:        S5 app service + integration ◄┴────────────────┘
                  │
Wave 5:        S6 e2e (two devices), CSP, SW test, About/README, pages.yml
```

There are eight WPs; at most four run at once.

### WP-S0 Contracts and stubs (wave 1, one agent)

- **Owns:**
  - `src/core/contracts/sync.ts` (new, from the prototype);
  - `src/core/contracts/run.ts` (additive `RunMeta.synced?`);
  - `src/core/contracts/contracts.test.ts` (append);
  - `src/core/sync/{index,hlc,entries,merge,libfile,engine,memory-remote}.ts`: stubs with the
    §4.4 signatures, throwing `not implemented`;
  - `src/app/services/sync/{index,config}.ts`: the §4.5 inert stub, state `off`, with `config.ts`
    reading `VITE_GOOGLE_CLIENT_ID`;
  - in `src/core/store/backend.ts`: **only** the `TxReader` type, the `update` signature and the
    memory implementation (WP-S1 does the rest of the file).
- **Batons:**
  - `eslint.config.js` and `tests/build/layering.test.ts` in one commit: `CORE_MODULES += 'sync'`,
    `CORE_ALLOWED.sync = ['contracts', 'money', 'experiment', 'store']`, `testing` may import
    `sync`;
  - `src/core/index.ts`: append `export * from './sync'` (types and stubs);
  - `src/env.d.ts`: `interface ImportMetaEnv { readonly VITE_GOOGLE_CLIENT_ID?: string }`.
- **Acceptance:**
  - typecheck, lint and the layering test pass;
  - a contract test pins `HLC_PATTERN`, `SYNCED_SETTING_KEYS`, `RESUMABLE_CHUNK % 262144 === 0`
    and `SYNC_KINDS`;
  - the memory `update()` is tested: a read inside sees earlier writes of other transactions, and a
    throw aborts everything;
  - the existing suite is green.

### WP-S1 Store v3 and change tracking (wave 2)

- **Owns:**
  - `src/core/store/backend.ts` (v3: `V2_STORE_NAMES`, the 3 stores, `DB_UPGRADES[3]`, the IDB
    `update()`, `SYNCED_STORES`);
  - `src/core/store/tracking.ts` (new: `createTrackedBackend`, `evictRunResults`);
  - `src/core/store/{schema,backend,tracking}.test.ts`;
  - `src/app/services/db.ts`:
    - `getRepo` wraps the backend with `createTrackedBackend`;
    - `getBackend()` returns the tracked backend, `getRawBackend()` the raw one;
    - `deleteAll` goes through the raw backend; `syncMeta` survives it except `account` and `seen`
      (prefs and device persist);
    - when the backend is memory-only, `getBackend()` is not wrapped, so sync stays disabled;
  - `tests/app/shell.test.tsx` (touch for the `keyOf` and store counts).
- **Batons:** `src/core/index.ts` (append exports).
- **Acceptance:**
  - fake-indexeddb: a fresh v3 has 14 stores, each with its keyPath and indexes; a seeded v2
    reopened at v3 keeps every record; v1 → v3 works; `openStore` reports `idb`;
  - mark tests for each §3.3 writer path: the exact `syncDirty` keys, settings filtered, and none
    for a raw write;
  - an aborted transaction leaves no mark;
  - `onDirty` fires once per committed transaction;
  - `update()` on IDB can read then write in one transaction;
  - `deleteAll` leaves zero marks.

### WP-S2a Sync core: pure parts (wave 2)

- **Owns:** `src/core/sync/{hlc,entries,merge,libfile}.ts` and their tests.
- **Batons:** none.
- **Acceptance:**
  - the HLC encodes and decodes against `HLC_PATTERN`, `tick` is strictly increasing under a
    frozen or backwards clock, and `recv` dominates;
  - `entryOf` hash vectors are pinned, and `verifyEntry` returns each code;
  - encode/decode of the lib is byte-identical on round trip; bad format, newer version and bad
    gzip are refused with `SyncFileError` codes;
  - `resolve` is a table-driven test of every §7.4/§7.5 cell;
  - the merge helpers' properties (commutative, associative, idempotent) hold over 1,000 seeded
    cases;
  - `mergeDefRecord` keeps the definition untouched (id = hash) and handles a missing or present
    `displayName`.

### WP-S3 Auth and the Drive client (wave 2)

- **Owns:**
  - `src/app/services/sync/{gis,drive,redirect,backoff}.ts` (from the prototype);
  - `public/oauth-return.html`, `public/oauth-return.js`;
  - `tests/fakes/drive-server.ts` (the fake Drive as a `fetch` handler, from `fake-drive.mts`, plus
    `about`, `Retry-After`, a session-expiry switch, and a delay knob);
  - `tests/fakes/gis-fake.js` (the stub GIS script with `window.__gisFake` controls);
  - `tests/app/sync/{gis,drive,redirect,backoff}.test.ts`.
- **Batons:** none.
- **Acceptance:**
  - the prototype tests;
  - list paging over 2,500 files; resumable upload with a resume, a 404 restart and no `Range`
    header; download progress; abort; every error code;
  - token restore from sessionStorage; revoke while offline;
  - redirect: a `state` mismatch is refused and the fragment scrubbed;
  - backoff: the schedule with jitter bounds and `Retry-After`; the write token bucket allows ≤ 3
    per second.

### WP-S4 Sync UI (wave 2, against the S0 stub)

- **Owns:**
  - `src/app/screens/Settings/Account.tsx` (+ test);
  - `src/app/components/SyncIndicator.tsx` (+ test);
  - `src/app/components/SyncSheets.tsx` (the first-sync, account-switch, remove-data and notices
    sheets, + test);
  - `src/app/components/RemoteRunCard.tsx` (+ test).
- **Batons:**
  - `src/app/screens/Settings/index.tsx`: insert `<Account/>` first; the "Delete everything on this
    device" copy; the About privacy paragraph from §10, verbatim;
  - `src/app/components/TopBar.tsx` and `Nav.tsx`: one line each;
  - `src/app/styles/tokens.css`: an amber token only if none exists.
- **Acceptance:**
  - every §8.1 state renders its text; the indicator has an `aria-label` per state;
  - Reconnect and Sign in call the service synchronously in the click handler;
  - axe is clean at 360; no horizontal scroll at 360 and 844 × 390;
  - reduced motion stops the spinner;
  - `RemoteRunCard` covers progress, offline, needs-auth, missing and corrupt.

### WP-S2b Sync engine (wave 3: needs S1 and S2a)

- **Owns:** `src/core/sync/{engine,runs,gc,memory-remote}.ts` and tests, including
  `engine.fuzz.test.ts`.
- **Batons:** `src/core/store/sink.ts`, only if `writeCompacted` needs an option to skip
  `storage: backend.kind`, which must stay `'idb'`.
- **Acceptance:** the §11.1 engine bullets:
  - 3-device convergence fuzz;
  - crash injection at every remote call;
  - the run lifecycle;
  - integrity rejections writing nothing;
  - forward-compatible opaque entries;
  - GC (tombstone and stale device, orphan ≥ 1 h);
  - erase marker;
  - first-sync merge and replace;
  - `uploadRuns: false` skips bundles but pushes stubs;
  - time budget → `more: true`;
  - whether a cycle with no changes makes exactly **1 request (list)**. This is the request budget
    test.

### WP-S5 App service and integration (wave 4: needs S2b, S3, S4)

- **Owns:**
  - `src/app/services/sync/{index,service,lock,channel}.ts` (replacing the stub bodies; the API is
    unchanged);
  - `tests/app/sync/service.test.ts`.
- **What it builds:**
  - the triggers (§7.11), Web Lock, BroadcastChannel (status, changes, token share), backoff, the
    status store;
  - `describeRun` from `runMetrics` and `verdictFromMetrics`;
  - `isRunActive` from the controller registry;
  - the policy default (§7.12);
  - the refresh fan-out after apply.
- **Batons:**
  - `src/app/main.tsx` (start the service);
  - `src/app/services/runs.ts` (`RunListItem.remote?: { bytes; owner; status }`, remote rows in
    `listRuns`, and an `isActive` export);
  - `src/app/screens/Analyze/data.tsx` and `src/app/screens/Watch/deps.ts` (a `remote` state →
    `RemoteRunCard`);
  - `src/app/screens/Library/index.tsx` and `src/app/screens/Home/index.tsx` (the badge, "Remove
    download", and greyed remote paused runs);
  - `src/app/screens/Define/data.ts` and `src/app/services/layouts.ts` (export the `touch`
    functions only).
- **Acceptance:**
  - fake timers: each trigger and the debounce limits;
  - a hidden tab never syncs;
  - with two simulated tabs (two service instances, one lock shim), only one cycles;
  - a remote-only run row shows its verdict and badge; opening it downloads it, then renders
    Analyze;
  - a memory-backend device stays `off` with its note;
  - no `console.error` on the happy path.

### WP-S6 E2E, CSP, SW and docs (wave 5: needs S5)

- **Owns:**
  - `tests/e2e/sync.spec.ts`, `tests/e2e/fakes/route.ts`;
  - `build/vite-plugin-csp.ts`;
  - `tests/build/sw.test.ts` additions;
  - `README.md` (the Privacy section);
  - `docs/design/architecture.md` (one pointer paragraph to this doc).
- **Batons:**
  - `vite.config.ts` (register the CSP plugin, production only);
  - `.github/workflows/pages.yml` and `ci.yml` (the `VITE_GOOGLE_CLIENT_ID` env from
    `vars.GOOGLE_CLIENT_ID`; CI e2e uses a dummy ID, since the fakes do not check it);
  - `playwright.config.ts` (only if a fixture needs it).
- **Acceptance:**
  - all §11.3 scenarios pass on `phone-360` and `desktop`;
  - the full existing e2e suite passes with the CSP, with zero violations;
  - the SW test shows that a cross-origin request is not intercepted;
  - `npm run check` is green.
- The orchestrator records the D1–D20 summary in `decisions.md` and the open questions in
  `open-questions.md`.

---

## 14. Open questions (product calls, with recommended defaults)

| # | Question | Recommended default | Alternatives |
|---|---|---|---|
| Q1 | Should **theme** follow the account? | **No, per device.** A phone often follows the system dark mode; framing and pace do sync. | Sync it with framing and pace. |
| Q2 | Which devices download full runs automatically? | **Phones: when opened. Desktops: all, in the background.** Every run is always uploaded, lists always show verdicts, and Download all is one tap. | All devices download all; all download on open. |
| Q3 | Continue a **paused or cancelled run on another device**? | **Not in v1.** Paused runs show as "Paused on Laptop · 43%". A cancelled run's prefix is analyzable anywhere. | v2: hand-off via a prefix bundle (contiguous chunks 0…k−1 rebuild a valid bitmap) plus an owner transfer. |
| Q4 | Sync **gallery-origin** runs? | **Yes, like any run** (≤ 2 MB each). Simplest, and works offline on the other device. | Sync a stub that re-fetches from `gallery/`. |
| Q5 | **Concurrent edits** of a strategy or layout | **Keep both** (a conflicted copy named with the device) plus a notice. | Last writer wins silently; ask the user each time. |
| Q6 | **Uploads on mobile data** | **Always** (owner chose everything; runs are 1–2 MB). The Account card shows the totals. | A "Wi-Fi only" switch, using `navigator.connection.type` on Android Chrome only. |
| Q7 | Who can sign in: Testing mode with the owner as test user, or publish? | **Testing**, with the owner (and anyone you add) as test user. | Publish to production; brand verification is optional for this scope. |
| Q8 | Encrypt Drive data with a passphrase? | **No in v1** (it is your own Drive, simulation data). Make it a chip. | Client-side AES-GCM with a passphrase that each device must enter. |

---

## 15. Prototype and risks to verify

`docs/design/sync-prototype/` holds throwaway code. The `.mts` extension keeps it out of the app's
tsconfig and ESLint, and Prettier ignores `docs/`. It contains:

- `contracts-sync.mts` (§4.1);
- `drive.mts` (the `RemoteStore` over Drive REST);
- `gis.mts` (the GIS `TokenSource`);
- `fake-drive.mts` (the fake Drive as a fetch handler);
- `prototype.test.mts`: 5 tests, all passing. They cover multipart create, list paging, download,
  update, delete, about; a **13 MB resumable upload that is interrupted and resumes from the
  server's offset**; the error mapping; and GIS sign-in, early expiry, silent reconnect with
  `login_hint`, revoke, a missing scope, a blocked popup and an unconfigured build.

| # | Risk | Mitigation and check |
|---|---|---|
| R1 | Whether the GIS popup returns to an **installed Android PWA** | Redirect fallback (§5.4); manual step 2 |
| R2 | A browser's popup blocker on `prompt: ''` reconnects | Reconnect is called only from clicks (component test); fallback |
| R3 | Whether the resumable upload `308` `Range` header is exposed through CORS | If it is not, the client assumes the whole chunk landed (coded); a `bytes */N` status query before finishing verifies. Manual step 1 with a large run |
| R4 | Main-thread jank encoding a 100k-session bundle | Uploads wait for no active run; a chip moves encoding to a worker |
| R5 | Lib file growth with huge libraries (> 10 MB gz) | Measure in the fuzz; a chip shards lib files by kind (`lib.<dev>.runs.json.gz`) |
| R6 | The GIS script is unversioned and can change under us | It is used only through the 3-call surface typed in `gis.mts`; the fake mirrors it; manual check after deploy |
