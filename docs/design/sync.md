# Sync across devices with Google Drive (design spike, rev 3)

Owner request (2026-10-28): *"I would also like to be able to share experiments and other data
across devices seamlessly by logging into my google account."*

The owner has fixed two inputs:

- **Store:** the owner's own **Google Drive `appDataFolder`**, with Google sign-in in the browser.
  There is no backend and no Firebase.
- **Scope:** sync **everything**: definitions, strategies, layouts, groups, settings, run meta and
  full run results.

**Rev 2** applies the PR #36 review: B1–B6, should-fixes 1–12 and the nits. **Rev 3** applies the
re-review: N1–N3, should-fixes 1–5 and the nits. §16 lists the changes for both.

- `decisions.md` ("Google Drive sync") and open questions 13–18 are already recorded.
- Where rev 2 refines a recorded decision, §1 says so. The two refinements are merging by version
  vectors and bundles for done runs only. The orchestrator updates `decisions.md`.

How to use this doc:

- §13 splits the work into **ten work packages**, at most four at once.
- A **sign-in gate** after wave 2 has the owner test Google sign-in on the Pixel before the engine
  is wired in.
- §4 holds the contracts that WP-S0 freezes.
- The prototype in `docs/design/sync-prototype/` (§15) passes all 12 of its tests, 7 of them in
  the merge model. The model fuzz passes 1,000 seeds; it defaults to 100, and `MODEL_SEEDS=1000`
  raises it. Run it with `npx vitest run --root docs/design/sync-prototype`.

---

## 1. Decisions

| # | Topic | Decision | Main alternative (rejected because) |
|---|---|---|---|
| D1 | Auth | **Google Identity Services (GIS) token model** (`initTokenClient`), scope **`drive.appdata` only**.<br>• **Popup** on desktop and in browser tabs.<br>• **Redirect** (`oauth-return.html`, OAuth implicit grant) is the default in an **installed Android app** (`display-mode: standalone` on Android). It is also used when `acquire()` times out or the popup cannot open.<br>• The redirect's `state` lives in localStorage, so it survives a Custom Tab hop.<br>• Both are implicit-style flows, which OAuth 2.1 discourages. Accepted: no secret, a token of about 1 h, a narrow scope, a CSP, and Google documents the flow for browser apps. | PKCE code flow: Google *Web* clients need the client secret at the token endpoint, and the refresh token would sit in browser storage. |
| D2 | Tokens | **An access token only** (about 1 h); **no refresh token exists client-side**.<br>• Token and expiry live in **localStorage**, so restarting the app within the hour needs no prompt. The CSP is the defence.<br>• On expiry, one tap on **Reconnect** (a silent popup needs a user gesture).<br>• **No amber nag when nothing is pending.** | sessionStorage: every app restart would need a reconnect. |
| D3 | Account email | From Drive `about.get` (`emailAddress`, `permissionId`); no `openid email` scope. | An extra consent line for no gain. |
| D4 | GIS script | Loaded lazily from `accounts.google.com/gsi/client`, only when the Account card renders or on sign-in. Not an npm dependency, no SRI: Google forbids self-hosting it and does not version it. A documented exception to pinning. | Not allowed or not possible. |
| D5 | Drive layout | A root marker, **one lib file per device** (written only by that device), and **one bundle per done run** (`run.<runId>.<digest16>.spinner.json.gz`, the existing gzip export format). | One file per record: thousands of requests. One shared manifest: Drive v3 has no compare-and-swap. |
| D6 | Merge (B1, N2, N3) | A state-based CRDT. **Each entry carries `basis`** (the HLC of its parent) **and a per-key version vector `vv`**, the transitive form of the parent pointers: A descends from B iff `vv(A) ≥ vv(B)`.<br>**Merging is a fold over the whole set** of entries known for a key: every lib file, our base and our local candidate. **It never mutates an entry** (N2):<br>1. **Equivalent** entries (same fingerprint and deleted flag) collapse into the lowest-HLC one, with their vvs joined. This only merges identical content, and it ends "copy of a copy" (N3).<br>2. Take the **maximal** elements under strict vv dominance.<br>3. The **winner** among them is an edit over a delete, then the higher HLC.<br>4. **Every other maximal live entry is a loser** and becomes a deterministic conflicted copy, plus a notice.<br>The join of all folded vvs (`seen`) is kept **locally** as the basis of the next edit and is never published as the winner's own vv. The engine **re-lists and re-pulls just before writing its lib file** and re-runs the fold. | Pairwise `mergeEntries` that joined the winner's vv: it fabricated ancestry and depended on the fold order (rev 2 defect N2). Plain LWW: loses an edit when both devices push before either pulls. |
| D7 | Clocks (B5, N1) | HLC per device. **Entries are minted from the edit time** (`syncDirty.last`), not the push time. **This device's vv component comes from one persistent, monotone counter `syncMeta.vvCounter`.** Every new entry, including the local candidate in a fold, consumes a fresh value. The counter **survives every reset**: re-seed, Replace, account switch, erase, "Delete everything on this device". Only a new device id (fresh browser storage) starts a new component. Our own older entries are therefore always dominated, never concurrent, and never win over a newer local edit. | A per-key count from the base: after a reset it restarts at 1, and the peers' `{self:3}` beats the new edit (rev 2 defect N1). |
| D8 | Change tracking | A **tracking `Backend` decorator** writes a `syncDirty` mark **in the same IndexedDB transaction** as each tracked write. The engine writes through the raw backend. Other tabs broadcast their marks to the tab holding the sync lock. | Instrumenting each of the 15+ writers. |
| D9 | Schema | **DB v3** adds `syncIndex`, `syncDirty` and `syncMeta`. `V2_STORE_NAMES` is frozen and the upgrade is guarded by `contains`. Existing records are unchanged. The only changes to existing types are additive: `RunMeta.synced?`, and the encoder now returns its digest. | Fields on existing records: touches frozen contracts and every writer. |
| D10 | Fingerprints | `hash = sha256(canonicalJson(fingerprintValue(kind, value)))`, defined per type (§7.2). It **excludes `updatedAt`** and other volatile fields, so a re-save that changes nothing pushes nothing. | A hash of the raw record: every save churns. |
| D11 | Definitions (B5) | Content-addressed and immutable, so they **never conflict on content**. The record metadata is a **join over the maximal entries of the fold**:<br>• `runIds`: union, **sorted**, minus deleted runs;<br>• `displayName`: field-level LWW **by `displayNameAt`** (from rename PR #37), with **ties broken by the entry HLC**; a rename-back keeps `displayNameAt` as a tombstone;<br>• `createdAt`: min; `updatedAt`: max;<br>• **unknown keys are preserved**.<br>The join takes the max HLC and the joined `vv`, and mints nothing, so devices cannot ping-pong. | Entry-level LWW: a rename and a new run on another device would lose one of them. |
| D12 | Strategies, layouts, groups | All three have **mutable whole records under stable ids** (strategy and layout slugs; group random ids). They use **entry-level LWW plus the D6 concurrency rule**.<br>• A concurrent loser becomes a conflicted copy with id `<id-base>-<6 hex of its fingerprint>` and name "… (device name)".<br>• A strategy copy re-keys `strategy.id` and recomputes `hash`. A layout copy keeps `layoutHash`, which ignores id and name.<br>• Groups are **never unioned** (B4): `runIds` is ordered (sweep index, compare baseline first). | A union of group `runIds`: breaks sweep and compare order. |
| D13 | Runs (B3, B6) | **Only `done` runs get a bundle.**<br>• Paused, cancelled and errored runs sync as **stubs only** (status, counts, error).<br>• Running and queued runs are not pushed.<br>• A run made here has `owner` = this device; only the owner writes its entry. **A downloaded run keeps `owner = meta.synced.from`**, so a downloader never takes ownership.<br>• A **run imported** (file or gallery) with the same runId and digest on several devices is **one shared entry with no owner**: any device may write it, the upload is skipped when a remote stub already has the digest, and LWW decides with no notice.<br>• **Dry runs and benchmark runs** (`DRY_RUN_TAG`) are never synced.<br>• No resume on another device in v1. | Partial bundles for cancelled runs: cancelled is terminal, never compacted, and has no `resultsDigest` (`controller.ts`). |
| D14 | Run download | Every done run is uploaded. Downloads are a per-device setting: `onOpen` (default on phones) or `all` (default on desktops). Remote-only runs appear **in every run list and picker** with their verdict line and a "☁ In Drive" badge, and Sweep reuses them instead of re-running. | Pulling everything on phones. |
| D15 | Settings | **Synced:** `framing` and `pace`. `pace` only seeds the pace of new drafts; existing definitions carry `roundsPerHour` explicitly, so their ids never change.<br>**Per device:** `theme` and everything else. | (open question 13: theme stays per device) |
| D16 | Integrity | A downloaded bundle is verified **before one atomic write**:<br>• the file's sha256 against the stub;<br>• `resultsDigest` recomputed by the decoder (except for trimmed bundles, §7.6) and compared with the stub.<br>Lib entries are fingerprint-checked, and definition ids are re-hashed. Newer-format data is kept opaquely, never dropped.<br>**No byte-identity claim:** bundles may now carry `displayName`. Reuse is keyed on **runId + digest**. | n/a |
| D17 | Atomicity on Drive | The bundle is written before the lib entry that references it. An upload becomes visible only when complete. A lib update is one media `PATCH`. GC removes orphans and duplicates (§7.9). | n/a |
| D18 | Triggers | Sync runs on:<br>• sign-in;<br>• start, when a token is valid;<br>• the app becoming visible, if the last sync was over 60 s ago;<br>• 5 s after a local change (30 s at most);<br>• every 5 min while visible;<br>• `online`;<br>• **Sync now**.<br>Backoff is exponential, and one tab syncs at a time (Web Lock). **First sync and Replace wait until no run is active.** | Background Sync: needs a token in the SW. |
| D19 | Delete on this device | "Delete all data" becomes **"Delete everything on this device"**. It writes raw, so Drive keeps its copy. **Remove my data from Drive** is separate and leaves an erase marker. | A tracked delete-all would erase every device. |
| D20 | Client ID and config | The ID is public. It is set at build time as `VITE_GOOGLE_CLIENT_ID` from the repo variable `GOOGLE_CLIENT_ID`, with a committed fallback in `config.ts`. Local development uses `.env.local`; `*.local` is gitignored from S0. | n/a |
| D21 | CSP, early | **A production meta CSP lands in S0, and the whole existing e2e suite runs under it** from then on. `oauth-return` is a **Vite multi-page entry**, so it is bundled and falls under the same CSP. The SW keeps ignoring cross-origin requests, and Drive calls use `cache: 'no-store'`. | Adding the CSP last (S6): late surprises. |
| D22 | Code location | The pure engine goes in **`src/core/sync`**, with allowed edges `contracts`, `experiment` and `store`. **No `money`** (fixes rev 1's inconsistency). Browser adapters go in `src/app/services/sync/`. | n/a |
| D23 | Sign-in gate | A small **"Test Google sign-in"** row in the Account card. S4 builds the row; S3 implements `testSignIn()`. It is shown only when a client ID is configured. **The owner checks three things on the Pixel, in Chrome and in the installed app, before wave 4 (S5a) starts:**<br>• the popup;<br>• the redirect round trip;<br>• **Reconnect after expiry** (a "Expire token now" button in the row forces it).<br>The row then calls `about.get`, lists the app folder and revokes. | Finding out in S6, after everything is built. |

---

## 2. Architecture

```
                 ┌──────────────────────────────── browser tab (one per device) ───────────────────────────────┐
  screens ──────►│ services/db.ts getRepo()/getBackend() ──► TrackedBackend ──► IDB Backend `spinner` v3        │
  (Define,       │                                  marks syncDirty in the same tx │ definitions … layouts       │
  Library, …)    │                                           │ onDirty ──► BroadcastChannel ──► lock holder     │
                 │                                           ▼                     │ syncIndex syncDirty syncMeta│
                 │ services/sync/service.ts ──► core/sync engine ── raw backend ───►└─────────────────────────────┘
                 │  triggers, Web Lock, backoff,    hlc · fingerprint · vv · resolve/merge · libfile · runs · gc
                 │  status store, downloads              │ RemoteStore
                 │        │ token                        ▼
                 │ services/sync/gis.ts  ◄── redirect ── oauth-return (Vite entry)   services/sync/drive.ts (fetch, no-store)
                 └────────┼──────────────────────────────────────────────────────────────────┼───────────────────────────┘
                          ▼ popup / redirect                                                  ▼ HTTPS Bearer (SW passes through)
              accounts.google.com                         googleapis.com/drive/v3 … appDataFolder
                                                          ├─ spinner-sync.json             root / erase marker
                                                          ├─ lib.<devA>.json.gz             A's merged state (A writes)
                                                          ├─ lib.<devB>.json.gz             B's merged state (B writes)
                                                          └─ run.<runId>.<digest16>.spinner.json.gz   done runs
```

Tests replace the bottom row with:

- `createMemoryRemote()` in node;
- a typed fake Drive handler (`tests/e2e/fakes/drive-server.ts`) behind Playwright `page.route`,
  shared by two browser contexts;
- a fake GIS script.

---

## 3. What exists today (findings)

### 3.1 Stores, ids and mutability

| Store | Key | Mutable content under the same id? | Unique across devices? |
|---|---|---|---|
| `definitions` | `id` = sha256(normalized), name included | **no**: `definition` is immutable. Only record metadata changes: `runIds`, `updatedAt`, and (PR #37) `displayName` and `displayNameAt` | **yes** |
| `strategies` | `id` = the strategy's own slug (`saveStrategy` keys by `s.id`) | **yes** (overwritten) | **no**: two devices can create the same slug |
| `layouts` | slug from `allocLayoutId(name)` | **yes** (`saveLayout`, rename) | **no** |
| `groups` | `newRunId(base.id)` (40 random bits) | **yes**: `runIds` (**ordered**) and name, written whole | yes |
| `runs` + 5 result stores | `runId` = def16 + 40 random bits | until `done`; `resultsDigest` exists **only for done** runs (`controller.ts` ~L586). Cancelled runs are not compacted and are terminal | yes (collision ≈ 2⁻⁴⁰) |
| `settings` | `key` | yes | n/a |

There is no record version or HLC today, and deletes leave no trace. All sync bookkeeping therefore
goes in new side stores.

### 3.2 Platform

- **No CSP** today. Pages cannot send headers, so it must be a meta tag.
- The **SW ignores cross-origin requests**.
- e2e uses `vite preview --base /spinner/ --port 4173`.
- **Measured bundle sizes:** a 10,000 × 500 run is **1.1–2.1 MB** gzipped. Large runs reach
  5–20 MB, which needs resumable upload.

### 3.3 Writers and readers

- **Every writer** goes through `services/db.ts → getBackend()`/`getRepo()`:
  - `Define/data.ts`, `services/layouts.ts`, `services/runs.ts` (sink);
  - `Sweep/sweep.ts`, `Import/*`, `Library/*`;
  - `Settings/benchmark.ts`, `settings.ts`, and `db.ts` itself.

  Wrapping the backend once tracks them all. `deleteAll` moves to the raw backend.
- **Every reader of `repo.listRuns()`** must also see remote-only runs (B4); S5b covers them:
  - `services/runs.ts` (`listRecentRuns` → Home);
  - `Sweep/sweep.ts:187` (reuse by `simKey`);
  - `Compare/index.tsx:45` (picker);
  - `Define/index.tsx:212` (compare sheet);
  - `Library/index.tsx:132`;
  - Analyze (`data.tsx`) and Watch (`deps.ts`), when they open a run.
- **Dry runs:** definitions tagged `DRY_RUN_TAG` (`'dry-run'`, in `services/runs.ts`). Define purges
  their runs on the next dry run. Settings → Benchmark uses the same tag.

---

## 4. Contracts (WP-S0 freezes these)

### 4.1 `src/core/contracts/sync.ts` (new; full text in `sync-prototype/contracts-sync.mts`)

```ts
export type DeviceId = string;                 // 10 chars Crockford base32
export type Hlc = string;                      // `<ms b36 ×9>.<ctr b36 ×4>.<deviceId>`; string order = HLC order
export type SyncKind = 'def' | 'strategy' | 'layout' | 'group' | 'setting' | 'run';
export type SyncKey = `${SyncKind}:${string}`;
export const SYNCED_SETTING_KEYS = ['framing', 'pace'] as const;

export interface SyncEntry<K extends SyncKind = SyncKind> {
  key: SyncKey; kind: K; id: string;
  hlc: Hlc;                        // minted from the edit time (syncDirty.last)
  basis: Hlc | null;               // parent: the entry this was edited from; null = created fresh
  vv: Record<DeviceId, number>;    // per-key version vector; vv[self] = a fresh value of syncMeta.vvCounter
  hash: string;                    // fingerprint (§7.2); '' for a tombstone
  deleted?: true;
  v: number;                       // record schema; newer than known → kept opaquely
  value: SyncValueByKind[K] | null;
}

export interface RunStub {
  runId; definitionId; simKey; runKey;              // simKey/runKey: Sweep and "already ran" matching
  status: RunStatus; interrupted?: boolean; error?: { code; message };
  sessions; completedSessions; prefixSessions; createdAt; finishedAt?;
  appVersion; gameId; gameVersion; coreVersion; resultsDigest?;          // digest: done only
  verdict?: { meanNet; halfWidth; pAhead; pBust; n; roundsPerSession; roundsPerHour };
  owner?: DeviceId;                                 // absent = shared imported run (B6)
  extra: { device; timing; resumes; imported?: { …; [k: string]: unknown } };   // unknown keys kept (trimInfo)
  bundle?: { name: string; bytes: number; sha256: string };                    // done only
}
// No `name`: lists resolve the name live through the definition record (`experimentName()`, PR #37).

export interface LibFileV1 { format: 'spinner-sync-lib'; version: 1;
  device: { id; name; appVersion; coreVersion }; hlc: Hlc; writtenAt: string; entries: SyncEntry[] }
export interface SyncRootV1 { format: 'spinner-sync'; version: 1; createdAt; createdBy: DeviceId;
  erased?: { at: string; by: DeviceId } }

export interface RemoteFile { id; name; bytes; version; md5?; modifiedTime; appProperties }
export class RemoteError extends Error { code: 'auth'|'forbidden'|'rate'|'quota'|'not-found'|'server'|'network'|'bad-response'; status; retryAfterMs? }
export interface RemoteStore { readonly kind: 'drive'|'memory';
  list(); download(id, o?); create(name, bytes, o?: { appProperties?, contentType?, resumeKey?, onProgress?, signal? });
  update(id, bytes, o?); delete(id); about() }
export const RESUMABLE_THRESHOLD = 5 * 1024 * 1024, RESUMABLE_CHUNK = 8 * 1024 * 1024;

export type AuthState = { state: 'unconfigured' } | { state: 'signed-out' }
  | { state: 'signed-in'; email; expiresAt } | { state: 'expired'; email }
  | { state: 'redirecting' };
export interface TokenSource { current(): string | null;
  acquire(o: { silent: boolean; mode?: 'auto' | 'popup' | 'redirect' }): Promise<string>;  // user gesture only
  revoke(): Promise<void>; subscribe(fn): () => void; readonly state: AuthState }

export type SyncState = 'off'|'idle'|'syncing'|'needs-auth'|'offline'|'backoff'|'drive-full'|'error'|'local-full'|'waiting-run';
export interface SyncStatus { state; email?; lastSyncedAt?; pending: number; remoteOnly: { runs; bytes };
  progress?; retryAt?; error?; conflicts: number }
export interface ConflictNotice { id; at; key; kind; message; copyId?; read: boolean }
export interface SyncDevicePrefs { enabled: boolean; deviceName: string; runDownload: 'all' | 'onOpen' }
```

Changes to existing contracts (all additive):

- `RunMeta.synced?: { from: DeviceId; fromName: string; at: string }`.
- `core/store/bundle.ts` (not a contract file, but a frozen signature):
  `encodeRunBundle(data, opts): Promise<Uint8Array>` gets a sibling that exposes the digest it
  already computes (`buildRunBundle` takes `meta.resultsDigest ?? resultsDigest(data)`):
  `encodeRunBundleWithDigest(data, opts): Promise<{ bytes: Uint8Array; resultsDigest: string }>`.
- **No `CORE_VERSION` bump.**

### 4.2 Store v3 (`src/core/store/backend.ts`)

```ts
export const V2_STORE_NAMES = [...V1_STORE_NAMES, 'layouts'] as const;            // FROZEN
export const STORE_NAMES = [...V2_STORE_NAMES, 'syncIndex', 'syncDirty', 'syncMeta'] as const;
export const DB_VERSION = 3;
STORE_DEFS.syncIndex = { keyPath: 'key', indexes: { byKind: 'kind' } };
STORE_DEFS.syncDirty = { keyPath: 'key', indexes: {} };
STORE_DEFS.syncMeta  = { keyPath: 'k',   indexes: {} };
DB_UPGRADES[3] = (db) => createStores(db, ['syncIndex', 'syncDirty', 'syncMeta']);
export const SYNCED_STORES: Partial<Record<StoreName, SyncKind>> = { definitions: 'def', strategies: 'strategy',
  layouts: 'layout', groups: 'group', settings: 'setting', runs: 'run', runParts: 'run', summaries: 'run',
  checkpoints: 'run', breakdowns: 'run', samples: 'run' };

interface SyncIndexRecord { key: SyncKey; kind: SyncKind;
  entry: SyncEntry;   // the fold winner, published as-is (never re-stamped)
  seen: Record<DeviceId, number>;   // join of every vv folded for this key: basis of the next local edit; local only
  local: 0 | 1 }
interface SyncDirtyRecord { key: SyncKey; last: number /* latest edit time */; n: string /* nonce */ }
interface SyncMetaRecord { k: string; v: unknown }
// syncMeta keys: device · prefs · account {accountId,email,boundAt} · clock · seen {fileId: version}
//   · files {root?, ownLib?} · uploads {resumeKey: uri} · last · conflicts (≤50) · gcAt · libSha · copies
//   · vvCounter (N1: monotone, never reset by any reset path; only a new device id starts over)
```

- The tracker writes `{ key, last: Date.now(), n: random }` on every tracked write.
- The minted HLC uses `last`, so LWW follows the latest edit of the record.
- "Pending since" for the UI is the minimum `last` over all marks.

**An atomic read-modify-write on `Backend` (B2)**:

```ts
export interface TxReader { get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> }
export interface Backend { /* …existing… */
  /** One readwrite transaction; `fn` may await only `r.get` on this transaction, then queue writes on `w`. */
  update(stores: StoreName[], fn: (r: TxReader, w: TxOps) => Promise<void>): Promise<void>;
}
```

WP-S0 owns `update` on **both** backends:

- the memory implementation, in full;
- the IDB implementation: real if it fits, otherwise a stub that rejects with `not implemented`,
  which S1 completes;
- the `strictBackend()` helper in `tests/app/shell.test.tsx` (it adds `update`), so typecheck passes
  after S0.

### 4.3 Change tracking (`src/core/store/tracking.ts`)

```ts
export interface TrackedBackend extends Backend { readonly raw: Backend; onDirty(fn: (keys: SyncKey[]) => void): () => void }
/** Adds 'syncDirty' to readwrite tx/update touching SYNCED_STORES and puts a mark per put/delete:
 *  runParts [runId,n]/summaries/… → run:<runId>; settings → only SYNCED_SETTING_KEYS. Aborted tx → no mark. */
export function createTrackedBackend(inner: Backend): TrackedBackend;
export function evictRunResults(raw: Backend, runId: string): Promise<void>;  // keeps definitions.runIds
```

### 4.4 `src/core/sync` (WP-S0 writes stubs with these frozen signatures)

```ts
// hlc.ts
export function createClock(device: DeviceId, now: () => number, last?: Hlc): {
  tickAt(editMs: number): Hlc; recv(remote: Hlc): void; readonly last: Hlc };
export function hlcDevice(h: Hlc): DeviceId; export function hlcWall(h: Hlc): number; export function cmpHlc(a: Hlc, b: Hlc): number;
// fingerprint.ts
export function fingerprintValue(kind: SyncKind, value: unknown): Json;          // §7.2
export function entryOf<K extends SyncKind>(kind: K, id: string, value: SyncValueByKind[K] | null,
  hlc: Hlc, base: SyncEntry | undefined, self: DeviceId): Promise<SyncEntry<K>>;  // basis = base?.hlc, vv = base.vv + self
export function verifyEntry(e: SyncEntry): Promise<'ok'|'bad-hash'|'bad-id'|'unknown-kind'|'newer'>;
export const SUPPORTED_V: Record<SyncKind, number>;
// vv.ts
export function descends(a: SyncEntry, b: SyncEntry): boolean;                    // vv(a) ≥ vv(b)
export function concurrent(a: SyncEntry, b: SyncEntry): boolean;
// merge.ts
export interface Folded { winner: SyncEntry; losers: SyncEntry[]; seen: Record<DeviceId, number> }
/** Order-independent fold of every entry known for one key (§7.4). Never mutates an input entry. */
export function foldEntries(all: readonly SyncEntry[], deletedRuns: ReadonlySet<string>): Folded;
export function equivalent(a: SyncEntry, b: SyncEntry): boolean;                 // same hash and deleted flag
export function joinDef(maximal: readonly SyncEntry<'def'>[], deletedRuns: ReadonlySet<string>): SyncEntry<'def'>;
export function copyOf(loser: SyncEntry, deviceName: string, taken: ReadonlySet<string>): Promise<SyncEntry | null>;
export type Resolution = { do: 'skip-older' } | { do: 'apply'; entry: SyncEntry } | { do: 'keep-local' }
  | { do: 'join'; entry: SyncEntry } | { do: 'opaque'; reason: string };
/** foldEntries over remote ∪ {base} ∪ {local candidate}, mapped to an action; losers → copies. */
export function resolve(remote: readonly SyncEntry[], base: SyncIndexRecord | undefined,
  localCandidate: SyncEntry | undefined, deletedRuns: ReadonlySet<string>): { res: Resolution; losers: SyncEntry[]; seen: Record<DeviceId, number> };
// libfile.ts
export function encodeLib(f: LibFileV1): Promise<Uint8Array>; export function decodeLib(b: Uint8Array): Promise<LibFileV1>;
export const LIB_NAME: (d: DeviceId) => string; export const ROOT_NAME = 'spinner-sync.json';
export const runBundleName: (runId: string, digest: string) => string;          // run.<runId>.<digest16>.spinner.json.gz
// engine.ts (S2b), runs.ts / gc.ts / first.ts / erase.ts (S2c)
export interface SyncEngineDeps { backend: TrackedBackend; remote: RemoteStore; now: () => number;
  appVersion; coreVersion; gameId; deviceName: () => string;
  describeRun(meta: RunMeta): Promise<RunStub['verdict'] | undefined>;
  isDryRun(def: DefinitionRecord): boolean;              // DRY_RUN_TAG
  isRunActive(runId?: string): boolean;                  // no arg: any run active in this tab
  onProgress(p): void; signal?: AbortSignal }
export interface SyncEngine {
  preview(): Promise<FirstSyncPreview>; begin(c: 'merge' | 'replace'): Promise<CycleResult>;
  cycle(o?: { uploadRuns?: boolean; timeBudgetMs?: number }): Promise<CycleResult>;
  downloadRun(runId, o?): Promise<'ok' | 'missing' | 'corrupt'>; remoteRuns(): Promise<RunStub[]>;
  evict(runId): Promise<void>; eraseRemote(): Promise<void>; resetLocalSyncState(): Promise<void> }
export function createSyncEngine(d: SyncEngineDeps): SyncEngine;
export function createMemoryRemote(o?: { fault?: (op: string, name?: string) => RemoteError | undefined;
  /** awaited before every remote call: the fuzz interleaves other devices here (§11.1) */ hook?: (op: string) => Promise<void> }): RemoteStore;
```

### 4.5 App service (`src/app/services/sync/index.ts`, an inert stub from WP-S0)

```ts
export const syncStatus: Store<SyncStatus>, syncAuth: Store<AuthState>, conflictNotices: Store<ConflictNotice[]>,
  syncPrefs: Store<SyncDevicePrefs>, firstSyncPrompt: Store<FirstSyncPreview | null>;
export function signIn(): Promise<void>;  export function reconnect(): Promise<void>;   // click handlers only
export function syncNow(): Promise<void>; export function chooseFirstSync(c: 'merge'|'replace'|'cancel'): Promise<void>;
export function signOut(): Promise<void>; export function removeDriveData(): Promise<void>;
export function setPrefs(p: Partial<SyncDevicePrefs>): Promise<void>;
export function remoteRun(runId: string): Promise<RunStub | null>;
export function downloadRun(runId, onProgress?, signal?): Promise<'ok'|'missing'|'corrupt'|'offline'|'needs-auth'>;
export function evictRun(runId: string): Promise<void>; export function markConflictsRead(): void;
export function testSignIn(): Promise<{ email: string; files: number }>;               // D23 gate (S3 implements)
// config.ts
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID || COMMITTED_CLIENT_ID;  // '' = unconfigured
```

**A run-row type for every list and picker** (S5b; B4):

```ts
// services/runs.ts
export type RunRow = Pick<RunMeta, 'runId'|'definitionId'|'simKey'|'runKey'|'status'|'createdAt'|'sessions'
  |'completedSessions'|'prefixSessions'|'gameVersion'|'coreVersion'|'resultsDigest'>
  & { remote?: { bytes: number; owner?: DeviceId; ownerName?: string } };
export function listRunRows(): Promise<RunRow[]>;   // local RunMeta ∪ remote-only stubs, newest first, dry runs excluded
```

---

## 5. Auth

### 5.1 Choosing the flow (`acquire({ silent, mode: 'auto' })`)

```
standalone = matchMedia('(display-mode: standalone)').matches
android    = /Android/i.test(navigator.userAgent)
if mode=='redirect' || (mode=='auto' && standalone && android) → redirect flow (§5.4)
else popup flow (§5.2); on AuthError 'popup-blocked' | 'timeout' (120 s) | 2× 'popup-closed' → offer redirect
     (the Account card switches its button to "Sign in in this window")
redirect is refused while a run is active ("Finish or pause the run first"): the navigation would pause it
```

### 5.2 Popup (GIS token client)

1. When the Account card renders, `loadGis()` preloads the script (not awaited).
2. On tap, call `requestAccessToken({ prompt: silent ? '' : 'select_account', login_hint })`
   synchronously inside the click.
3. The callback returns `{ access_token, expires_in: 3599, scope }`.
4. Check `hasGrantedAllScopes(drive.appdata)`.
5. Call `about.get` for the email and `permissionId`.
6. Store `{ token, expiresAt, email }` in memory and in `localStorage['spinner:sync:token']`.
7. Then account binding (§7.10), then the first-sync preview (§8.3).

Notes on this flow:

- **There is no refresh token in this model.** `current()` treats a token as expired 2 minutes
  early.
- **Silent re-acquire** (`prompt: ''`) skips the chooser and consent. It still flashes a popup and
  needs a user gesture.
- **When the token expires:**
  - With **pending changes**, the indicator turns amber and says "Reconnect".
  - With **nothing pending**, the indicator is muted ("☁ Paused") with no nag; the Account card
    still offers Reconnect.
  - Sync now, opening a remote run and Download all each reconnect first, since they are gestures
    too.
- **Expiry mid-sync:** every step is idempotent.
  - A 401 aborts the cycle; nothing is committed for an unfinished step.
  - Resumable sessions survive in `syncMeta.uploads`.
  - A cycle that starts with less than 10 min of token left skips bundle uploads
    (`uploadRuns: false`).
- **Several tabs** share the token through localStorage; a `storage` event updates the other tabs.

### 5.3 Drive client

The prototype's `drive.mts` stands as designed:

- list with paging;
- multipart upload up to 5 MB;
- resumable upload above 5 MB: 8 MiB chunks, resume with `bytes */N`, restart on 404 or 410;
- media `PATCH`, `alt=media` download, delete (404 counts as success), `about`;
- `cache: 'no-store'`;
- the error mapping.

TS 6 needs request bodies typed `Uint8Array<ArrayBuffer>` (the prototype's `asBody`).

### 5.4 Redirect

1. Generate a `state` of 128 random bits. Store `{ state, returnTo, at }` in **localStorage**
   `spinner:sync:oauth`, so it survives a Custom Tab or new-window hop (TTL 10 min).
2. Navigate:
   `location.assign('https://accounts.google.com/o/oauth2/v2/auth?client_id&redirect_uri=<origin><base>oauth-return.html&response_type=token&scope=…drive.appdata&include_granted_scopes=true&state&login_hint&prompt=<''|select_account>')`.
3. `oauth-return.html` is a **Vite multi-page entry** (`build.rollupOptions.input`, with
   `src/oauth/return.ts`). It is bundled with no inline script, so the CSP covers it. In order, it:
   1. parses `#access_token&expires_in&state&scope&error`;
   2. checks `state` against localStorage and the TTL, then deletes the record;
   3. checks the scope;
   4. stores the token as in §5.2;
   5. posts `{ type: 'token' }` on `BroadcastChannel('spinner-sync')`, for when the app window is
      still open behind the hop;
   6. scrubs the fragment (`history.replaceState`);
   7. calls `location.replace(returnTo || './#/settings?account=1')`.

   On a mismatch or an error it shows a plain page with a "Back to spinner" link.
4. Google documents the implicit grant for browser apps, but OAuth 2.1 discourages it; it is
   accepted per D1. If Google retires it, desktop keeps the popup. Android would then need GIS
   popups in standalone mode, which is risk R1 and what the gate tests.

### 5.5 Sign-out, storage, CSP, SW

- **Sign out:**
  1. Revoke the token.
  2. Clear the token, the email hint and the OAuth state from localStorage.
  3. Set `prefs.enabled = false`.

  **Local data and `syncIndex` are kept.**
- **Stored in the browser:**
  - localStorage: the token and its expiry (about 1 h), the email hint, the in-flight redirect
    state;
  - IndexedDB `syncMeta`: everything else. Resumable session URIs in it are useless without a
    token.
  - Nothing in the repo is secret.
- **CSP**, from WP-S0's `build/vite-plugin-csp.ts`. It applies to production builds and to both
  HTML entries:

```
default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client;
connect-src 'self' https://www.googleapis.com https://accounts.google.com/gsi/ https://oauth2.googleapis.com;
frame-src https://accounts.google.com/gsi/; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style;
img-src 'self' data: blob:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'
```

  - The redirect is a top-level navigation, so it needs no CSP directive.
  - `frame-ancestors` cannot be set in a meta tag.
  - **From S0 on, every existing e2e spec runs against the CSP build** and fails on any
    `securitypolicyviolation`.
- **SW:** cross-origin requests already pass through, and S0 adds a test for that.
  `oauth-return.html` is precached like the rest of `dist`.

---

## 6. Data model on Drive

```
appDataFolder/
  spinner-sync.json                     SyncRootV1 (~150 B). version > 1 → refuse ("update the app"); erased → others stop.
  lib.<deviceId>.json.gz                LibFileV1 → canonical JSON → gzip. appProperties { kind:'lib', device }.
                                          Typical 50–500 kB gz; 1,000 defs + 2,000 stubs ≈ 1 MB gz.
  run.<runId>.<digest16>.spinner.json.gz
                                        encodeRunBundleWithDigest(data, { gzip: true }).bytes — the Export format.
                                          appProperties { kind:'run', runId, digest16 } (each pair ≤ 124 B).
                                          Done runs only. 1–2 MB typical, ≤ ~20 MB → resumable above 5 MB.
```

- **Throttling:** a write token bucket (3 per second, burst 5); reads at most 4 in parallel; uploads
  one at a time.
- **Rate errors:** back off `min(2ⁿ s + U(0,1) s, 64 s)`, at most 5 tries per request, then the
  cycle goes to `backoff`.

---

## 7. Sync algorithm

### 7.1 Clock (HLC, minted from the edit time)

```
tickAt(at): w = max(at, last.w); c = (w == last.w) ? last.c + 1 : 0; last = (w, c); return enc(w, c, self)
recv(h):    last = max(last, (h.w, h.c))        // keeps later local edits ahead of anything already seen
```

- A push mints `tickAt(dirty.last)`, so a record edited at 10:00 and pushed at 10:20 sorts as 10:00.
- **Our own entries are ordered, not concurrent.** An entry whose HLC device is this device is an
  ancestor of anything we minted later. `vv[self]` makes this automatic, and the engine asserts it.
- **Clock skew:** a remote wall time more than 24 h ahead of `now()` is accepted, and the Account
  card says "A device's clock looks wrong (Laptop)".

### 7.2 Fingerprints per type (should-fix 3)

`hash = sha256Hex(canonicalJson(fingerprintValue(kind, value)))`. Volatile fields are left out;
**every unknown key stays in**, for forward compatibility.

| Kind | Fingerprint value |
|---|---|
| def | the record **minus `updatedAt`**, with `runIds` sorted |
| strategy | the record minus `updatedAt`: `strategy`, `hash`, `createdAt`, `derivedFrom` |
| layout | the record minus `updatedAt` |
| group | the record minus `updatedAt`; `runIds` order **kept** (it has meaning) |
| setting | `{ key, value }` |
| run | the stub **minus `verdict`** (derived) and minus `extra.imported.importedAt` (differs per device for shared runs) |

When a re-save leaves the fingerprint and the deleted flag equal to `syncIndex[key].entry`, the mark
is dropped and nothing is pushed.

### 7.3 One cycle

```
cycle({ uploadRuns = true, timeBudgetMs = 120_000 }):
  lock 'spinner:sync' (ifAvailable) else return 'busy' ; token? else needs-auth
  files ← list() ; checkRoot(files)                                  (§7.10: newer layout → error; erased → off)
  if ownLib missing && syncIndex non-empty && !firstSync → reseed()  (§7.9 step 6)
  PULL+APPLY(files)                                                   ── below
  if uploadRuns && !isRunActive(): uploadPendingRuns(deadline)        (§7.6; bundles before lib)
  SNAPSHOT: for d in syncDirty: s ← snapshot(d) → pending[d.key]       (tickAt(d.last); basis/vv from the base)
  RECHECK (B1 window): files' ← list() ; if any peer lib version changed since PULL → PULL+APPLY(files') again,
                       then re-run resolve for every pending key against the new base (a pending key whose
                       remote moved is re-snapshotted; concurrency → copies, as in APPLY)
  lib ← syncIndex entries ⊕ pending, sorted ; bytes ← encodeLib(lib)
  unless sha256(bytes) == libSha → ownLib ? update(ownLib.id, bytes) : create(LIB_NAME(self), bytes)
  commit (raw.update): syncIndex ← pending ; delete syncDirty[k] iff its nonce n is unchanged ; libSha, seen, clock, last
  if prefs.runDownload == 'all': download remote-only runs, newest first, until deadline
  GC if gcAt older than 24 h (§7.9) ; emit status

PULL+APPLY(files):
  remote ← for each lib whose version ≠ seen[id] (≤4 parallel): decodeLib; verifyEntry each (bad → notice, skip)
           grouped per key: remote[key] = every entry from every lib file (a SET; no pairwise folding)
  deletedRuns ← run tombstones in remote ∪ syncIndex
  for each key in order (def, strategy, layout, group, setting, run):
     raw.update([...], async (r, w) => {
        base ← syncIndex[key]; dirty ← r.get('syncDirty', key)
        local ← dirty ? candidate(key) : undefined     (vv = base.seen + { self: ++vvCounter }, hlc from dirty.last)
        { res, losers, seen } ← resolve(remote[key], base, local, deletedRuns)
        apply res:  skip-older | apply (write value / delete; syncIndex ← { entry, seen }; drop the mark if the local edit lost)
                    | keep-local (syncIndex ← remote, so the next push descends from it; the mark stays)
                    | join (def: write the joined record; syncIndex ← joined entry; the mark stays if local ≠ joined)
                    | opaque (syncIndex ← entry, local 0; never dropped)
        for l in losers: c ← copyOf(l, deviceNameOf(l), taken)  (null when the copy id is in
              syncMeta.copies or syncIndex, live or tombstone) ; write c's record + a syncDirty mark ; notice
     })
  seen[f.id] ← f.version for fully applied files
```

**First sync** (`begin`) **waits until no run is active**, in state `waiting-run` ("Waiting for the
run to finish"). Then:

- **Merge:**
  1. Seed a mark for every record in the synced stores (raw writes).
  2. Run `cycle()`. With no base, an identical fingerprint is a no-op. Different content is
     concurrent: definitions join; every other kind gets a copy.
- **Replace:** raw-delete every record in the synced stores, run `resetLocalSyncState()`, then run
  `cycle()`.

### 7.4 Concurrency and resolution (B1, N1–N3)

For each key, the engine folds the **set** `S` = every entry from every lib file, plus our base
entry, plus (when the record is dirty) our **local candidate**. The candidate has
`basis = base.entry.hlc`, `vv = base.seen + { self: ++vvCounter }`, and an HLC from its edit time.

```
foldEntries(S):
  1. classes ← group S by (hash, deleted)                         (N3: equivalence)
     rep(class) ← its lowest-HLC entry with vv = join(class vvs)   (identical content only)
  2. maximal ← reps not strictly dominated (vv) by another rep     (N2: no pairwise mutation)
  3. kind 'def': winner ← joinDef(maximal)  (live beats deleted; deterministic join; §7.5); losers ← []
     otherwise:  winner ← max(maximal) by (live over deleted, then higher HLC)
                 losers ← maximal \ {winner}, live only, sorted by HLC
                 kind 'setting' | 'run': losers ← []   (plain LWW; no copies, no notice)
  4. seen ← join(vv of every entry in S except the candidate) ∪ base.seen
```

Mapping the fold to an action:

| Fold result | Action |
|---|---|
| `winner` is the base entry, and there is no candidate | `skip-older`; `seen` is updated |
| `winner` is the candidate (it dominates everything, or wins among the maximal) and no published entry is equivalent to it | `keep-local`: the mark stays, and the push mints from `seen`, so the new entry descends from everything folded |
| `winner` is equivalent to the candidate and also published | `apply` that published entry and drop the mark: our edit already exists |
| any other winner | `apply` it. The candidate, when live and not equivalent to the winner, is among the losers, so it becomes a copy |
| `v > SUPPORTED_V`, or an unknown kind | `opaque` |

Properties:

- **Order independence (N2):** the fold is a function of the set; a test permutes every read order.
- **No lost update (B1):**
  - Both devices push before either pulls: both entries are maximal, so one wins and the other is
    copied.
  - A local edit after a reset: `vvCounter` is monotone, so the new candidate dominates all of our
    own older entries (N1).
- **No copy of a copy (N3):** two devices that both create the same conflicted copy produce
  equivalent entries, which collapse into one with no loser.
- **The winner is published as-is.** `seen` stays local, so no device publishes ancestry it does not
  have.

The prototype's `model.test.mts` checks all of this:

- the exact race where both devices push before either pulls;
- a chain A → C → D, which must not count as a conflict;
- an edit beating a delete;
- **N1** (3 edits, the lib file is lost, reset, edit: the edit survives);
- **N2** (every permutation of 3- and 4-entry sets gives one result);
- **N3** (three devices all create the same copy: one copy, no "(a) (a)");
- a fuzz: 3 devices, 400 steps, losing the own lib file and Replace included. It asserts
  convergence, that no edit is lost, that copies exist only of base ids, and that each content is
  copied at most once.

**The conflicted copy is deterministic**, so any device produces the same one:

- **id:** `copyId = slugBase(id, 33) + '-' + loser.hash.slice(0, 6)`.
  - A strategy copy sets `strategy.id = copyId` and recomputes `hash`.
  - A layout copy sets `layout.id = copyId`; `layoutHash` is unchanged.
  - A group copy takes `copyId` as its id.
- **name:** `"<name> (<device name of hlcDevice(loser.hlc)>)"`, trimmed to 80 characters.
- **entry:** a new key with `basis: null`, `vv: { self: ++vvCounter }`, and an HLC from the loser's
  edit time.
- **Two devices may both create the copy.** Their content (id, name, value) is identical, so the
  entries are **equivalent** and collapse in the fold with no loser (N3).
  - The name uses the device of the loser's class representative (its lowest HLC), so every device
    that sees the same set names it the same.
  - Re-seed never re-mints unchanged records (§7.9 step 6). Equivalence classes therefore span
    devices only for genuinely identical edits.
  - In the worst case (an account switch re-minting old content), a second, differently named copy
    can appear. Nothing is ever lost.
- **A known copy id is never recreated.** If the id is already in `syncMeta.copies` or `syncIndex`
  (even as a tombstone), no copy is made, so a deleted copy stays deleted.
- **Notice:** `“Big Martingale” was changed on two devices. Both are kept: “Big Martingale (Pixel)”.`
- **Stages are safe.** They hold their own `x-chips` copy of the layout, so nothing dangles.
  `from.id` keeps pointing at the winner, the same Update / Keep model as today.

### 7.5 Rules per kind

| Kind | Concurrent edits | Edit vs delete | Validation on apply |
|---|---|---|---|
| **def** | **join**, never a copy:<br>• `runIds` = sorted union minus `deletedRuns`;<br>• `displayName`/`displayNameAt` from the entry with the later `displayNameAt`, **ties broken by the higher entry HLC** (a missing `displayName` with a later `displayNameAt` is a rename-back);<br>• `createdAt` min, `updatedAt` max;<br>• `origin`/`derivedFrom` from the earlier `createdAt`;<br>• unknown keys: the union, taking the winner-by-HLC's value on a clash.<br>The join runs over the **maximal** entries of the fold, so a later delete that descends from everything still wins. The joined entry has `hlc = max`, `vv = join(maximal)`, and **no new mint**, so it is identical on every device that folds the same set.<br>**Dangling ids:** `runIds` may name a run that is neither local nor a stub (it is still uploading, or was GC'd). Display and the Library count filter `runIds` against local runs ∪ remote stubs (S5b). | the edit wins (the join of live and deleted is the live record) | `definitionId(rec.definition) === id`; else opaque, with a notice |
| **strategy** | winner by HLC; the loser becomes a copy | the edit wins | `hash === sha256(canonicalJson(strategy))` and `rec.id === strategy.id` |
| **layout** | winner by HLC; the loser becomes a copy | the edit wins | `hash === layoutHash(layout)`; built-in ids refused |
| **group** | **whole-record LWW** (never a union); the loser becomes a copy "Sweep … (Pixel)" | the edit wins | shape check; `runIds` keeps its order |
| **setting** | LWW, no notice | n/a | key ∈ `SYNCED_SETTING_KEYS`; passed through `sanitizeSettings` |
| **run** | owner-only, or shared imported runs with the same digest: LWW, no notice. The same runId with a **different digest** (a 2⁻⁴⁰ collision or a hand-edited import): the local run is re-keyed by `importRun`'s rule, with a notice | the delete wins, unless `isRunActive(runId)`: then the run is kept and re-pushed, with a notice. A re-import after a delete descends from the tombstone and lives | §7.6 |

### 7.6 Runs (B3, B6)

**What a device pushes, by local status:**

| Local status | Entry | Bundle |
|---|---|---|
| `queued`, `running` | none (the next flush marks the run again) | none |
| `paused` (including `interrupted`), `cancelled`, `error` | stub: status, counts, `interrupted`, `error` | **none**. Other devices list "Paused on Laptop · 43%", "Cancelled on Laptop at 2,048 of 10,000" or "Error on Laptop", greyed and not openable |
| `done` | stub with `resultsDigest` and `bundle` | the full bundle |

**Never pushed:**

- runs of a `DRY_RUN_TAG` definition (Define's dry runs and Settings → Benchmark), and the
  definition itself;
- marks for purged dry runs: the key was never synced, so the mark is just dropped.

`snapshot()` returns `null` for all of these.

**Ownership:**

- A run created on this device has `owner = self`. **A run that arrived by download keeps
  `owner = meta.synced.from`.** The downloader never rewrites it as its own; it only pushes a
  tombstone if the user deletes it.
- A run that entered through `importRun` (it has `meta.imported`) has **no owner**. Two devices
  importing the same file produce entries with the same runId and digest. Their fingerprints match
  (`importedAt` is excluded), so they never conflict, and LWW picks one stub.

**Upload** (`uploadPendingRuns`: newest first, one at a time, only while no run is active):

```
skip if remote has an entry run:<runId> with the same resultsDigest and a bundle → reuse that stub's bundle ref
{ bytes, resultsDigest } ← encodeRunBundleWithDigest(loadRun(raw, runId), { gzip: true })
name ← runBundleName(runId, resultsDigest)
existing ← listing has `name` with appProperties { runId, digest16 }
         → take the ref from the remote stub that names it, or download it once to compute its sha256
         : create(name, bytes, { resumeKey: 'run:' + runId, appProperties }) and use sha256Hex(bytes)
stub.bundle ← { name, bytes, sha256 }      (always describing THE FILE WE REFERENCE)
write our lib file every 30 s while uploading, so peers see runs appear progressively
```

**Download** (`downloadRun`, done runs only):

1. **Find the file.** Take the listed files named `stub.bundle.name`. If there are several (two
   devices uploaded at once), try each until the sha256 matches. If none is listed, return
   `missing`.
2. **Check the file:** `sha256Hex(bytes) === stub.bundle.sha256`, else `corrupt`.
3. **Decode:** `decodeRunBundle(bytes, gameId)`. For untrimmed bundles this recomputes
   `resultsDigest`.
4. **Check the digest:** `data.meta.resultsDigest === stub.resultsDigest`, else `corrupt`.
5. **Check space:** `estimate().quota − usage ≥ 3 × bytes`, else `local-full`.
6. **Write:** rebuild `RunMeta` (table below), call `writeCompacted(raw, { ...data, meta }, meta, origin)`
   in **one transaction**, then set `syncIndex.local = 1`.

> **Trimmed bundles** (runs imported from a gallery-trimmed file) cannot have their digest recomputed
> (harness-data-analysis.md §10.1). For them, verification is the file sha256 plus equality of the
> declared digest. Analyze keeps showing "trimmed: verified at export".

**`RunMeta` rebuilt from the decoded bundle and the stub** (done runs only):

| Field | Source |
|---|---|
| `v`, `runId`, `definitionId`, `simKey`, `runKey`, `gameId`, `gameVersion`, `coreVersion`, `appVersion`, `createdAt`, `sessions`, `chunkSize`, `chunks`, `schedule`, `labels`, `columns`, `resultsDigest` | decoded bundle |
| `status` | `'done'` |
| `completedSessions`, `prefixSessions` | decoded: equal to `sessions`, or to the bundle's sessions for an imported partial |
| `bitmap` | decoded: every chunk set; an imported partial keeps the decoder's prefix bitmap |
| `interrupted` | absent (meaningless for a done run) |
| `error` | absent (done runs have none, and errored runs are never bundled) |
| `storage` | set by `writeCompacted` from `backend.kind` (`'idb'`) |
| `device`, `timing`, `resumes` | `stub.extra` (the maker's values: "made on a Pixel, 6 workers, 4.0 s") |
| `visibility` | `[]`: the maker's tab log is not synced |
| `imported` | `stub.extra.imported` **verbatim**, unknown keys such as `trimInfo` included, when the run was an import; otherwise **absent**. The decoder's own `imported` is discarded |
| `synced` | `{ from: stub.owner ?? hlcDevice(entry.hlc), fromName, at: now }` |

A stub-only run (paused, cancelled or errored) exists as a full `RunMeta` only on its owner's
device. Other devices never build a `RunMeta` for it; they show the stub row.

### 7.7 Ids and collisions

- **def:** content-addressed, so no collisions.
- **run, group:** random ids, collision ≈ 2⁻⁴⁰. Runs are handled as in §7.5.
- **strategy, layout:** user slugs. The same new slug on two devices, with no base, is concurrent:
  both `vv` are `{dev: 1}`. That gives a deterministic copy.
- **setting:** fixed keys.

Copy ids are checked against the local stores and the incoming remote keys. When the deterministic
id is already taken by unrelated content, the next 6 hex digits of the fingerprint are appended, so
the result is still deterministic.

### 7.8 Never corrupt local data

- **Pulls never write partial records.** Each key goes through one `update()` transaction. Each run
  goes through one `writeCompacted` transaction, after full verification.
- **The engine writes raw.** Marks therefore come only from user writes.
- **Ids and digests are kept.** Definitions keep id = hash, and runs keep their digests.
- **Bundles are re-verified on every download**, never trusted.

### 7.9 GC (once per 24 h per device, after a successful push)

1. **Duplicates:**
   - several `lib.<self>` files: merge them all, keep `files.ownLib`, delete the rest;
   - several roots: keep the earliest;
   - several files with one bundle name: keep the one whose sha256 matches the winning stub, and
     delete the others once they are more than 1 h old.
2. **Stale devices:** delete a lib file whose `writtenAt` is more than 180 days old. Its entries are
   already in everyone's merged state. If that device ever returns, it re-seeds (step 6).
3. **Tombstones (age + acknowledgement).** Drop tombstone *T* (key *k*) from our lib file only when
   both conditions hold:
   - *T* is **older than 30 days** (`hlcWall`);
   - **every** other remaining lib file **acknowledges** *T*, in one of three ways:
     - it holds *T* or an entry that descends from it;
     - it **has no entry for *k* at all, and its `writtenAt` is later than *T*'s wall time**.
       Every lib file is a device's whole merged state, so a device that wrote after *T* existed
       and lacks *k* must already have dropped *T* itself.

   The second form removes the "mutual waiting" leak: once one device drops *T*, the others still
   see it acknowledged. Step 2 runs first, so no stale lib file remains that could resurrect *k*.
   An imperfect drop is still harmless: in the worst case a tombstone of about 200 B stays in a lib
   file forever.
4. **Orphan bundles:** delete `run.*` files that no live run entry in any lib file references (by
   runId + digest16), once they are more than 1 h old. **The keep rule:** a bundle stays while any
   lib file (ours or a peer's) holds a live `run:<runId>` entry with that digest. This covers shared
   imported runs.
5. **Re-upload (consistent with §7.6 and §9).**
   - **Who:** any device holding a done run locally whose index entry names a bundle: the owner, or
     any holder of a shared run.
   - **When:** the listing lacks that name, or shows a size different from `stub.bundle.bytes`.
     This includes the case where our upload was **skipped** because a remote stub already had
     the digest, yet that stub's bundle file is missing.
   - **What:** re-upload under the same name, take the new sha256, and push the stub. This is the
     self-heal path for `missing`.
   - **Corrupt files:** a downloader that sees `corrupt` posts a notice. The holder fixes it on its
     next GC when the size differs. When only the content differs (rare), Library → Runs offers
     "Re-upload" (S5b).
6. **Re-seed (rev 3).** This applies when our own lib file is missing (GC'd as stale, or deleted
   by hand), `syncIndex` is non-empty, and the root is not erased.
   - **What happens:** the device **keeps `syncIndex` and `vvCounter`**, and simply writes a new lib
     file in the next cycle (pull before push, as always).
   - **Why it is safe:** our old base entries are published again, but every newer peer edit
     dominates them by vv, so they never win.
   - **Why it beats a reset:**
     - Unchanged records are not re-minted, so there are no false copies of stale content.
     - Edits made since the last push are normal candidates.
     - Rev 2's reset-then-merge would have turned every stale record into a copy, and without a
       persistent counter it lost new edits (N1).
   - **The one resurrection case:** a record deleted by others whose tombstone was dropped while
     this device was away for more than 180 days. It comes back as "kept on this device",
     documented.
7. **Pacing:** deletes use the write bucket. GC is skipped when `navigator.connection?.saveData` is
   on.

### 7.10 Account binding, erase, sign-out

- **Binding:** `syncMeta.account = { accountId, email, boundAt }`. When a different `permissionId`
  signs in, a sheet offers two choices:
  - **Sync this device's data to b@**: `resetLocalSyncState` (it keeps the device id and
    `vvCounter`), then `begin('merge')`;
  - **Cancel**: revoke.
- **Remove my data from Drive:**
  1. Rewrite the root with `erased: { at, by }`.
  2. Delete every other file (paced, with progress).
  3. `resetLocalSyncState()`, then sign out. Local data stays.
  4. Other devices see `erased.at > boundAt`, turn `off`, and show a notice.
  5. A later sign-in rewrites the root without `erased`.
- **Hidden app data deleted from Google's side** (Drive → Manage apps): the root is missing, so the
  preview reports `remoteEmpty` and asks before uploading (§8.3). The device never re-pushes
  silently; that is the re-seed rule.

### 7.11 Triggers, backoff, multi-tab

| Trigger | Condition |
|---|---|
| sign-in | → `begin` (after the run-idle wait) |
| start | `prefs.enabled`, a valid token in localStorage, 3 s after first paint |
| visible | more than 60 s since the last cycle |
| local change | `onDirty`, **including marks broadcast from other tabs** (`BroadcastChannel('spinner-sync')` `{ type: 'dirty', keys }`, received by the lock holder); debounce 5 s, wait at most 30 s |
| interval | every 5 min while visible |
| `online` | |
| Sync now | always; resets the backoff |
| a run reaches `done` | 10 s later (uploads its bundle) |

- **Never while hidden.**
- **During an active run:** library sync continues. Bundle uploads and downloads, the first sync
  and Replace wait.
- **Backoff:**
  - `network`, `server`, `rate`: 30 s, 1 m, 2 m, 5 m, 10 m, then 15 m, with ±20 % jitter;
    `Retry-After` wins;
  - `auth` → `needs-auth`;
  - `quota` → `drive-full` (retried hourly, or on Sync now);
  - `forbidden` → `error`;
  - offline → `offline`, until the `online` event.
- **Multi-tab:**
  - each cycle takes the Web Lock `spinner:sync` with `ifAvailable`;
  - the holder broadcasts its status and `{ changed: kinds[] }`;
  - every tab then refreshes `libraryVersion`, layouts, `recentRuns` and `settingsStore`, and calls
    `clearRunCache` and `clearVerdictCache`.

### 7.12 Storage budget and downloads

- **The Account card shows:**
  - Drive: spinner's bytes, plus the account's usage and limit;
  - this device: `estimate()`;
  - runs only in Drive: count and bytes, with **Download all**;
  - per run: **Remove download (keep in Drive)** (`evict`).
- **Policy defaults:**
  - `onOpen` when `userAgentData.mobile` is set, or the screen is under 768 px wide with a coarse
    pointer;
  - `all` otherwise.
- **Download all** checks `quota − usage ≥ 1.5 × remoteOnly.bytes`. When space runs short, it
  downloads what fits and says so.
- **Quota error:** the state goes to `local-full`, and the policy switches to `onOpen` with a notice.
  Nothing is half-written.

### 7.13 DB upgrade interactions (nit)

- **An old tab (v2 code) is open when a new tab opens v3.** The new tab gets `onblocked` and shows
  the existing "close other spinner tabs" message. The old tab's `onversionchange` closes its
  connection.
- **An older build after a rollback meets a v3 database.** Opening fails with `VersionError`, and the
  app falls back to the memory backend with "data from a newer version". **Sync is disabled whenever
  the backend is memory**, so a rolled-back device can never push a wave of tombstones. Nothing is
  deleted.

---

## 8. UX (phone first, 360 px)

### 8.1 Settings → Account (first card; `#/settings?account=1`)

```
Signed out                              Signed in
┌────────────────────────────────┐      ┌────────────────────────────────┐
│ Account and sync               │      │ Account and sync               │
│ Use your library and runs on   │      │ owner@gmail.com                │
│ all your devices. spinner keeps│      │ ✓ Up to date · 2 min ago       │
│ them in a hidden folder in     │      │ This device: Pixel 11  [Rename]│
│ your own Google Drive.         │      │ [ Sync now ]                   │
│ [ G  Sign in with Google     ] │      │ Google Drive  182 MB of 15 GB  │
│ spinner sees only its own      │      │ This device    96 MB           │
│ folder, never your other files.│      │ 12 runs only in Drive (31 MB)  │
│ How sync works ›               │      │ [ Download all ]               │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │      │ Download runs                  │
│ Test Google sign-in  (D23) [▸] │      │ (•) When I open them           │
└────────────────────────────────┘      │ ( ) All, in the background     │
Popup failed / installed Android:       │ ⚠ 1 notice                 ›   │
│ [ G  Sign in in this window  ] │      │ Devices: Pixel 11 (this),      │
│ The app reloads after signing  │      │   Laptop (yesterday)       ›   │
│ in; nothing is lost.           │      │ [ Sign out ]                   │
Not configured: "Sync is not set up     │ Remove my data from Drive…     │
in this build."                         └────────────────────────────────┘
```

| State | Status line | Action |
|---|---|---|
| `idle` | ✓ Up to date · 2 min ago | Sync now |
| `syncing` | ↻ Syncing… uploading run 3 of 12 (14 MB) | progress bar |
| `offline` | ⦸ Offline · 4 changes waiting | none |
| `needs-auth`, pending > 0 | ! Sign-in expired · 4 changes waiting | **Reconnect** (primary) |
| `needs-auth`, pending 0 | Sync paused · sign in again to get changes from your other devices | Reconnect (secondary) |
| `waiting-run` | ⏸ Waiting for the run to finish | none |
| `backoff` | ! Google Drive is busy · retrying in 2 min | Sync now |
| `drive-full` | ! Your Google Drive is full | link, plus Sync now |
| `local-full` | ! This device is out of space · runs stay in Drive | Library › Runs |
| `error` | ! Drive data is from a newer spinner. Update the app. / Access was removed. Sign in again. | Check for updates / Sign in |

### 8.2 Shell indicator (`SyncIndicator` in TopBar and NavRail)

```
┌──────────────────────────────────────────────┐
│ ←  Library                 [☁✓] [Running 43%]│
└──────────────────────────────────────────────┘
```

- **Hidden** when sync is `off`.
- **Glyphs:**
  - ☁✓ idle (muted);
  - ☁↻ syncing (static under reduced motion);
  - ☁⦸ offline;
  - ☁‖ paused: `needs-auth` with nothing pending, or `waiting-run`. Muted, **no nag**.
  - ☁! amber, **only** for `needs-auth` with pending > 0, `error`, `drive-full` or `local-full`. It
    adds the text "Reconnect" when the screen is at least 400 px wide.
- **Size and labels:** a 44 × 44 px target. The `aria-label` is the status line. A polite live region
  announces only entering or leaving the attention states.
- **Tap:** in `needs-auth`, it calls `reconnect()` inside the click. Otherwise it opens the Account
  card.

### 8.3 First sign-in on a second device

The sheet is shown once any active run finishes:

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

Replace asks again before deleting.

### 8.4 Runs that are not on this device (B4: every list and picker)

- **Lists.** Home, Library → Runs, the Compare picker and Define's compare sheet show the normal
  row, with its verdict and a "☁ In Drive" badge. Stub-only remote runs are greyed ("Paused on
  Laptop · 43%") and do not open.
- **Compare.** Picking a remote done run downloads it first, inline ("Downloading 2 runs…").
- **Sweep.** A remote done run with the variant's `simKey` counts as done and is **not** re-run. It
  downloads when the sweep screen needs its numbers.
- **Analyze or Watch on a remote-only run** shows the `RemoteRunCard`:

```
┌────────────────────────────────┐
│ Martingale red · 10,000 × 500  │   (name from the definition record: experimentName())
│ mean −$41 ± $6 · P(ahead) 38%  │
│ In your Google Drive (1.8 MB), │
│ made on Laptop.                │
│ ▓▓▓▓▓▓▓░░░  Downloading 62%    │
│ [ Cancel ]                     │
└────────────────────────────────┘
```

  Other card states:
  - offline: "It will download when you're back online";
  - signed out: `[Reconnect and download]`;
  - corrupt or missing: "This run's file in Drive is damaged or missing. It is re-uploaded from the
    device that has it on its next sync."
- **Conflict toast** (aggregated per cycle) with **View**, which opens the notices in Account.

### 8.5 Other copy

- **"Delete all data"** becomes **"Delete everything on this device"**, with the line "Your Google
  Drive copy is kept."
- **Remove my data from Drive** asks: "Remove all spinner data from your Google Drive? It stays on
  this device. Your other devices stop syncing." Buttons: `[Remove from Drive]` `[Cancel]`.

---

## 9. Error and offline handling

| Situation | Behaviour |
|---|---|
| Offline at start | Everything works locally. Sync shows `offline`; GIS is not loaded |
| Network drop or 401 mid-cycle | The step is not committed. State `offline` or `needs-auth`; resumable sessions continue later |
| Rate limit (403/429) or 5xx | Per-request retries, then `backoff` |
| Drive quota | `drive-full`: uploads stop, pulls continue |
| Bad lib file or entry | Skipped with a notice naming the device; `seen` is not advanced |
| Root `version > 1` | `error`; nothing is written |
| Bundle missing or corrupt | `RemoteRunCard` message; the holder self-heals on GC (§7.9 step 5) |
| Local quota | `local-full`; the policy switches to `onOpen` |
| Memory backend (IDB unavailable, or a rolled-back build) | **Sync disabled**, with the note "Sync needs storage that persists" |
| Clock skew > 24 h | Accepted, with a warning |
| Popup blocked, closed or timed out | "Sign in in this window" (redirect) |
| Redirect `state` mismatch or expired | The return page shows a message and a link back; no token is stored |
| GIS script fails to load | "Couldn't reach Google"; retry is allowed |
| Another tab is syncing | Status is mirrored; Sync now shows "Syncing in another tab" |
| A remote delete of a run that is running here | The run is kept and re-pushed, with a notice |
| First sync or Replace while a run is active | `waiting-run`; starts when the run is idle |

---

## 10. Privacy and security

- **Scope:** only `drive.appdata` ("See, create, and delete its own configuration data in your
  Google Drive"). spinner cannot see any other Drive file. The folder is hidden, counts toward the
  user's storage, and can be deleted in Drive → Settings → Manage apps.
- **No server:** data goes only between the browser and Google.
- **Tokens:**
  - An access token lasts about 1 h and lives in localStorage with its expiry (D2). There is no
    refresh token.
  - Sign-out revokes the token.
  - Error reports must redact `Authorization` and `access_token`.
  - The redirect checks `state` and scrubs the URL fragment.
- **Client ID:** public. Its authorised origins are `https://creynia.github.io` and localhost. There
  is no secret anywhere.
- **Not end-to-end encrypted.** The data is readable by the account owner and by Google, and the
  About text says so. A passphrase is a chip (open question 18).
- **CSP:** from S0 on (§5.5).
- **About**, after the decisions #11 disclaimer, verbatim (the README gets the same text under
  "Privacy"):

  > **Google Drive sync (optional).** If you sign in with Google, spinner keeps a copy of your
  > library and runs in a hidden app folder in your own Google Drive. spinner can see only that
  > folder, never your other files, and there is no spinner server: your data goes only between
  > this browser and Google. To remove it, use Settings → Account → Remove my data from Drive, or
  > Google Drive → Settings → Manage apps → spinner → Delete hidden app data. You can revoke access
  > at myaccount.google.com/permissions.

---

## 11. Test strategy

### 11.1 Unit tests (node, `VITEST_MAX_WORKERS=2`)

- **core/store:**
  - v3 upgrade with fake-indexeddb: a fresh database has 14 stores; a seeded v2 database keeps all
    its data and gains 3 stores; v1 upgrades straight to v3.
  - The memory backend has 14 stores.
  - **Every hard-coded store count is updated:** `schema.test.ts` (11 → 14), `backend.test.ts`,
    `sink.test.ts` and `tests/app/shell.test.tsx`. S1 greps the tests for `toHaveLength(1[01])` and
    `STORE_NAMES`.
  - `update()` is atomic on both backends.
  - Tracking marks:
    - every writer path writes its mark in the same transaction;
    - an aborted transaction leaves no mark, and a raw write leaves none;
    - `theme` gets no mark, `framing` does;
    - a dry-run definition gets a mark, but `snapshot` returns null for it.
- **core/sync, the pure parts:**
  - HLC `tickAt` and `recv`.
  - Fingerprint vectors pinned per kind (§7.2), including "a change to `updatedAt` only gives the
    same hash".
  - `vv` descent.
  - `foldEntries`:
    - **every permutation** of sets of up to 5 entries gives an identical result (N2);
    - equivalent entries collapse into the lowest HLC with their vvs joined, and with no loser
      (N3);
    - no input entry is mutated;
    - 1,000 seeded random sets.
  - **N1:** push 3 edits, lose the own lib file, reset, edit. The edit wins, and `vvCounter` was
    never reset by any reset path (re-seed, Replace, account switch, erase, delete-all).
  - `displayNameAt` ties are broken by the entry HLC.
  - `joinDef`:
    - with and without `displayName`/`displayNameAt` (rename-back);
    - `runIds` sorted, minus deleted runs;
    - unknown keys preserved.
  - Deterministic `copyOf` ids.
  - Every row of §7.4 and §7.5.
  - A lib file round trip, and the decode refusals.
- **core/sync engine, with `createMemoryRemote({ hook })`:**
  - **The B1 model test.** The prototype's `model.test.mts` scenarios, re-run through the real
    engine and the memory remote.
  - **Convergence fuzz at remote-call granularity.**
    - Setup: 3 devices share one memory remote; each has its own memory backend.
    - Interleaving: the `hook` runs before **every** remote call (list, download, create, update,
      delete). At each hook point the scheduler may run any number of steps of the *other*
      devices' cycles, or local edits, before letting the call proceed. Cycles therefore genuinely
      interleave mid-cycle, and the B1 race can fall between a device's `RECHECK` and its lib
      write.
    - Operations:
      - create, edit, rename and delete of strategies, layouts, definitions, groups and settings;
      - fake runs finishing, cancelled or deleted;
      - imports of the same run on two devices.
    - Each case runs 300 steps, then settles by having every device sync twice. 50 seeds.
    - **Assert:**
      - every device ends with identical synced stores (canonical dump);
      - every device's last local value before settling exists on every device, either as itself
        or as a copy;
      - every concurrent pair produces exactly one copy, and one notice on each device that saw it;
      - **copy counts:** copies exist only of base ids (never a copy of a copy), and each content
        is copied at most once;
      - no copy of a deleted copy is ever made;
      - a merge never changes the order of a group's `runIds`.
  - **Crash injection:** fault the *k*-th remote call for every *k* across a cycle, then sync again.
    The devices must converge, and nothing local may change except by a rule.
  - **Runs:**
    - paused, then done: the stub is replaced by stub + bundle;
    - cancelled and errored runs: a stub only, never a bundle;
    - a remote delete while the run is active;
    - a corrupt bundle (sha mismatch) and a tampered digest: nothing is written;
    - a shared import on two devices: one entry, one bundle, and the second upload is skipped;
    - a trimmed import downloads with sha-only verification;
    - the `RunMeta` rebuild table, field by field.
  - **Other engine tests:**
    - dry runs never reach the remote;
    - forward compatibility: a `v: 2` entry survives a round trip through an older device;
    - GC: a tombstone is dropped only after 30 days plus every acknowledgement; a stale device's
      file goes after 180 days; an orphan goes after 1 h, while a shared bundle is kept; a missing
      bundle is re-uploaded by its holder;
    - re-seed when the own lib file is missing: the index is kept, nothing is re-minted, and there
      are no false copies;
    - the erase marker;
    - first-sync merge and replace, including waiting for an active run;
    - a cycle with no changes makes **exactly 1 request**.
  - Never call `toEqual` on multi-MB typed arrays; it exhausted the heap in the prototype.
- **app/services/sync:**
  - the Drive client against `tests/e2e/fakes/drive-server.ts` (typed, inside the tsconfig);
  - GIS against a fake `google.accounts.oauth2`, including `timeoutMs`;
  - the redirect return entry: localStorage state, TTL, mismatch, error fragment, scrub;
  - flow choice: Android standalone gets the redirect, desktop the popup;
  - the service with a fake engine and fake timers.

### 11.2 Component tests (happy-dom)

- Every `SyncState` renders its text, including `needs-auth` with and without pending changes.
- `reconnect()` and `signIn()` are called synchronously inside the click.
- The amber glyph follows §8.2 exactly.
- `RemoteRunCard` covers all its states.
- The Test sign-in row (in Account, S4) appears only when a client ID is configured, and its
  "Expire token now" button drives the Reconnect path.

### 11.3 E2E (Playwright, `res browser`, `PW_WORKERS ≤ 2`)

`tests/e2e/fakes/route.ts` routes three Google endpoints to fakes:

- `https://accounts.google.com/gsi/client` → `tests/e2e/fakes/gis-fake.ts`, built to a string at
  test time and controlled through `window.__gisFake`;
- `https://accounts.google.com/o/oauth2/v2/auth` → a fake consent page that redirects back with a
  token;
- `https://www.googleapis.com/**` → **one shared fake Drive** in the test process.

Two `browser.newContext()` act as two devices on one account. The scenarios run on `phone-360` and
`desktop`:

1. A signs in, Drive is empty, Start: a definition, a layout and a small done run upload.
2. B (with local data) chooses Merge. A's run shows with its verdict and badge **in Home, the
   Library, the Compare picker and Define's compare sheet**. Opening it downloads it, and the
   numbers match (same digest).
3. A edits a layout; Sync now on B shows the edit.
4. **B1:** A and B edit the same strategy. A's fake-Drive writes are held until B has listed and
   pushed. Both versions survive on both devices (the id plus one copy), with one notice each.
5. A deletes a run and syncs; it is gone on B.
6. B goes offline, edits queue, and B comes back online: the edits push.
7. Token expiry with pending changes: amber Reconnect, one tap, the sync finishes. Expiry with
   nothing pending: no amber.
8. A blocked popup falls back to a redirect round trip through `oauth-return.html`. With
   `display-mode: standalone` emulated and an Android user agent, the redirect is the default.
9. Remove my data from Drive on A turns B `off`.
10. A sweep on B reuses A's remote done variant run; no new run starts.
11. A paused run on A shows greyed on B and does not open.

The CSP is enforced on **every** spec from S0 on. axe runs at 360 px.

### 11.4 Manual plan for the owner (real Google)

**The gate** comes after wave 2 (D23), on the deploy that includes S3. On the Pixel:

1. In Chrome (not the installed app), tap Settings → Account → Test Google sign-in (popup). Expect the consent screen
   with the unverified/test-user notice and only the "its own configuration data" permission. Then
   expect your email and "0 files".
2. In the installed app, tap the same button. Expect the redirect flow: the app reloads, then shows
   your email.
3. In both, tap "Expire token now", then **Reconnect**. Expect one tap with no questions: a quick
   popup flash, or a redirect hop in the installed app.
4. Report which flows worked, and whether the popup also works in the installed app (button: "Try
   popup instead").

**The full plan**, after S6:

1. **Laptop:** sign in and run a 10,000 × 500 experiment. Expect ✓, and Drive usage up by about
   1–2 MB.
2. **Pixel, installed app:** sign in and choose Merge. The runs show with verdicts. Opening one
   downloads it, and the numbers match the laptop's.
3. **Pixel offline:** edit a strategy, then go back online. It should sync within 5 s.
4. **Leave the app for more than 1 h:** with nothing pending there is no nag. After an edit there is
   an amber Reconnect, and one tap fixes it.
5. **Edit the same strategy on both devices,** one of them offline. Both versions are kept, with a
   notice.
6. **Sign out on the laptop.** myaccount.google.com/permissions lists spinner with only the app-data
   permission.
7. **Remove my data from Drive.** The phone shows "Sync was turned off".
8. **Record timings** (time to first sync, time to download a run) in `docs/perf.md`.

---

## 12. Owner setup (Google Cloud, about 10 minutes)

Google renamed the "OAuth consent screen" pages to **Google Auth Platform** (Branding, Audience,
Data access, Clients). The old names are in parentheses.

1. **Project.** Open https://console.cloud.google.com/, then the project picker → **New project** →
   `spinner` → **Create**. Select it.
2. **Drive API.** ☰ → **APIs & Services → Library** → "Google Drive API" → **Enable**.
3. **Consent screen.** ☰ → **Google Auth Platform** (OAuth consent screen) → **Get started**:
   - app name `spinner`, support email = your Gmail;
   - Audience **External**;
   - contact = your Gmail;
   - agree → **Create**.
4. **Scope.** **Data access** → **Add or remove scopes** → tick
   `https://www.googleapis.com/auth/drive.appdata` → **Update** → **Save**. It is non-sensitive, so
   there is no review.
5. **Audience.** Leave **Testing** on, then **Test users → Add users** → your Gmail → Save. At
   sign-in, Google shows "Google hasn't verified this app": choose **Continue** (open question 17).
   Publishing is the alternative; brand verification is optional for this scope.
6. **Client.** **Clients** (Credentials → Create credentials → OAuth client ID) → **Create client**:
   - Type: **Web application**. Name: `spinner web`.
   - **Authorised JavaScript origins:**
     - `https://creynia.github.io`
     - `http://localhost:5173`
     - `http://localhost:4173`
   - **Authorised redirect URIs:**
     - `https://creynia.github.io/spinner/oauth-return.html`
     - `http://localhost:5173/oauth-return.html`
     - `http://localhost:4173/spinner/oauth-return.html`
   - Click **Create** and copy the **Client ID** (`…apps.googleusercontent.com`). Ignore the secret,
     or delete it. Changes can take a few minutes to apply.
7. **Give the ID to the build.** It is public, so any of these is fine:
   - **(a) Recommended:** GitHub → creynia/spinner → Settings → Secrets and variables → Actions →
     **Variables** → **New repository variable**: `GOOGLE_CLIENT_ID` = the ID. S3 wires it into the
     Pages build.
   - **(b)** Paste it in chat, and the orchestrator commits it to `src/app/services/sync/config.ts`.
   - **Local development:** put `VITE_GOOGLE_CLIENT_ID=<the ID>` in **`.env.local`** at the repo
     root. `*.local` is gitignored from S0 on; check with `git check-ignore .env.local`.
8. **Gate (D23).** After the S3 deploy, run the §11.4 gate and report the result. Wave 4 starts
   after that.

---

## 13. Work packages

**Rules for every WP:**

- Branches: `claude/spinner-sync-<wp>`.
- Ownership is exclusive; the orchestrator grants batons.
- Done = `npm run check` green.
- Vitest runs through `res cpu`, Playwright through `res browser`.
- **No rename feature.** `displayName`/`displayNameAt` come from PR #37. S2a must compile with or
  without them, treating them as optional keys until #37 lands.

```
Wave 1:  S0 contracts + stubs + Backend.update (both) + CSP plugin + .gitignore + layering edge
           │
Wave 2:  ┌─┴───────────┬──────────────┬─────────────────┬──────────────┐
         S1 store v3   S2a sync pure  S3 auth + Drive   S4 sync UI
         + tracking    (hlc, fp, vv,  + redirect entry  (vs S0 stub)
           │           merge, lib)    + Test sign-in ──► ★ GATE: owner checks sign-in on the Pixel (D23)
           └─────┬───────┘                │                    │
Wave 3:   S2b engine core ──────┐         │                    │
          (pull/apply/push,     │         │                    │
           RECHECK, call-level  ▼         │                    │
           fuzz)              S2c runs, GC, erase, first sync, re-seed
                                │         │                    │
Wave 4:  (after ★)        S5a app service ◄┘                   │
                                │                              │
Wave 5:                   S5b screen integration ◄─────────────┘   (all listRuns consumers, RunRow)
                                │
Wave 6:                   S6 e2e two-device, docs, delete the prototype
```

There are ten WPs, at most four at once (wave 2). The gate overlaps wave 3; the engine does not need
Google.

### WP-S0 Contracts, stubs, CSP (wave 1)

- **Owns:**
  - `src/core/contracts/sync.ts`; additive `synced?` in `run.ts`; appended cases in
    `contracts.test.ts`;
  - the `src/core/sync/*.ts` stubs (§4.4);
  - `src/app/services/sync/{index,config}.ts`, as an inert stub;
  - `build/vite-plugin-csp.ts`;
  - in `src/core/store/backend.ts`, **only** `TxReader` and `update` on **both** backends: the IDB
    side real, or a stub rejecting `not implemented`;
  - in `src/core/store/bundle.ts`, `encodeRunBundleWithDigest` (a thin wrapper);
  - `tests/build/sw.test.ts`: a test that cross-origin requests are not intercepted;
  - `tests/build/csp.test.ts`: the built `index.html` has the meta CSP.
- **Batons:**
  - `eslint.config.js` and `tests/build/layering.test.ts`, in one commit: `CORE_MODULES += 'sync'`,
    `CORE_ALLOWED.sync = ['contracts', 'experiment', 'store']`, and `testing` gains `sync`. It also adds
    an `oauth` zone (`src/oauth/`) that may import only `@core/*` contracts and `src/pwa`, never
    `src/app`;
  - `src/core/index.ts` (append);
  - `src/env.d.ts` (`ImportMetaEnv.VITE_GOOGLE_CLIENT_ID?`);
  - `vite.config.ts` (register the CSP plugin);
  - `.gitignore` (`*.local`);
  - `tests/app/shell.test.tsx` (`strictBackend` gains `update`);
  - `tests/e2e/helpers.ts`, the guard fixture that **every existing spec already imports** (all 14).
    S0 adds `page.addInitScript` with a `securitypolicyviolation` listener that `console.error`s,
    so the existing guard fails any spec with a violation. No spec needs editing. S0 owns this
    change by baton.
- **Acceptance:**
  - typecheck, lint and the layering test pass;
  - contract constants are pinned;
  - the memory `update()` is tested;
  - the **full existing e2e suite passes under the CSP** with zero violations;
  - `git check-ignore .env.local` succeeds.

### WP-S1 Store v3 and change tracking (wave 2)

- **Owns:**
  - `src/core/store/backend.ts`: v3 (`V2_STORE_NAMES`, the new stores, `DB_UPGRADES[3]`,
    `SYNCED_STORES`) and completing the IDB `update`;
  - `src/core/store/tracking.ts`;
  - the `schema`, `backend` and `tracking` tests, **`sink.test.ts`**, and every other test with a
    hard-coded store count;
  - `src/app/services/db.ts`: wrap the backend in `getRepo`, add `getRawBackend()`, make
    `deleteAll` write raw, and skip wrapping on a memory backend (so sync stays disabled there);
  - `tests/app/shell.test.tsx` (store counts).
- **Batons:** `src/core/index.ts`.
- **Acceptance:** as §11.1 core/store.

### WP-S2a Sync core, pure parts (wave 2)

- **Owns:** `src/core/sync/{hlc,fingerprint,vv,merge,libfile}.ts` and their tests.
- **Acceptance:** as §11.1 pure, including porting the prototype's `model.test.mts` cases onto the
  real `foldEntries` and `resolve`: N1, N2 (permutations), N3, and the fuzz with its copy-count
  asserts.

### WP-S3 Auth, Drive client, sign-in gate (wave 2)

- **Owns:**
  - `src/app/services/sync/{gis,drive,redirect,flow,backoff,test-signin}.ts`;
  - `oauth-return.html` (at the repo root, a Vite entry) and `src/oauth/return.ts`;
  - `tests/e2e/fakes/{drive-server,gis-fake,auth-page}.ts`;
  - `tests/app/sync/*.test.ts`;
  - `testSignIn()` and `expireTokenForTest()` in `services/sync/test-signin.ts`. The **row itself
    is S4's** (it lives in the Account card), so S3 holds no Settings baton.
  - `src/oauth/return.ts` **imports nothing from `src/app/`**. It may import `src/core` contracts
    or `src/pwa` only; the layering rule's `other` zone is not enough, so S0 adds the
    `oauth → core` edge to the boundary check (S0's eslint baton).
- **Batons:**
  - `vite.config.ts`: `build.rollupOptions.input` adds `oauth-return.html`; the CSP plugin covers
    it;
  - `.github/workflows/pages.yml`: `env: VITE_GOOGLE_CLIENT_ID: ${{ vars.GOOGLE_CLIENT_ID }}` on the
    build step, so the gate deploy has the ID.
- **Acceptance:**
  - the prototype tests, plus paging, resume, the 404 restart, a missing `Range`, abort, and the
    error codes;
  - `timeoutMs` leads to the redirect offer;
  - the redirect state lives in localStorage, with TTL, mismatch and scrub covered;
  - flow choice;
  - token restore from localStorage after a reload;
  - an offline revoke;
  - an e2e smoke of Test sign-in through the fakes;
  - the build emits `dist/oauth-return.html` with the CSP and no inline script.

### WP-S4 Sync UI (wave 2, against the S0 stub)

- **Owns:**
  - `src/app/screens/Settings/Account.tsx`, including the **Test Google sign-in row** (D23). It
    calls the S0 stub's `testSignIn()`, which S3 makes real.
  - `src/app/components/{SyncIndicator,SyncSheets,RemoteRunCard}.tsx`, and their tests.
  - S4 is the **only** wave-2 holder of the `Settings/index.tsx` baton.
- **Batons:**
  - `Settings/index.tsx`: Account first; "Delete everything on this device"; the About paragraph;
  - `TopBar.tsx` and `Nav.tsx`, one line each;
  - `tokens.css`: an amber token if there is none.
- **Acceptance:** §11.2, axe at 360 px, and no horizontal scroll at 360 px or 844 × 390.

### WP-S2b Engine core (wave 3: needs S1 and S2a)

- **Owns:** `src/core/sync/{engine,apply,push,memory-remote}.ts` and their tests, including
  `engine.fuzz.test.ts`. The scope:
  - `cycle`, PULL+APPLY, SNAPSHOT, RECHECK, push and commit;
  - the memory remote's `hook` and `fault`;
  - status and progress.
- **Acceptance:**
  - B1 through the engine;
  - the call-level fuzz, 50 seeds, over the library kinds (no runs yet);
  - crash injection;
  - fingerprint no-op saves;
  - dry-run exclusion;
  - opaque entries;
  - a no-change cycle makes one request.

### WP-S2c Runs, GC, erase, first sync (wave 3, after S2b; S2b's fuzz harness exists)

- **Owns:** `src/core/sync/{runs,gc,first,erase}.ts` and their tests.
- **Batons:** `src/core/store/sink.ts`, only if `writeCompacted` needs an option;
  `src/core/store/bundle.ts`, only if decode must expose `trimmed`.
- **Acceptance:** the §11.1 runs, GC, re-seed, erase and first-sync tests, with the fuzz extended to
  runs and shared imports.

### WP-S5a App service (wave 4: needs S2b, S2c, S3, and the passed gate)

- **Owns:** `src/app/services/sync/{index,service,lock,channel,prefs}.ts` (the real bodies) and
  `tests/app/sync/service.test.ts`. The scope:
  - triggers, the Web Lock, and the BroadcastChannel (status, changes, **dirty marks from other
    tabs**);
  - backoff;
  - the status store, following §8.1 (no nag when nothing is pending);
  - `describeRun` (verdict), `isDryRun` (`DRY_RUN_TAG`), `isRunActive`;
  - the policy defaults;
  - the run-idle wait for first sync and Replace;
  - the refresh fan-out to other tabs.
- **Batons:** `src/app/main.tsx` (start the service); `src/app/services/runs.ts` (export
  `isActive`).
- **Acceptance:**
  - every trigger, under fake timers;
  - a hidden tab never syncs;
  - with two tabs, one cycle runs at a time, and dirty marks are forwarded to the lock holder;
  - a memory backend gives `off`;
  - no `console.error`.

### WP-S5b Screen integration (wave 5: needs S5a and S4)

- **Owns:** `RunRow` and `listRunRows()` in `src/app/services/runs.ts`. That file belongs to
  ui-results; S5b holds its baton for this wave.
- **Batons**, covering every `listRuns()` consumer (B4):
  - `services/runs.ts` (`listRecentRuns` → Home);
  - `Sweep/sweep.ts`: reuse remote done runs by `simKey`, never re-run them;
  - `Compare/index.tsx`: the picker, plus inline download;
  - `Define/index.tsx`: the compare sheet;
  - `Library/index.tsx`: badge, greyed stubs, Remove download, Re-upload; the definition's run
    count filters `runIds` against local runs ∪ stubs;
  - `Home/index.tsx`;
  - `Analyze/data.tsx` and `Watch/deps.ts`: a `remote` state that shows `RemoteRunCard`;
  - `Define/data.ts` and `services/layouts.ts`: export the `touch` functions.

  Names resolve through `experimentName()` from PR #37, or `definition.name` until #37 lands.
- **Acceptance:**
  - app tests for each consumer, with a remote-only done run and a stub-only paused run;
  - Sweep does not start a run for a remote done variant;
  - Compare downloads first, then compares.

### WP-S6 E2E, docs, cleanup (wave 6: needs S5b)

- **Owns:**
  - `tests/e2e/sync.spec.ts` and `tests/e2e/fakes/route.ts`;
  - `README.md` (Privacy);
  - `docs/design/architecture.md` (a pointer);
  - **deleting `docs/design/sync-prototype/`** and fixing every pointer to it, here (§15) and
    elsewhere.
- **Batons:** `.github/workflows/ci.yml` (a dummy `VITE_GOOGLE_CLIENT_ID` for e2e).
- **Acceptance:** all §11.3 scenarios on `phone-360` and `desktop`; `npm run check` green.
- The orchestrator updates `decisions.md` with the rev 2 refinements (§16).

---

## 14. Open questions

Already decided (open-questions.md rows 13–18):

| # | Question | Decided |
|---|---|---|
| 13 | Theme | per device |
| 14 | Downloads | phones on open, desktops all |
| 15 | Resume on another device | no in v1 |
| 16 | Upload on mobile data | always |
| 17 | Testing vs publish | Testing |
| 18 | Encryption | no in v1 |

New in rev 2:

| # | Question | Recommended default | Alternatives |
|---|---|---|---|
| Q19 | How is a conflicted copy named? | `"<name> (<device name>)"`. The device name is set at first sign-in from the UA ("Pixel 11", "Chrome on Linux") and can be renamed in Account. | "(conflict, 29 Oct)" |
| Q20 | Should paused, cancelled and errored runs from another device show in lists? | **Yes, greyed** ("Paused on Laptop · 43%"), so you know the work exists. | Hide them until done. |
| Q21 | What happens to a library definition that uses a strategy which became a conflicted copy? | Nothing: definitions inline their strategy (content-addressed), so nothing references the library id. | n/a |

---

## 15. Prototype and risks

`docs/design/sync-prototype/` is throwaway code; S6 deletes it. The `.mts` extension keeps it out of
the app tsconfig and ESLint, and Prettier already ignores `docs/`. It contains:

- `contracts-sync.mts`. Rev 2 adds `basis` and `vv`, removes `name` from the stub, and makes `owner`
  optional.
- `drive.mts`.
- `gis.mts`. Rev 2 keeps the token in localStorage and adds `timeoutMs`.
- `fake-drive.mts`.
- `prototype.test.mts`, 5 tests:
  - Drive: multipart upload, paging, a resumable 13 MB upload with resume, and error mapping;
  - GIS: sign-in, expiry, silent reconnect, revoke, scope, blocked popup, timeout and unconfigured.
- `model.mts` and `model.test.mts`, the **merge model** (rev 3), 7 tests:
  - the B1 race where both devices push before either pulls;
  - a chain A → C → D, with no false conflict;
  - an edit beating a delete;
  - **N1**: reset, then edit; the edit survives;
  - **N2**: every permutation of fold order gives one result;
  - **N3**: three devices create the same copy, and there is no copy of the copy;
  - a 3-device, 400-step fuzz at step granularity. It includes losing the own lib file and
    Replace, and asserts convergence, that no edit is lost, and copy counts. The default is 100
    seeds; `MODEL_SEEDS=1000` passes.

  **The fuzz found two more defects while it was being written; both are fixed in the design:**
  1. **A local candidate must consume a real counter value.** A candidate that only "peeked" at
     `vvCounter + 1` was absorbed into an equivalent tombstone's joined vv. A later, different
     entry then reused that value and looked already seen, and its edit was lost.
  2. **Re-seed must keep the index.** Rev 2's reset-then-merge turned every stale record into a
     concurrent candidate. The copies were named differently on different devices, which gave a
     copy of a copy.

| # | Risk | Mitigation |
|---|---|---|
| R1 | The GIS popup in an installed Android app | The redirect is the default there (D1); the gate (D23) tests both flows |
| R2 | The implicit grant is discouraged and could be retired | It is used only on Android standalone and as a fallback; the popup path stays. Revisit if Google announces a retirement |
| R3 | CORS may hide the resumable upload's `308 Range` header | The client assumes the whole chunk landed and confirms with `bytes */N`. Check manually with a large run |
| R4 | Main-thread jank while encoding large bundles | Encoding happens only while no run is active; a chip moves it to a worker |
| R5 | Lib file growth | Measured in the fuzz; a chip shards lib files by kind |
| R6 | The GIS script is unversioned | Only 3 calls are used, the fake mirrors them, and the gate re-checks |

---

## 16. Changelog

### Rev 3 (PR #36 re-review)

**Blocking:**

- **N1:**
  - `vv[self]` comes from a persistent, monotone `syncMeta.vvCounter`. It survives re-seed,
    Replace, account switch, erase and delete-all (D7).
  - A local candidate consumes a fresh counter value.
  - A model test covers reset, then edit.
- **N2:**
  - `mergeEntries` is replaced by `foldEntries(set)`: equivalence classes, then the maximal
    elements, then the winner. No entry is mutated.
  - `seen` (the join of all folded vvs) is stored locally in `syncIndex.seen` and never published.
  - A test covers every permutation.
- **N3:**
  - Equal fingerprint plus equal deleted flag means equivalent: collapse into the lowest HLC, with
    the vvs joined and no loser.
  - The fuzz asserts copy counts.
- **Re-seed, revised (found by the fuzz):** it keeps `syncIndex` and `vvCounter` and just rewrites
  the lib file (§7.9 step 6). This replaces rev 2's reset-then-merge, which made false copies.

**Should-fix:**

1. A downloaded run keeps `owner = meta.synced.from`.
2. Tombstone GC accepts "no entry for the key and written after *T*" as an acknowledgement, which
   ends the mutual-waiting leak. A leftover tombstone would be a harmless ~200 B (§7.9 step 3).
3. Definition `runIds` are filtered against local runs ∪ stubs, for display and the Library count
   (S5b).
4. `displayNameAt` ties are broken by the entry HLC.
5. Batons:
   - The Test sign-in row moves into S4's Account card. S3 implements only `testSignIn()`, so S4 is
     the only wave-2 holder of the `Settings/index.tsx` baton.
   - The CSP-violation check goes in `tests/e2e/helpers.ts`, which all 14 specs already import;
     S0 owns it by baton, and no spec needs editing.

**Nits:**

- `src/oauth/return.ts` imports nothing from `src/app/`; S0 adds the boundary edge.
- D23's gate covers the popup, the redirect round trip, and Reconnect after expiry (an "Expire
  token now" button).
- GC step 5 re-uploads a bundle when our upload was skipped but the remote stub's file is missing.

### Rev 2 (PR #36 review)

**Blocking:**

- **B1:**
  - entries carry `basis` and a per-key `vv`;
  - two entries are concurrent when neither descends from the other;
  - the winner is the edit over a delete, otherwise the higher HLC;
  - the loser becomes a deterministic copy, made once;
  - RECHECK re-lists and re-pulls before the lib write;
  - the fuzz runs at remote-call granularity;
  - the prototype has a merge model and tests for the exact race.
- **B2:** S0 owns `update` on both backends and the `strictBackend` touch.
- **B3:**
  - only done runs get bundles; paused, cancelled and errored runs are stubs, and "continued
    supersedes" is gone;
  - `encodeRunBundleWithDigest` exposes the digest;
  - a field-by-field `RunMeta` rebuild table.
- **B4:**
  - groups use whole-record LWW, never a union;
  - definition `runIds` are sorted;
  - `RunRow` and `listRunRows()` are added, and every `listRuns()` consumer is in S5b;
  - Sweep reuses remote runs.
- **B5:**
  - `displayName` merges by `displayNameAt`;
  - HLCs are minted from the edit time;
  - unknown keys are preserved;
  - `RunStub` has no name;
  - the byte-identity and sha-reuse claims are dropped, and reuse is keyed by runId + digest.
- **B6:**
  - shared imported runs have no owner;
  - the upload is skipped when the remote already has the digest;
  - a GC keep rule.

**Should-fix:**

1. Auth:
   - redirect by default on Android standalone;
   - a timeout on `acquire`;
   - redirect state in localStorage;
   - the implicit-flow note;
   - the Test sign-in gate (D23).
2. The token is stored in localStorage, and there is no nag when nothing is pending.
3. Per-type fingerprints that exclude `updatedAt`.
4. Our own entries are ordered, and a strategy copy recomputes its hash.
5. Tombstone GC uses age plus acknowledgement; a missing own lib file triggers a re-seed.
6. Dry runs and benchmark runs are excluded.
7. First sync and Replace wait while a run is active.
8. Tooling:
   - `oauth-return` is a Vite entry;
   - the fakes are typed and live in `tests/e2e/fakes`;
   - `*.local` is gitignored.
9. The CSP lands in S0, and the full e2e suite runs under it.
10. Splits and edges:
    - S2 becomes S2a, S2b and S2c, and S5 becomes S5a and S5b;
    - the `money` edge is removed.
11. `sink.test.ts` and the other hard-coded store counts are in S1.
12. Dirty marks are broadcast to the lock holder.

**Nits:**

- trimmed-bundle verification (§7.6);
- GC re-upload, consistent with §7.6 and §9 (§7.9 step 5);
- `pace` only seeds the defaults of new drafts (D15);
- an old tab, or a rolled-back build, meeting v3 gets `VersionError`, falls back to memory, and sync
  is disabled (§7.13).
