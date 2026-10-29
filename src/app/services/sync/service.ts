// The sync app service (sync.md §4.5, §7.10, §7.11, §8, §9): the engine on the tracked backend, the
// Drive client and the auth flow, plus everything that decides WHEN to sync: triggers, the Web Lock,
// the cross-tab channel, backoff, the status store, account binding and the first-sync flow.
//
// It is a factory over an environment (`SyncEnv`) so a test can run two "tabs" in one process, each
// with its own stores, over a shared lock, channel bus, fake Drive and fake GIS. `index.ts` builds
// the app's singleton from the real environment.
//
// Gesture rule: `signIn`, `reconnect`, `syncNow`, `removeDriveData` and `downloadAllRemote` start
// their `auth.acquire` synchronously, before any `await`, so a popup opens inside the click.
import {
  RemoteError,
  createSyncEngine,
  type Backend,
  type ConflictNotice,
  type CycleResult,
  type DefinitionRecord,
  type FirstSyncPreview,
  type RemoteStore,
  type RunMeta,
  type RunStub,
  type SyncAbout,
  type SyncAccountRecord,
  type SyncDeviceInfo,
  type SyncDevicePrefs,
  type SyncEngine,
  type SyncErrorCode,
  type SyncIndexRecord,
  type SyncKey,
  type SyncKind,
  type SyncProgress,
  type SyncStatus,
  type TrackedBackend,
  type AuthState,
} from '@core';
import { createStore, type Store } from '../../state/store';
import type { DriveOptions } from './drive';
import type { AuthFlow } from './flow';
import { AuthError } from './gis';
import { backoffDelay, QUOTA_RETRY_MS } from './backoff';
import type { SyncChannel, SyncMessage } from './channel';
import type { SyncLock } from './lock';
import { defaultPrefs, loadPrefs, savePrefs, type DeviceTraits } from './prefs';

// ------------------------------------------------------------------ constants

export const DEBOUNCE_MS = 5_000;
export const DEBOUNCE_MAX_MS = 30_000;
export const START_DELAY_MS = 3_000;
export const VISIBLE_AFTER_MS = 60_000;
export const INTERVAL_MS = 300_000;
export const RUN_DONE_DELAY_MS = 10_000;
export const CONTINUE_DELAY_MS = 10_000;
export const MAX_RETRY_AFTER_MS = 3_600_000;
/** A cycle that starts with less than this much token left skips bundle uploads (§5.2). */
export const UPLOAD_MIN_TOKEN_MS = 600_000;
/** How long a sign-in marker (set before a possible redirect) stays valid. */
export const SIGNIN_TTL_MS = 10 * 60_000;
export const SIGNIN_KEY = 'spinner:sync:signin';
/** `Download all` needs this much free space per byte it downloads (§7.12). */
export const DOWNLOAD_ALL_HEADROOM = 1.5;
/** A mirrored "syncing" from another tab expires after this long without news. */
const ELSEWHERE_TTL_MS = 90_000;
/** Drive info is read at most this often... */
const INFO_THROTTLE_MS = 5_000;
/** ...and, when no cycle moved data, at most this often. */
const INFO_TTL_MS = 60_000;
const STATUS_THROTTLE_MS = 300;

export type Trigger =
  | 'start'
  | 'visible'
  | 'dirty'
  | 'interval'
  | 'online'
  | 'now'
  | 'run-done'
  | 'backoff'
  | 'continue'
  | 'sign-in'
  | 'reconnect'
  | 'prefs';

// ------------------------------------------------------------------ stores

export interface SyncStores {
  syncStatus: Store<SyncStatus>;
  syncAuth: Store<AuthState>;
  conflictNotices: Store<ConflictNotice[]>;
  syncPrefs: Store<SyncDevicePrefs>;
  firstSyncPrompt: Store<FirstSyncPreview | null>;
  syncDevices: Store<SyncDeviceInfo[]>;
  syncAbout: Store<SyncAbout | null>;
  accountSwitchPrompt: Store<{ from: string; to: string } | null>;
  /** Why the last first sync / Replace did not start (e.g. "Nothing was deleted"); shown in the sheet. */
  firstSyncError: Store<string | null>;
  /** Why the last sign-in or Reconnect failed; null when it did not. */
  signInError: Store<string | null>;
  /** True once the popup failed in a way the redirect fixes: show "Sign in in this window". */
  signInRedirectOffer: Store<boolean>;
  /** True while another tab holds the sync lock: "Syncing in another tab". */
  syncElsewhere: Store<boolean>;
  /** This device's id ('' until it has one): the Account card marks "(this device)" by it. */
  syncDeviceId: Store<string>;
}

export function createSyncStores(): SyncStores {
  return {
    syncStatus: createStore<SyncStatus>({
      state: 'off',
      pending: 0,
      remoteOnly: { runs: 0, bytes: 0 },
      conflicts: 0,
    }),
    syncAuth: createStore<AuthState>({ state: 'unconfigured' }),
    conflictNotices: createStore<ConflictNotice[]>([]),
    syncPrefs: createStore<SyncDevicePrefs>({
      enabled: false,
      deviceName: '',
      runDownload: 'onOpen',
    }),
    firstSyncPrompt: createStore<FirstSyncPreview | null>(null),
    syncDevices: createStore<SyncDeviceInfo[]>([]),
    syncAbout: createStore<SyncAbout | null>(null),
    accountSwitchPrompt: createStore<{ from: string; to: string } | null>(null),
    firstSyncError: createStore<string | null>(null),
    signInError: createStore<string | null>(null),
    signInRedirectOffer: createStore(false),
    syncElsewhere: createStore(false),
    syncDeviceId: createStore(''),
  };
}

// ------------------------------------------------------------------ environment

export interface SyncEnv {
  stores: SyncStores;
  auth: AuthFlow;
  /** Opens the store; null on the memory backend or the in-memory repo (sync stays off). */
  backend(): Promise<TrackedBackend | null>;
  makeRemote(o: {
    token: () => string | null;
    sessions: NonNullable<DriveOptions['sessions']>;
  }): RemoteStore;
  lock: SyncLock;
  channel: SyncChannel;
  /** Distinguishes this tab's messages from the others'. */
  tabId: string;
  now(): number;
  /** `document.visibilityState === 'visible'`. */
  visible(): boolean;
  online(): boolean;
  traits(): DeviceTraits;
  isRunActive(runId?: string): boolean;
  onRunChange(
    fn: (e: { runId: string; status: RunMeta['status']; active: boolean }) => void,
  ): () => void;
  describeRun(meta: RunMeta): Promise<RunStub['verdict'] | undefined>;
  isDryRun(def: DefinitionRecord): boolean;
  /** Re-reads what a cycle may have changed (library, layouts, runs, settings) and drops caches. */
  refresh(kinds: SyncKind[]): void;
  notify(message: string, action?: { label: string; onClick: () => void }): void;
  storageEstimate(): Promise<{ usage: number; quota: number | null }>;
  appVersion: string;
  coreVersion: string;
  gameId: string;
  random?: () => number;
  /** localStorage for the sign-in marker; default `globalThis.localStorage`. */
  storage?: Storage | undefined;
}

export interface SyncService {
  stores: SyncStores;
  /** Wires the listeners and loads the state. Idempotent. Resolves when the state is loaded. */
  start(): Promise<void>;
  /** Removes every listener and timer (tests; the app never stops it). */
  stop(): void;
  signIn(opts?: { mode?: 'auto' | 'popup' | 'redirect' }): Promise<void>;
  reconnect(): Promise<void>;
  syncNow(): Promise<void>;
  chooseFirstSync(c: 'merge' | 'replace' | 'cancel'): Promise<void>;
  chooseAccountSwitch(c: 'sync' | 'cancel'): Promise<void>;
  signOut(): Promise<void>;
  removeDriveData(): Promise<void>;
  setPrefs(p: Partial<SyncDevicePrefs>): Promise<void>;
  remoteRun(runId: string): Promise<RunStub | null>;
  listRemoteRuns(): Promise<RunStub[]>;
  downloadRun(
    runId: string,
    onProgress?: (doneBytes: number, totalBytes: number) => void,
    signal?: AbortSignal,
  ): Promise<'ok' | 'missing' | 'corrupt' | 'offline' | 'needs-auth'>;
  downloadAllRemote(
    onProgress?: (doneBytes: number, totalBytes: number) => void,
    signal?: AbortSignal,
  ): Promise<{ done: number; skipped: number }>;
  evictRun(runId: string): Promise<void>;
  markConflictsRead(): void;
  /** Reads Drive's account/storage and the device list into their stores (throttled). */
  refreshAccountInfo(force?: boolean): Promise<void>;
}

type TimerName =
  | 'info'
  | 'flushDirty'
  | 'dirty'
  | 'backoff'
  | 'start'
  | 'interval'
  | 'runDone'
  | 'continue'
  | 'expiry'
  | 'elsewhere';

type Phase =
  'idle' | 'syncing' | 'offline' | 'backoff' | 'drive-full' | 'local-full' | 'needs-auth' | 'error';

const NOTHING: CycleResult = {
  outcome: 'off',
  requests: 0,
  pushed: 0,
  applied: 0,
  copies: 0,
  changed: [],
};
const busyResult = (): CycleResult => ({ ...NOTHING, outcome: 'busy' });
const iso = (ms: number): string => new Date(ms).toISOString();
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The HALT codes stop automatic syncing until the user acts (sign in, update, ...). */
const HALT_CODES: readonly SyncErrorCode[] = [
  'newer-layout',
  'access-removed',
  'account-mismatch',
  'erased',
];

export function createSyncService(env: SyncEnv): SyncService {
  const { stores, auth } = env;
  const rnd = env.random ?? Math.random;

  // ---- state
  let started: Promise<void> | null = null;
  let stopped = false;
  let backend: TrackedBackend | null = null;
  let raw: Backend | null = null;
  let disabled = false;
  let prefs: SyncDevicePrefs = defaultPrefs(env.traits());
  let account: SyncAccountRecord | undefined;
  let lastSynced: string | undefined; // the `last` meta (ISO) or the last cycle this tab saw
  let hasLast = false;
  let pending = 0;
  let remoteOnly = { runs: 0, bytes: 0 };
  let unread = 0;
  let phase: Phase = 'idle';
  let halt: { code: SyncErrorCode; message: string } | null = null;
  let phaseError: { code: SyncErrorCode; message: string } | undefined;
  let retryAt: number | undefined;
  let progress: SyncProgress | undefined;
  let attempts = 0;
  let holding = false; // this tab holds the lock and is running a cycle
  let running: Promise<CycleResult> | null = null;
  let rerun = false;
  let dirtyDuringCycle = false;
  let owedDirty = false;
  let firstDirtyAt: number | null = null;
  let lastCycleAt = 0;
  let lastInfoAt = 0;
  /** The Account card has asked for the Drive info in this page: keep it fresh after cycles. */
  let infoWanted = false;
  /** A cycle moved data since the info was read: the next read must not be skipped. */
  let infoStale = true;
  let lastSeenSig = '';
  let lastStatusPost = 0;
  let clockSkewDevice: string | undefined;
  let lastRemoteErr: RemoteError | null = null;
  let verified: { token: string; accountId: string } | null = null;
  let lastAbout: SyncAbout | null = null;
  let epoch = 0;
  /** A sign-in step or first sync that waits for the active run to finish. */
  let waitingFirst: null | (() => Promise<void>) = null;
  /** The account the sign-in is about; kept while a sheet is open. */
  let candidate: { accountId: string; email: string } | null = null;
  let engineRef: SyncEngine | null = null;
  let controller: AbortController | null = null;
  const timers: Partial<Record<TimerName, ReturnType<typeof setTimeout>>> = {};
  const offs: (() => void)[] = [];

  // ---- timers
  const clear = (k: TimerName): void => {
    const t = timers[k];
    if (t !== undefined) {
      if (k === 'interval') clearInterval(t);
      else clearTimeout(t);
      delete timers[k];
    }
  };
  const after = (k: TimerName, ms: number, fn: () => void): void => {
    clear(k);
    timers[k] = setTimeout(() => {
      delete timers[k];
      fn();
    }, ms);
  };

  // ---- storage helpers
  const local = (): Storage | undefined => {
    try {
      return env.storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
    } catch {
      return undefined;
    }
  };
  const markSignIn = (): void => {
    try {
      local()?.setItem(SIGNIN_KEY, String(env.now()));
    } catch {
      // storage blocked
    }
  };
  const clearSignInMark = (): void => {
    try {
      local()?.removeItem(SIGNIN_KEY);
    } catch {
      // storage blocked
    }
  };
  const signInMarked = (): boolean => {
    try {
      const at = Number(local()?.getItem(SIGNIN_KEY));
      return Number.isFinite(at) && at > 0 && env.now() - at < SIGNIN_TTL_MS;
    } catch {
      return false;
    }
  };

  const metaOf = async <T>(k: string): Promise<T | undefined> =>
    (await raw?.get<{ k: string; v: T }>('syncMeta', k))?.v;
  const putMeta = async (k: string, v: unknown): Promise<void> => {
    await raw!.tx(['syncMeta'], 'readwrite', (t) => t.put('syncMeta', { k, v }));
  };
  const delMeta = async (k: string): Promise<void> => {
    await raw!.tx(['syncMeta'], 'readwrite', (t) => t.delete('syncMeta', k));
  };

  // ---- the engine
  /** Records the latest `RemoteError` (its `Retry-After`) so backoff can honour it. */
  function observe(r: RemoteStore): RemoteStore {
    const w =
      <A extends unknown[], T>(f: (...a: A) => Promise<T>) =>
      async (...a: A): Promise<T> => {
        try {
          return await f(...a);
        } catch (e) {
          if (e instanceof RemoteError) lastRemoteErr = e;
          throw e;
        }
      };
    return {
      kind: r.kind,
      list: w((o) => r.list(o)),
      download: w((id, o) => r.download(id, o)),
      create: w((n, b, o) => r.create(n, b, o)),
      update: w((id, b, o) => r.update(id, b, o)),
      delete: w((id, o) => r.delete(id, o)),
      about: w(() => r.about()),
    };
  }
  const remote = (): RemoteStore =>
    observe(
      env.makeRemote({
        token: () => auth.source.current(),
        sessions: {
          async get(k) {
            return (await metaOf<Record<string, string>>('uploads'))?.[k];
          },
          async set(k, uri) {
            await raw!.update(['syncMeta'], async (r, w) => {
              const row = await r.get<{ k: 'uploads'; v: Record<string, string> }>(
                'syncMeta',
                'uploads',
              );
              const v = { ...(row?.v ?? {}) };
              if (uri === undefined) delete v[k];
              else v[k] = uri;
              w.put('syncMeta', { k: 'uploads', v });
            });
          },
        },
      }),
    );
  function engine(): SyncEngine {
    if (!engineRef) {
      controller = new AbortController();
      engineRef = createSyncEngine({
        backend: backend!,
        remote: remote(),
        now: () => env.now(),
        appVersion: env.appVersion,
        coreVersion: env.coreVersion,
        gameId: env.gameId,
        deviceName: () => prefs.deviceName,
        describeRun: (m) => env.describeRun(m),
        isDryRun: (d) => env.isDryRun(d),
        isRunActive: (id) => env.isRunActive(id),
        onProgress: onEngineProgress,
        signal: controller.signal,
      });
    }
    return engineRef;
  }
  /** Drops the engine; an in-flight call is aborted and its result ignored (`epoch`). */
  function dropEngine(): void {
    epoch++;
    controller?.abort();
    controller = null;
    engineRef = null;
  }

  // ---- status
  const unreadOf = (n: ConflictNotice[]): number => n.filter((x) => !x.read).length;

  function compute(): SyncStatus {
    const email =
      account?.email ??
      (stores.syncAuth.get().state === 'signed-in' || stores.syncAuth.get().state === 'expired'
        ? (stores.syncAuth.get() as { email: string }).email
        : undefined);
    const base = {
      pending,
      remoteOnly,
      conflicts: unread,
      ...(email ? { email } : {}),
      ...(lastSynced ? { lastSyncedAt: lastSynced } : {}),
      ...(clockSkewDevice ? { clockSkewDevice } : {}),
    };
    if (disabled) return { ...base, state: 'off', pending: 0, disabledReason: 'memory-backend' };
    if (waitingFirst) return { ...base, state: 'waiting-run' };
    if (halt) return { ...base, state: 'error', error: halt };
    if (!prefs.enabled) return { ...base, state: 'off' };
    const a = stores.syncAuth.get().state;
    if (phase !== 'syncing' && (a === 'expired' || a === 'signed-out' || phase === 'needs-auth'))
      return { ...base, state: 'needs-auth' };
    switch (phase) {
      case 'syncing':
        return { ...base, state: 'syncing', ...(progress ? { progress } : {}) };
      case 'backoff':
        return { ...base, state: 'backoff', ...(retryAt !== undefined ? { retryAt } : {}) };
      case 'offline':
      case 'drive-full':
        return { ...base, state: phase, ...(phaseError ? { error: phaseError } : {}) };
      case 'local-full':
        return {
          ...base,
          state: 'local-full',
          error: phaseError ?? { code: 'local-full', message: 'This device is out of space.' },
        };
      case 'error':
        return {
          ...base,
          state: 'error',
          error: phaseError ?? { code: 'unknown', message: 'Sync hit a problem.' },
        };
      default:
        return { ...base, state: 'idle' };
    }
  }

  function publish(): void {
    const s = compute();
    stores.syncStatus.set(s);
    if (holding) {
      // The lock holder tells the other tabs (progress is throttled, state changes are not).
      const t = env.now();
      const quiet = s.state === 'syncing' && lastPostedState === 'syncing';
      if (!quiet || t - lastStatusPost >= STATUS_THROTTLE_MS) {
        lastStatusPost = t;
        lastPostedState = s.state;
        env.channel.post({ type: 'status', from: env.tabId, status: s });
      }
    }
  }
  let lastPostedState: SyncStatus['state'] | null = null;

  function onEngineProgress(p: SyncProgress): void {
    progress = p;
    if (phase === 'syncing') publish();
  }

  // ---- local reads
  async function refreshLocal(): Promise<void> {
    if (!raw) return;
    try {
      pending = (await raw.getAllKeys('syncDirty')).length;
      const rows = await raw.getAll<SyncIndexRecord>('syncIndex');
      const only = rows.filter(
        (r) =>
          r.kind === 'run' &&
          r.local === 0 &&
          !r.entry.deleted &&
          (r.entry.value as RunStub | null)?.status === 'done' &&
          (r.entry.value as RunStub | null)?.bundle,
      );
      remoteOnly = {
        runs: only.length,
        bytes: only.reduce((n, r) => n + ((r.entry.value as RunStub).bundle?.bytes ?? 0), 0),
      };
      const notices = (await metaOf<ConflictNotice[]>('conflicts')) ?? [];
      unread = unreadOf(notices);
      stores.conflictNotices.set([...notices].reverse());
      // another device wrote its library (even an empty one): the device list is out of date
      const seenSig = JSON.stringify((await metaOf<Record<string, string>>('seen')) ?? {});
      if (seenSig !== lastSeenSig) {
        lastSeenSig = seenSig;
        infoStale = true;
      }
      const last = await metaOf<string>('last');
      hasLast = last !== undefined;
      if (last) lastSynced = last;
      const dev = await metaOf<{ id: string }>('device');
      if (dev && stores.syncDeviceId.get() !== dev.id) stores.syncDeviceId.set(dev.id);
    } catch {
      // the store failed; the next event reads again
    }
  }
  async function reloadMeta(): Promise<void> {
    if (!raw) return;
    prefs = await loadPrefs(raw, env.traits());
    stores.syncPrefs.set(prefs);
    account = await metaOf<SyncAccountRecord>('account');
    await refreshLocal();
  }

  // ---- cycle
  const online = (): boolean => env.online();

  /** Backoff and quota waits hold back the automatic triggers; Sync now and `online` do not. */
  function gated(reason: Trigger): boolean {
    if (reason === 'now' || reason === 'backoff' || reason === 'sign-in' || reason === 'reconnect')
      return false;
    if (phase === 'error' && reason !== 'start') return true; // needs Sync now or a restart
    return (
      (phase === 'backoff' || phase === 'drive-full' || phase === 'local-full') &&
      retryAt !== undefined &&
      env.now() < retryAt
    );
  }

  const ready = (): boolean => !stopped && !disabled && !!raw && prefs.enabled && hasLast && !halt;

  /** Fire-and-forget for timers and events: a failure here must never be an unhandled rejection. */
  const fireCycle = (reason: Trigger, force = false): void =>
    void cycle(reason, force).catch(() => undefined);

  function schedule(k: 'backoff' | 'continue', ms: number, reason: Trigger): void {
    after(k, ms, () => void fireCycle(reason));
  }

  async function verifyAccount(token: string): Promise<boolean> {
    if (!account) return true;
    if (verified?.token === token) return verified.accountId === account.accountId;
    const about = await remote().about();
    verified = { token, accountId: about.accountId };
    lastAbout = { ...about, deviceBytes: lastAbout?.deviceBytes ?? 0 };
    return about.accountId === account.accountId;
  }

  /** The one cycle path. `force` is a user gesture (Sync now, sign-in): not gated, not hidden-checked. */
  async function cycle(reason: Trigger, force = false): Promise<CycleResult | null> {
    if (!ready()) return null;
    if (!force) {
      if (!env.visible()) return null;
      if (gated(reason)) return null;
    }
    if (running) {
      rerun = true;
      return reason === 'now' ? running : null;
    }
    if (!online()) {
      phase = 'offline';
      phaseError = { code: 'network', message: 'You are offline.' };
      publish();
      return { ...NOTHING, outcome: 'offline' };
    }
    const token = auth.source.current();
    if (!token) {
      phase = 'needs-auth';
      publish();
      return { ...NOTHING, outcome: 'needs-auth' };
    }
    running = doCycle(reason, token).finally(() => {
      running = null;
    });
    const res = await running;
    if (rerun) {
      rerun = false;
      if (res.outcome === 'ok') after('continue', 0, () => void fireCycle('continue'));
    }
    return res;
  }

  async function doCycle(reason: Trigger, token: string): Promise<CycleResult> {
    const mine = epoch;
    clear('backoff');
    clear('continue');
    lastRemoteErr = null;
    dirtyDuringCycle = false;
    const out = await env.lock.run(async () => {
      holding = true;
      try {
        phase = 'syncing';
        progress = undefined;
        phaseError = undefined;
        stores.syncElsewhere.set(false);
        publish();
        try {
          if (!(await verifyAccount(token))) {
            const why = 'This device is linked to a different Google account.';
            void auth.source.revoke();
            return {
              ...NOTHING,
              outcome: 'error',
              error: { code: 'account-mismatch', message: why },
            } satisfies CycleResult;
          }
          const exp = auth.source.state;
          const short =
            exp.state === 'signed-in' && exp.expiresAt - env.now() < UPLOAD_MIN_TOKEN_MS;
          return await engine().cycle({ uploadRuns: !short });
        } catch (e) {
          const auth401 = e instanceof RemoteError && e.code === 'auth';
          const failed: CycleResult = {
            ...NOTHING,
            outcome: auth401
              ? 'needs-auth'
              : e instanceof RemoteError && e.code === 'network'
                ? 'offline'
                : 'error',
            error: {
              code: auth401
                ? 'auth'
                : e instanceof RemoteError && e.code === 'network'
                  ? 'network'
                  : 'unknown',
              message: errMsg(e),
            },
          };
          return failed;
        }
      } finally {
        // settle below, still `holding`, so the final status reaches the other tabs
      }
    });
    if (!out.held) {
      // Another tab is syncing: mirror it, and say so on Sync now (§9).
      stores.syncElsewhere.set(true);
      phase = prefs.enabled ? 'idle' : phase;
      publish();
      holding = false;
      return busyResult();
    }
    const result = out.value;
    try {
      if (mine === epoch) await settle(result, reason);
    } finally {
      holding = false;
    }
    return result;
  }

  async function settle(r: CycleResult, reason: Trigger): Promise<void> {
    lastCycleAt = env.now();
    progress = undefined;
    const ok = r.outcome === 'ok' || r.outcome === 'timeout';
    if (ok) {
      attempts = 0;
      retryAt = undefined;
      phase = 'idle';
      phaseError = undefined;
      lastSynced = iso(env.now());
      if (r.outcome === 'timeout') schedule('continue', CONTINUE_DELAY_MS, 'continue');
    } else {
      applyFailure(r);
    }
    await refreshLocal();
    if (r.changed.length > 0) env.refresh(r.changed);
    if (r.copies > 0 && ok) {
      env.notify(
        r.copies === 1
          ? 'An item was changed on two devices; both versions were kept.'
          : `${r.copies} items were changed on two devices; both versions were kept.`,
        { label: 'View', onClick: () => void (location.hash = '#/settings?account=1&notices=1') },
      );
    }
    publish();
    env.channel.post({ type: 'changed', from: env.tabId, kinds: r.changed });
    // the Account card shows Drive's usage and the devices: keep them fresh once it has asked
    if (ok && (r.pushed > 0 || r.applied > 0)) infoStale = true;
    if (ok && infoWanted && infoStale) void refreshInfo(false);
    // Edits made while the cycle ran stay marked: look again.
    if (ok && dirtyDuringCycle && reason !== 'start') scheduleDirty();
  }

  function applyFailure(r: CycleResult): void {
    const code = r.error?.code ?? 'unknown';
    const message = r.error?.message ?? 'Sync failed.';
    phaseError = { code, message };
    if (r.outcome === 'needs-auth' || code === 'auth') {
      phase = 'needs-auth';
      // the server refused a token that looked valid: treat it as expired so Reconnect gets a new one
      if (auth.source.current()) auth.source.expireNow();
      return;
    }
    if (r.outcome === 'offline') {
      phase = 'offline';
      return;
    }
    if (r.outcome === 'waiting-run') {
      phase = 'idle';
      return;
    }
    if (r.outcome === 'off') {
      if (code === 'erased') {
        halt = { code: 'erased', message };
        void disableSync();
      } else void reloadMeta();
      return;
    }
    // outcome 'error' (a `rate` or `server` error arrives here as code 'network')
    if (HALT_CODES.includes(code)) {
      halt = { code, message };
      return;
    }
    if (code === 'network') {
      const retryAfter = lastRemoteErr?.retryAfterMs;
      const delay = Math.min(
        backoffDelay(attempts, { retryAfterMs: retryAfter, random: rnd }),
        MAX_RETRY_AFTER_MS,
      );
      attempts++;
      retryAt = env.now() + delay;
      phase = 'backoff';
      schedule('backoff', delay, 'backoff');
      return;
    }
    if (code === 'quota') {
      phase = 'drive-full';
      retryAt = env.now() + QUOTA_RETRY_MS;
      schedule('backoff', QUOTA_RETRY_MS, 'backoff');
      return;
    }
    if (code === 'local-full') {
      phase = 'local-full';
      retryAt = env.now() + QUOTA_RETRY_MS;
      schedule('backoff', QUOTA_RETRY_MS, 'backoff');
      if (prefs.runDownload === 'all') {
        prefs = { ...prefs, runDownload: 'onOpen' };
        stores.syncPrefs.set(prefs);
        void savePrefs(raw!, prefs);
        env.notify('This device is out of space. Runs now download only when you open them.');
      }
      return;
    }
    phase = 'error';
  }

  // ---- triggers
  async function pendingCount(): Promise<number> {
    try {
      return (await raw?.getAllKeys('syncDirty'))?.length ?? 0;
    } catch {
      return 0;
    }
  }

  function scheduleDirty(): void {
    if (!ready()) return;
    const t = env.now();
    firstDirtyAt ??= t;
    const wait = Math.max(0, Math.min(DEBOUNCE_MS, firstDirtyAt + DEBOUNCE_MAX_MS - t));
    after('dirty', wait, () => {
      firstDirtyAt = null;
      if (!env.visible()) {
        owedDirty = true; // a hidden tab never syncs; the next visible moment does
        return;
      }
      void (async () => {
        // Another tab may have pushed these marks already.
        if ((await pendingCount()) === 0) return;
        await cycle('dirty');
      })();
    });
  }

  /** Dirty marks made here, batched: one broadcast and one pending-count read per quiet 250 ms. */
  const dirtyBatch = new Set<SyncKey>();
  function onLocalDirty(keys: SyncKey[]): void {
    if (disabled || !prefs.enabled) return;
    pending = Math.max(pending, 1);
    if (!holding) publish();
    for (const k of keys) dirtyBatch.add(k);
    if (running) dirtyDuringCycle = true;
    if (!timers.flushDirty) {
      after('flushDirty', 250, () => {
        const batch = [...dirtyBatch];
        dirtyBatch.clear();
        env.channel.post({ type: 'dirty', from: env.tabId, keys: batch });
        void pendingCount().then((n) => {
          pending = n;
          if (!holding) publish();
        });
      });
    }
    scheduleDirty();
  }

  function onMessage(m: SyncMessage): void {
    if (m.from === env.tabId || disabled || !raw) return;
    if (m.type === 'dirty') {
      // marks made in another tab: a tab that may sync picks them up (a running cycle looks again)
      if (running) dirtyDuringCycle = true;
      scheduleDirty();
      return;
    }
    if (m.type === 'changed') {
      void reloadMeta().then(() => {
        if (m.kinds.length > 0) env.refresh(m.kinds);
        if (!holding) publish();
      });
      return;
    }
    // status: mirror the lock holder
    if (holding) return;
    const s = m.status;
    stores.syncElsewhere.set(s.state === 'syncing');
    if (s.state === 'syncing') {
      phase = 'syncing';
      progress = s.progress;
      stores.syncStatus.set({ ...s, pending, conflicts: unread });
      // the holder may have been closed mid-cycle: do not mirror "syncing" for ever
      after('elsewhere', ELSEWHERE_TTL_MS, () => {
        stores.syncElsewhere.set(false);
        if (!holding && phase === 'syncing') phase = 'idle';
        publish();
      });
      return;
    }
    clear('elsewhere');
    if (phase === 'syncing') phase = 'idle';
    progress = undefined;
    if (s.lastSyncedAt) lastSynced = s.lastSyncedAt;
    lastCycleAt = env.now();
    // the other tab's verdict is ours too (backoff, offline...); the timers stay with the holder
    if (
      s.state === 'idle' ||
      s.state === 'offline' ||
      s.state === 'backoff' ||
      s.state === 'drive-full' ||
      s.state === 'local-full' ||
      s.state === 'error'
    ) {
      phase = s.state === 'idle' ? 'idle' : s.state;
      phaseError = s.error;
      retryAt = s.retryAt;
    }
    if (s.state === 'error' && s.error && HALT_CODES.includes(s.error.code)) halt = s.error;
    publish();
  }

  function onVisible(): void {
    if (!env.visible()) return;
    if (owedDirty) {
      owedDirty = false;
      scheduleDirty();
    }
    if (env.now() - lastCycleAt > VISIBLE_AFTER_MS) void fireCycle('visible');
  }
  function onOnline(): void {
    if (phase === 'offline') phaseError = undefined;
    void fireCycle('online');
  }
  function onOffline(): void {
    if (ready() && !running) {
      phase = 'offline';
      phaseError = { code: 'network', message: 'You are offline.' };
      publish();
    }
  }

  function startTimers(): void {
    if (!timers.interval && ready()) {
      timers.interval = setInterval(() => {
        if (env.visible()) void fireCycle('interval');
      }, INTERVAL_MS);
    }
  }
  function stopTimers(): void {
    for (const k of Object.keys(timers) as TimerName[]) clear(k);
  }

  /** The token has no expiry event: re-evaluate the status when it lapses. */
  function armExpiry(): void {
    clear('expiry');
    const a = auth.source.state;
    if (a.state !== 'signed-in') return;
    const left = a.expiresAt - env.now() - 120_000 + 50;
    after('expiry', Math.max(50, Math.min(left, 2_147_000_000)), () => {
      stores.syncAuth.set(auth.source.state);
      publish();
      armExpiry();
    });
  }

  function onAuth(s: AuthState): void {
    const prev = stores.syncAuth.get();
    stores.syncAuth.set(s);
    armExpiry();
    if (s.state === 'signed-in' && prev.state !== 'signed-in') {
      // another tab signed in or the redirect returned: pick up where we left off
      if (phase === 'needs-auth' && !signingIn) {
        phase = 'idle';
        if (ready()) after('continue', 0, () => void fireCycle('reconnect'));
      }
    }
    publish();
  }
  let signingIn = false;

  // ---- sign-in
  const authFailure = (e: unknown): string => {
    if (e instanceof AuthError) {
      switch (e.code) {
        case 'popup-blocked':
          return 'The sign-in window was blocked.';
        case 'popup-closed':
          return 'Sign-in was cancelled.';
        case 'script':
          return "Couldn't reach Google. Check your connection and try again.";
        case 'run-active':
          return 'Finish or pause the run first.';
        default:
          return e.message;
      }
    }
    if (e instanceof RemoteError) {
      return e.code === 'network'
        ? "Couldn't reach Google Drive. Check your connection."
        : e.message;
    }
    return errMsg(e);
  };

  /** Starts the token request. Runs synchronously inside the click. */
  function acquire(mode: 'auto' | 'popup' | 'redirect', silent: boolean): Promise<string> {
    try {
      return mode === 'auto' ? auth.acquire(silent) : auth.acquireVia(mode, silent);
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  function signIn(opts: { mode?: 'auto' | 'popup' | 'redirect' } = {}): Promise<void> {
    stores.signInError.set(null);
    if (disabled) {
      stores.signInError.set('Sync needs storage that persists.');
      return Promise.resolve();
    }
    let acquiring: Promise<string> | null = null;
    if (!auth.source.current()) {
      markSignIn();
      acquiring = acquire(opts.mode ?? 'auto', auth.source.state.state === 'expired');
    }
    signingIn = true;
    return (async () => {
      try {
        if (acquiring) await acquiring; // never settles when the page navigates away
        clearSignInMark();
        await started;
        await finishSignIn();
      } catch (e) {
        clearSignInMark();
        stores.signInError.set(authFailure(e));
      } finally {
        signingIn = false;
        publish();
      }
    })();
  }

  /** The token is in hand: bind the account (§7.10), then the first-sync preview (§8.3) or a plain cycle. */
  async function finishSignIn(): Promise<void> {
    if (!raw) return;
    const r = remote();
    const about = await r.about();
    verified = { token: auth.source.current() ?? '', accountId: about.accountId };
    lastAbout = { ...about, deviceBytes: lastAbout?.deviceBytes ?? 0 };
    await reloadMeta();
    if (halt?.code === 'erased') {
      // Drive was erased from another device: this device starts over (§7.10 step 5)
      await withLock(() => engine().resetLocalSyncState());
      await delMeta('account');
      account = undefined;
      hasLast = false;
    }
    halt = null;
    candidate = { accountId: about.accountId, email: about.email };
    if (account && account.accountId !== about.accountId) {
      stores.accountSwitchPrompt.set({ from: account.email, to: about.email });
      publish();
      return;
    }
    if (account && hasLast) {
      // same account, already synced before (a sign-out kept everything): just switch it on
      prefs = { ...prefs, enabled: true };
      await savePrefs(raw, prefs);
      stores.syncPrefs.set(prefs);
      phase = 'idle';
      startTimers();
      publish();
      env.channel.post({ type: 'changed', from: env.tabId, kinds: [] });
      await cycle('sign-in', true);
      void refreshInfo(true);
      return;
    }
    await offerFirstSync();
  }

  /** Shows the first-sync sheet once no run is active. */
  async function offerFirstSync(): Promise<void> {
    if (env.isRunActive()) {
      waitingFirst = offerFirstSync;
      publish();
      return;
    }
    waitingFirst = null;
    try {
      const preview = await engine().preview();
      stores.firstSyncError.set(null);
      stores.firstSyncPrompt.set(preview);
    } catch (e) {
      handleOpFailure(e);
      stores.signInError.set(authFailure(e));
    }
    publish();
  }

  function handleOpFailure(e: unknown): void {
    if (e instanceof RemoteError && e.code === 'auth' && auth.source.current())
      auth.source.expireNow();
  }

  /** Runs `fn` under the sync lock; false when another tab holds it. */
  async function withLock<T>(
    fn: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false }> {
    const r = await env.lock.run(fn);
    return r.held ? { ok: true, value: r.value } : { ok: false };
  }

  const BUSY_MSG = 'Another tab is syncing. Try again in a moment.';

  async function chooseFirstSync(c: 'merge' | 'replace' | 'cancel'): Promise<void> {
    await started;
    if (c === 'cancel') {
      stores.firstSyncPrompt.set(null);
      stores.firstSyncError.set(null);
      candidate = null;
      publish();
      return;
    }
    if (!raw || !candidate) {
      stores.firstSyncPrompt.set(null);
      return;
    }
    stores.firstSyncError.set(null);
    await beginFirst(c);
  }

  /** Binds the account, switches sync on, runs `begin`; undoes the switch when it fails. */
  async function beginFirst(c: 'merge' | 'replace'): Promise<void> {
    if (env.isRunActive()) {
      stores.firstSyncPrompt.set(null);
      waitingFirst = () => beginFirst(c);
      publish();
      return;
    }
    waitingFirst = null;
    const cand = candidate;
    if (!cand || !raw) return;
    const mine = epoch;
    const before = { prefs, account };
    const bound: SyncAccountRecord = {
      accountId: cand.accountId,
      email: cand.email,
      boundAt: iso(env.now()),
    };
    prefs = { ...prefs, enabled: true };
    await savePrefs(raw, prefs);
    await putMeta('account', bound);
    account = bound;
    stores.syncPrefs.set(prefs);
    phase = 'syncing';
    progress = undefined;
    attempts = 0;
    const got: { res: CycleResult | null; failure: string | null } = { res: null, failure: null };
    const held = await env.lock.run(async () => {
      holding = true;
      publish();
      try {
        got.res = await engine().begin(c);
      } catch (e) {
        handleOpFailure(e);
        got.failure = authFailure(e);
      }
    });
    if (mine !== epoch) {
      holding = false;
      return;
    }
    if (!held.held) got.failure = BUSY_MSG;
    const r = got.res;
    try {
      if (!got.failure && r) {
        if (r.outcome === 'ok' || r.outcome === 'timeout') {
          stores.firstSyncPrompt.set(null);
          candidate = null;
          hasLast = true;
          await settle(r, 'sign-in');
          startTimers();
          void refreshInfo(true);
          return;
        }
        if (r.outcome === 'waiting-run') {
          // a run started between the sheet and the choice: keep the choice, run it when idle
          stores.firstSyncPrompt.set(null);
          await restore(before);
          waitingFirst = () => beginFirst(c);
          publish();
          return;
        }
        got.failure =
          r.outcome === 'offline'
            ? "You're offline. Try again when you're back online."
            : r.outcome === 'needs-auth'
              ? 'Sign-in expired. Reconnect and try again.'
              : (r.error?.message ?? 'Sync could not start.');
        if (r.outcome === 'needs-auth' && auth.source.current()) auth.source.expireNow();
      }
      // failed: the sheet stays open with the reason; sync stays off
      await restore(before);
      stores.firstSyncError.set(got.failure ?? 'Sync could not start.');
      await refreshLocal();
      publish();
    } finally {
      holding = false;
    }
  }

  /** Undoes `beginFirst`'s switch-on after a failure (the engine kept whatever it finished). */
  async function restore(b: {
    prefs: SyncDevicePrefs;
    account: SyncAccountRecord | undefined;
  }): Promise<void> {
    prefs = b.prefs;
    await savePrefs(raw!, prefs);
    stores.syncPrefs.set(prefs);
    account = b.account;
    if (b.account) await putMeta('account', b.account);
    else await delMeta('account');
    phase = 'idle';
  }

  async function chooseAccountSwitch(c: 'sync' | 'cancel'): Promise<void> {
    await started;
    stores.accountSwitchPrompt.set(null);
    if (c === 'cancel') {
      candidate = null;
      await auth.source.revoke();
      publish();
      return;
    }
    if (!raw || !candidate) return;
    // §7.10: reset this device's sync state (device id and counter stay), then a Merge
    const reset = await withLock(() => engine().resetLocalSyncState());
    if (!reset.ok) {
      stores.signInError.set(BUSY_MSG);
      return;
    }
    await delMeta('account');
    account = undefined;
    hasLast = false;
    prefs = { ...prefs, enabled: false };
    await savePrefs(raw, prefs);
    stores.syncPrefs.set(prefs);
    await refreshLocal();
    stores.syncAbout.set(null);
    stores.syncDevices.set([]);
    await beginFirst('merge');
    const err = stores.firstSyncError.get();
    if (err) {
      // no sheet is open for this path: say it where the Account card looks
      stores.signInError.set(err);
      stores.firstSyncError.set(null);
    }
  }

  function reconnect(): Promise<void> {
    stores.signInError.set(null);
    const acquiring = auth.source.current() ? null : acquire('auto', true);
    return (async () => {
      try {
        if (acquiring) await acquiring;
        phase = phase === 'needs-auth' ? 'idle' : phase;
        if (halt?.code === 'account-mismatch' || halt?.code === 'access-removed') halt = null;
        publish();
        await cycle('reconnect', true);
      } catch (e) {
        stores.signInError.set(authFailure(e));
      }
    })();
  }

  function syncNow(): Promise<void> {
    stores.signInError.set(null);
    const reconnecting = ready() && !auth.source.current() ? acquire('auto', true) : null;
    return (async () => {
      await started;
      if (reconnecting) {
        try {
          await reconnecting;
        } catch (e) {
          stores.signInError.set(authFailure(e));
          return;
        }
      }
      if (halt && halt.code !== 'access-removed') return;
      halt = null;
      attempts = 0;
      retryAt = undefined;
      clear('backoff');
      if (
        phase === 'error' ||
        phase === 'backoff' ||
        phase === 'drive-full' ||
        phase === 'local-full' ||
        phase === 'needs-auth'
      )
        phase = 'idle';
      await cycle('now', true);
    })();
  }

  async function disableSync(): Promise<void> {
    if (!raw) return;
    prefs = { ...prefs, enabled: false };
    await savePrefs(raw, prefs);
    stores.syncPrefs.set(prefs);
    stopTimers();
    armExpiry();
  }

  /** Revoke, switch sync off, forget the session. Local data and `syncIndex` stay (§5.5). */
  async function finishSignOut(o: { forgetAccount: boolean }): Promise<void> {
    dropEngine();
    running = null;
    waitingFirst = null;
    candidate = null;
    verified = null;
    stopTimers();
    stores.firstSyncPrompt.set(null);
    stores.accountSwitchPrompt.set(null);
    stores.firstSyncError.set(null);
    stores.signInError.set(null);
    halt = null;
    phase = 'idle';
    phaseError = undefined;
    retryAt = undefined;
    attempts = 0;
    await auth.source.revoke();
    if (raw) {
      prefs = { ...prefs, enabled: false };
      await savePrefs(raw, prefs);
      if (o.forgetAccount) {
        await delMeta('account');
        account = undefined;
      }
    }
    stores.syncPrefs.set(prefs);
    stores.syncAbout.set(null);
    stores.syncDevices.set([]);
    stores.syncElsewhere.set(false);
    await refreshLocal();
    publish();
    env.channel.post({ type: 'changed', from: env.tabId, kinds: [] });
  }

  const signOut = async (): Promise<void> => {
    await started;
    await finishSignOut({ forgetAccount: false });
  };

  async function removeDriveData(): Promise<void> {
    const reconnecting = !auth.source.current() ? acquire('auto', true) : null;
    await started;
    if (!raw) return;
    try {
      if (reconnecting) await reconnecting;
      const mine = epoch;
      const r = await withLock(async () => {
        holding = true;
        phase = 'syncing';
        progress = undefined;
        publish();
        try {
          await engine().eraseRemote();
        } finally {
          holding = false;
        }
      });
      if (mine !== epoch) return;
      if (!r.ok) {
        env.notify(BUSY_MSG);
        return;
      }
    } catch (e) {
      handleOpFailure(e);
      phase = 'idle';
      publish();
      env.notify(`Could not remove your data from Drive: ${authFailure(e)}`);
      return;
    }
    await finishSignOut({ forgetAccount: true });
    env.notify('Removed spinner data from your Google Drive. It stays on this device.');
  }

  async function setPrefs(p: Partial<SyncDevicePrefs>): Promise<void> {
    await started;
    if (!raw) return;
    const next: SyncDevicePrefs = { ...prefs, ...p };
    // Switching on is signIn's job (a first sync needs the sheet); never without a past sync.
    if (!hasLast || !account) next.enabled = false;
    if (typeof p.deviceName === 'string' && p.deviceName.trim() === '')
      next.deviceName = prefs.deviceName;
    const renamed = next.deviceName !== prefs.deviceName;
    prefs = next;
    await savePrefs(raw, prefs);
    stores.syncPrefs.set(prefs);
    if (!prefs.enabled) stopTimers();
    else startTimers();
    publish();
    env.channel.post({ type: 'changed', from: env.tabId, kinds: [] });
    if (renamed && ready()) void fireCycle('prefs');
  }

  // ---- runs on Drive
  async function indexRows(): Promise<SyncIndexRecord[]> {
    try {
      return (await raw?.getAll<SyncIndexRecord>('syncIndex')) ?? [];
    } catch {
      return [];
    }
  }
  async function remoteRun(runId: string): Promise<RunStub | null> {
    await started;
    const row = (await raw?.get<SyncIndexRecord>('syncIndex', `run:${runId}`)) ?? undefined;
    if (!row || row.entry.deleted || !row.entry.value) return null;
    return row.entry.value as RunStub;
  }
  async function listRemoteRuns(): Promise<RunStub[]> {
    await started;
    if (disabled || !raw || !prefs.enabled) return [];
    return engine().listRemoteRuns();
  }

  async function downloadRun(
    runId: string,
    onProgress?: (doneBytes: number, totalBytes: number) => void,
    signal?: AbortSignal,
  ): Promise<'ok' | 'missing' | 'corrupt' | 'offline' | 'needs-auth'> {
    await started;
    if (disabled || !raw) return 'missing';
    if (!online()) return 'offline';
    if (!auth.source.current()) return 'needs-auth';
    try {
      const r = await engine().downloadRun(runId, {
        ...(onProgress ? { onProgress } : {}),
        ...(signal ? { signal } : {}),
      });
      if (r === 'ok') {
        env.refresh(['run']);
        await refreshLocal();
        publish();
        env.channel.post({ type: 'changed', from: env.tabId, kinds: ['run'] });
      }
      return r;
    } catch (e) {
      if (e instanceof RemoteError) {
        if (e.code === 'network') return 'offline';
        if (e.code === 'auth') {
          if (auth.source.current()) auth.source.expireNow();
          return 'needs-auth';
        }
        if (e.code === 'not-found') return 'missing';
      }
      if (signal?.aborted) return 'missing';
      throw e;
    }
  }

  async function downloadAllRemote(
    onProgress?: (doneBytes: number, totalBytes: number) => void,
    signal?: AbortSignal,
  ): Promise<{ done: number; skipped: number }> {
    const reconnecting = !auth.source.current() ? acquire('auto', true) : null;
    await started;
    if (reconnecting) await reconnecting;
    if (disabled || !raw) return { done: 0, skipped: 0 };
    const rows = (await indexRows()).filter(
      (r) => r.kind === 'run' && !r.entry.deleted && (r.entry.value as RunStub | null)?.bundle,
    );
    const skipped = rows.filter((r) => r.local === 1).length;
    const todo = rows
      .filter((r) => r.local === 0)
      .map((r) => r.entry.value as RunStub)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const total = todo.reduce((n, s) => n + (s.bundle?.bytes ?? 0), 0);
    // Only what fits: free space must stay above 1.5 x what is downloaded (§7.12).
    const est = await env
      .storageEstimate()
      .catch(() => ({ usage: 0, quota: null as number | null }));
    const free = est.quota === null ? Infinity : est.quota - est.usage;
    let done = 0;
    let got = 0;
    let used = 0;
    let left = 0;
    for (const s of todo) {
      if (signal?.aborted) break;
      const bytes = s.bundle?.bytes ?? 0;
      if (used + bytes * DOWNLOAD_ALL_HEADROOM > free) {
        left++;
        continue;
      }
      const base = got;
      const r = await downloadRun(s.runId, (d) => onProgress?.(base + d, total), signal);
      if (r === 'offline' || r === 'needs-auth')
        throw new Error(r === 'offline' ? "You're offline." : 'Sign-in expired.');
      if (r === 'ok') {
        done++;
        used += bytes;
      }
      got += bytes;
      onProgress?.(got, total);
    }
    if (left > 0)
      env.notify(
        `Downloaded ${done} ${done === 1 ? 'run' : 'runs'}. ${left} more ${left === 1 ? "doesn't" : "don't"} fit on this device; they stay in Drive.`,
      );
    return { done, skipped };
  }

  async function evictRun(runId: string): Promise<void> {
    await started;
    if (disabled || !raw) return;
    await engine().evict(runId);
    env.refresh(['run']);
    await refreshLocal();
    publish();
    env.channel.post({ type: 'changed', from: env.tabId, kinds: ['run'] });
  }

  function markConflictsRead(): void {
    const next = stores.conflictNotices.get().map((n) => (n.read ? n : { ...n, read: true }));
    stores.conflictNotices.set(next);
    unread = 0;
    publish();
    if (!raw) return;
    void raw
      .update(['syncMeta'], async (r, w) => {
        const row = await r.get<{ k: 'conflicts'; v: ConflictNotice[] }>('syncMeta', 'conflicts');
        if (row) w.put('syncMeta', { k: 'conflicts', v: row.v.map((n) => ({ ...n, read: true })) });
      })
      .catch(() => undefined);
  }

  /** Called by the Account card when it opens (throttled). */
  async function refreshAccountInfo(force = false): Promise<void> {
    infoWanted = true;
    await refreshInfo(force);
  }

  async function refreshInfo(force: boolean): Promise<void> {
    await started;
    if (disabled || !raw || !prefs.enabled || !auth.source.current() || !online()) return;
    if (!force && !infoStale && env.now() - lastInfoAt < INFO_TTL_MS) return;
    if (!force && env.now() - lastInfoAt < INFO_THROTTLE_MS) {
      // too soon after the last read: read again just after the throttle
      after(
        'info',
        INFO_THROTTLE_MS - (env.now() - lastInfoAt) + 50,
        () => void refreshInfo(false),
      );
      return;
    }
    lastInfoAt = env.now();
    infoStale = false;
    try {
      const about = await remote().about();
      const est = await env.storageEstimate().catch(() => ({ usage: 0, quota: null }));
      lastAbout = { ...about, deviceBytes: est.usage };
      stores.syncAbout.set(lastAbout);
    } catch (e) {
      handleOpFailure(e);
    }
    try {
      const devs = await engine().devices();
      stores.syncDevices.set(devs);
      // a device whose clock is far from ours (the engine tolerates it; the card warns)
      const skew = devs.find(
        (d) =>
          Math.abs(Date.parse(d.lastSyncedAt) - env.now()) > 24 * 3_600_000 &&
          Date.parse(d.lastSyncedAt) > env.now(),
      );
      clockSkewDevice = skew?.name;
      publish();
    } catch (e) {
      handleOpFailure(e);
    }
  }

  // ---- start
  async function doStart(): Promise<void> {
    stores.syncAuth.set(auth.source.state);
    offs.push(auth.source.subscribe(onAuth));
    offs.push(auth.offerRedirect.subscribe((v) => stores.signInRedirectOffer.set(v)));
    stores.signInRedirectOffer.set(auth.offerRedirect.get());
    armExpiry();
    backend = await env.backend();
    if (!backend) {
      disabled = true;
      publish();
      return;
    }
    raw = backend.raw;
    await reloadMeta();
    // `enabled` without a finished first sync (a crash mid-begin) is not a state to resume
    if (prefs.enabled && !hasLast) await disableSync();
    offs.push(backend.onDirty(onLocalDirty));
    offs.push(env.channel.onMessage(onMessage));
    offs.push(
      env.onRunChange((e) => {
        if (e.active) return;
        // a run stopped: a waiting first sync goes on; a finished run uploads its bundle soon
        if (!env.isRunActive() && waitingFirst) {
          const go = waitingFirst;
          waitingFirst = null;
          void go();
        }
        if (e.status === 'done')
          after('runDone', RUN_DONE_DELAY_MS, () => void fireCycle('run-done'));
      }),
    );
    const doc = typeof document === 'undefined' ? undefined : document;
    const win = typeof window === 'undefined' ? undefined : window;
    doc?.addEventListener('visibilitychange', onVisible);
    win?.addEventListener('online', onOnline);
    win?.addEventListener('offline', onOffline);
    offs.push(() => {
      doc?.removeEventListener('visibilitychange', onVisible);
      win?.removeEventListener('online', onOnline);
      win?.removeEventListener('offline', onOffline);
    });
    publish();
    if (prefs.enabled) {
      startTimers();
      if (auth.source.current()) after('start', START_DELAY_MS, () => void fireCycle('start'));
    } else if (signInMarked() && auth.source.current()) {
      // back from the redirect (the installed app): finish the sign-in that started it
      clearSignInMark();
      signingIn = true;
      try {
        await finishSignIn();
      } catch (e) {
        stores.signInError.set(authFailure(e));
      } finally {
        signingIn = false;
        publish();
      }
    }
  }

  return {
    stores,
    start() {
      started ??= doStart().catch((e: unknown) => {
        // never reject from start: the app must come up without sync
        disabled = true;
        stores.syncStatus.set({
          state: 'off',
          pending: 0,
          remoteOnly: { runs: 0, bytes: 0 },
          conflicts: 0,
          disabledReason: 'memory-backend',
        });
        void e;
      });
      return started;
    },
    stop() {
      stopped = true;
      stopTimers();
      for (const o of offs.splice(0)) o();
      dropEngine();
      env.channel.close();
    },
    signIn,
    reconnect,
    syncNow,
    chooseFirstSync,
    chooseAccountSwitch,
    signOut,
    removeDriveData,
    setPrefs,
    remoteRun,
    listRemoteRuns,
    downloadRun,
    downloadAllRemote,
    evictRun,
    markConflictsRead,
    refreshAccountInfo,
  };
}
