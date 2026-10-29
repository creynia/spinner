// Harness for the sync app service tests: "tabs" of one browser profile (one IndexedDB, one
// localStorage, one Web Lock manager, one BroadcastChannel bus) over one fake Drive and the fake GIS.
// Each tab has its own stores, token source, tracked backend and service, like a real tab.
import { expect, vi } from 'vitest';
import {
  createMemoryBackend,
  createTrackedBackend,
  type Backend,
  type DefinitionRecord,
  type RunMeta,
  type RunStub,
  type SyncKind,
} from '@core';
import { createAuthFlow } from '../../../src/app/services/sync/flow';
import type { ChannelLike } from '../../../src/app/services/sync/channel';
import { createSyncChannel } from '../../../src/app/services/sync/channel';
import { createDriveStore } from '../../../src/app/services/sync/drive';
import { createGisTokenSource, resetGisLoaderForTest } from '../../../src/app/services/sync/gis';
import { createSyncLock, type LockLike } from '../../../src/app/services/sync/lock';
import {
  createSyncService,
  createSyncStores,
  type SyncEnv,
  type SyncService,
  type SyncStores,
} from '../../../src/app/services/sync/service';
import { createFakeDrive, isFakeToken, type FakeDrive, type GisFakeControls } from './fakes';
import { freshGis } from './helpers';

/** The real timers, captured before any `vi.useFakeTimers()`: used to let native work finish. */
const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const tick = (): Promise<void> => new Promise((r) => realSetTimeout(r, 1));

/** Lets promises, native crypto and fake-indexeddb-free memory work settle without moving the fake clock. */
export async function flush(rounds = 25): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await tick();
    await vi.advanceTimersByTimeAsync(0);
  }
}

/** Advances the fake clock in steps, letting work settle after each (a sleep that lets cycles run). */
export async function advance(ms: number, step = 1000): Promise<void> {
  let left = ms;
  while (left > 0) {
    const d = Math.min(step, left);
    left -= d;
    await vi.advanceTimersByTimeAsync(d);
    await flush(4);
  }
  await flush();
}

/** Waits (letting the fake clock stand still) until `cond` holds. */
export async function until(
  cond: () => boolean | Promise<boolean>,
  what = 'condition',
): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (await cond()) return;
    await tick();
    await vi.advanceTimersByTimeAsync(0);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// ---- shared infrastructure

export class FakeLocks implements LockLike {
  held = false;
  /** Number of requests that found the lock taken. */
  denied = 0;
  async request<T>(
    _name: string,
    _o: { ifAvailable: true },
    cb: (lock: unknown) => Promise<T>,
  ): Promise<T> {
    if (this.held) {
      this.denied++;
      return cb(null);
    }
    this.held = true;
    try {
      return await cb({ name: _name });
    } finally {
      this.held = false;
    }
  }
  query(): Promise<{ held: { name: string }[] }> {
    return Promise.resolve({ held: this.held ? [{ name: 'spinner:sync' }] : [] });
  }
}

/** BroadcastChannel semantics: a message reaches every OTHER channel on the bus, asynchronously. */
export class Bus {
  private chans = new Set<{ fns: Set<(e: { data: unknown }) => void> }>();
  readonly sent: unknown[] = [];
  make(): ChannelLike {
    const me = { fns: new Set<(e: { data: unknown }) => void>() };
    this.chans.add(me);
    return {
      postMessage: (data) => {
        this.sent.push(data);
        for (const o of this.chans) {
          if (o === me) continue;
          queueMicrotask(() => o.fns.forEach((f) => f({ data: structuredClone(data) })));
        }
      },
      addEventListener: (_t, fn) => void me.fns.add(fn),
      removeEventListener: (_t, fn) => void me.fns.delete(fn),
      close: () => void this.chans.delete(me),
    };
  }
}

/** One browser profile's localStorage (the token, the hint, the sign-in marker). */
export class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  clear(): void {
    this.m.clear();
  }
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  [name: string]: unknown;
}

export interface World {
  storage: Storage;
  drive: FakeDrive;
  gis: GisFakeControls;
  /** The profile's one IndexedDB. */
  raw: Backend;
  locks: FakeLocks;
  bus: Bus;
  tabs: Tab[];
  /** While set, every Drive request waits for it (holds a cycle in flight). */
  hold: Promise<void> | null;
}

export function makeWorld(o: { email?: string; raw?: Backend } = {}): World {
  resetGisLoaderForTest();
  const { ctl } = freshGis();
  return {
    drive: createFakeDrive({ acceptToken: isFakeToken, email: o.email ?? 'owner@example.com' }),
    gis: ctl,
    storage: new MemoryStorage(),
    raw: o.raw ?? createMemoryBackend(),
    locks: new FakeLocks(),
    bus: new Bus(),
    tabs: [],
    hold: null,
  };
}

/** Another device on the same account: its own IndexedDB, lock manager and tab bus; same Drive. */
export function otherDevice(w: World): World {
  return {
    ...w,
    storage: new MemoryStorage(),
    raw: createMemoryBackend(),
    locks: new FakeLocks(),
    bus: new Bus(),
    tabs: [],
  };
}

/** Holds every Drive request until `release()` (a cycle stays in flight meanwhile). */
export function holdDrive(w: World): () => void {
  let release!: () => void;
  w.hold = new Promise<void>((r) => (release = r));
  return () => {
    w.hold = null;
    release();
  };
}

export interface Tab {
  svc: SyncService;
  stores: SyncStores;
  env: SyncEnv;
  tracked: ReturnType<typeof createTrackedBackend>;
  /** Mutable environment knobs. */
  knobs: {
    visible: boolean;
    online: boolean;
    runActive: boolean;
    uaMobile: boolean;
  };
  refreshed: SyncKind[][];
  notices: string[];
  navigations: { silent: boolean }[];
  runListeners: Set<(e: { runId: string; status: RunMeta['status']; active: boolean }) => void>;
  /** The Drive GETs of `files.list` (one per engine listing). */
  lists(): number;
  /** Requests this tab sent to Drive. */
  requests: number;
  stop(): void;
}

export interface TabOptions {
  /** `null` = the memory backend (sync stays off). */
  memory?: boolean;
  platform?: { standalone: boolean; android: boolean };
  name?: string;
}

export function makeTab(w: World, o: TabOptions = {}): Tab {
  const stores = createSyncStores();
  const tracked = createTrackedBackend(w.raw);
  const knobs = { visible: true, online: true, runActive: false, uaMobile: false };
  const navigations: { silent: boolean }[] = [];
  const source = createGisTokenSource({
    clientId: 'cid',
    storage: w.storage,
    whoAmI: async (token) =>
      (await createDriveStore({ token: () => token, fetchImpl }).about()).email,
    ...(o.platform ? { platform: () => o.platform! } : {}),
    isRunActive: () => knobs.runActive,
    navigate: (x) => void navigations.push({ silent: x.silent }),
  });
  const auth = createAuthFlow(source);
  const refreshed: SyncKind[][] = [];
  const notices: string[] = [];
  const counter = { n: 0 };
  const fetchImpl: typeof fetch = async (u, i) => {
    counter.n++;
    if (w.hold) await w.hold;
    return w.drive.fetch(u, i);
  };
  const runListeners = new Set<
    (e: { runId: string; status: RunMeta['status']; active: boolean }) => void
  >();
  const env: SyncEnv = {
    stores,
    auth,
    backend: () => Promise.resolve(o.memory ? null : tracked),
    makeRemote: ({ token, sessions }) => createDriveStore({ token, sessions, fetchImpl }),
    lock: createSyncLock(w.locks),
    channel: createSyncChannel(() => w.bus.make()),
    tabId: o.name ?? `tab${w.tabs.length + 1}`,
    now: () => Date.now(),
    visible: () => knobs.visible,
    online: () => knobs.online,
    traits: () => ({
      uaMobile: knobs.uaMobile,
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0',
    }),
    isRunActive: () => knobs.runActive,
    onRunChange: (fn) => {
      runListeners.add(fn);
      return () => void runListeners.delete(fn);
    },
    describeRun: () => Promise.resolve(undefined),
    isDryRun: (d: DefinitionRecord) => d.definition.tags?.includes('dry-run') === true,
    refresh: (k) => void refreshed.push(k),
    notify: (m) => void notices.push(m),
    storageEstimate: () => Promise.resolve({ usage: 1000, quota: 1_000_000_000 }),
    appVersion: '1.0.0',
    coreVersion: '1',
    gameId: 'roulette',
    random: () => 0.5, // no jitter: delays are the table's steps
    storage: w.storage,
  };
  const svc = createSyncService(env);
  const tab: Tab = {
    svc,
    stores,
    env,
    tracked,
    knobs,
    refreshed,
    notices,
    navigations,
    runListeners,
    lists: () =>
      w.drive.log.filter((l) => l.method === 'GET' && l.path === '/drive/v3/files').length,
    get requests() {
      return counter.n;
    },
    stop: () => {
      svc.stop();
      source.dispose();
    },
  };
  w.tabs.push(tab);
  return tab;
}

/** Signs a tab in with the popup and takes the first-sync choice; leaves sync running (idle). */
export async function signInAndSync(t: Tab, choice: 'merge' | 'replace' = 'merge'): Promise<void> {
  await t.svc.start();
  const p = t.svc.signIn();
  await until(
    () => t.stores.firstSyncPrompt.get() !== null || t.stores.signInError.get() !== null,
    'the first-sync sheet',
  );
  expect(t.stores.signInError.get()).toBeNull();
  const done = t.svc.chooseFirstSync(choice);
  await done;
  await p;
  await until(() => t.stores.syncStatus.get().state === 'idle', 'idle after the first sync');
  await flush(30); // the Drive info read that follows a first sync
}

// ---- records (valid shapes: the engine verifies hashes)

const ISO = '2026-01-01T00:00:00.000Z';

/** A layout record with a distinct body; `userPut` writes it through the tracked backend. */
export async function layoutRecord(
  id: string,
  body: string,
  name = id,
): Promise<Record<string, unknown>> {
  const { layoutHash } = await import('@core');
  const lay = {
    id,
    name,
    game: 'roulette',
    variant: 'european',
    spots: [{ bet: `straight:${body}`, chips: 1 }],
  };
  return {
    v: 1,
    id,
    layout: lay,
    hash: await layoutHash(lay as never),
    createdAt: ISO,
    updatedAt: ISO,
    origin: 'user',
  };
}

export function failingBackend(inner: Backend, fail: { on: boolean }): Backend {
  const quota = (): DOMException => new DOMException('full', 'QuotaExceededError');
  return {
    kind: inner.kind,
    get: (s, k) => inner.get(s, k),
    getAll: (s, i, r) => inner.getAll(s, i, r),
    getAllKeys: (s, r) => inner.getAllKeys(s, r),
    tx: (stores, mode, fn) =>
      fail.on && mode === 'readwrite' && stores.includes('layouts')
        ? Promise.reject(quota())
        : inner.tx(stores, mode, fn),
    update: (stores, fn) =>
      fail.on && stores.includes('layouts') ? Promise.reject(quota()) : inner.update(stores, fn),
  };
}

export async function putLayout(t: Tab, id: string, body: string, name = id): Promise<void> {
  const rec = await layoutRecord(id, body, name);
  await t.tracked.tx(['layouts'], 'readwrite', (tx) => tx.put('layouts', rec));
}

export async function layoutIds(w: World | Backend): Promise<string[]> {
  const raw = 'raw' in w ? w.raw : w;
  return (await raw.getAllKeys('layouts')).map(String).sort();
}

export type { RunStub };
