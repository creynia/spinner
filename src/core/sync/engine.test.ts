// WP-S2b: the engine core against the memory remote (sync.md §7.3, §7.4, §11.1). Every scenario
// that touches the store runs on memory AND fake-indexeddb, because only IndexedDB commits a
// transaction whose `update` fn awaits something other than `r.get`.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RemoteError,
  type SyncEntry,
  type SyncMetaKey,
  type SyncMetaValues,
} from '../contracts/sync';
import { createMemoryRemote } from './memory-remote';
import {
  def,
  dump,
  group,
  groupBody,
  indexOf,
  layout,
  makeDevice,
  marks,
  newSpy,
  records,
  setting,
  strategy,
  userDel,
  userPut,
  worldClock,
  wrapRemote,
  type Dev,
  useIdb,
} from './engine-testkit';
import { decodeLib, LIB_NAME } from './libfile';
import { SUPPORTED_V } from './fingerprint';
import { entryOf } from './fingerprint';
import { encodeLib } from './libfile';
import { hlcOf } from './testkit';

const A = 'aaaaaaaaaa';
const B = 'bbbbbbbbbb';
const C = 'cccccccccc';

useIdb(() => new IDBFactory());

let clock: () => number;
beforeEach(() => {
  clock = worldClock();
  vi.spyOn(Date, 'now').mockImplementation(() => clock());
});
afterEach(() => {
  vi.restoreAllMocks();
});

const meta = async <K extends SyncMetaKey>(d: Dev, k: K): Promise<SyncMetaValues[K] | undefined> =>
  (await d.raw.get<{ v: SyncMetaValues[K] }>('syncMeta', k))?.v;

async function world(n: number, idb: boolean, lag = 0) {
  const inner = createMemoryRemote(lag ? { listingLag: { ownLib: lag } } : {});
  const spy = newSpy();
  const minted = new Set<string>();
  const devs: Dev[] = [];
  for (const id of [A, B, C].slice(0, n)) {
    devs.push(
      await makeDevice({
        id,
        idb,
        remote: wrapRemote(inner, { spy }),
        now: clock,
        minted,
      }),
    );
  }
  return { inner, spy, devs, minted };
}

const sync = async (...ds: Dev[]): Promise<void> => {
  for (let r = 0; r < 3; r++)
    for (const d of ds) {
      const res = await d.cycle();
      expect(res.outcome, JSON.stringify(res.error)).toBe('ok');
    }
};

describe.each([false, true])('engine (idb %s)', (idb) => {
  it('pushes a local edit and a second device applies it; a no-change cycle makes one request', async () => {
    const { devs } = await world(2, idb);
    const [a, b] = devs as [Dev, Dev];
    await userPut(a, 'group', group('g1', 'one'));
    await userPut(a, 'strategy', await strategy('s1', 'x'));
    await userPut(a, 'layout', await layout('l1', '7'));
    await userPut(a, 'setting', setting('framing', 'wide'));
    await userPut(a, 'setting', setting('theme', 'dark')); // never synced
    const d = await def('d');
    await userPut(a, 'def', d.rec);
    const r1 = await a.cycle();
    expect(r1.outcome).toBe('ok');
    expect(r1.pushed).toBe(5);
    expect(await marks(a)).toEqual([]);
    const r2 = await b.cycle();
    expect(r2.outcome).toBe('ok');
    expect(r2.applied).toBe(5);
    expect(new Set(r2.changed)).toEqual(new Set(['group', 'strategy', 'layout', 'setting', 'def']));
    expect(await dump(b)).toBe(await dump(a));
    expect((await records(b, 'setting')).has('theme')).toBe(false);
    expect(await marks(b)).toEqual([]); // the engine writes raw: no marks from applying
    // nothing changed anywhere (once the devices have seen each other's merged view): exactly one
    // request, the listing
    await sync(a, b);
    for (const x of [a, b, a, b]) {
      const r = await x.cycle();
      expect(r).toMatchObject({ outcome: 'ok', requests: 1, pushed: 0, applied: 0, copies: 0 });
    }
  });

  it('a re-save that only changes updatedAt is a no-op: the mark goes, nothing is pushed', async () => {
    const { devs } = await world(2, idb);
    const [a] = devs as [Dev, Dev];
    await userPut(a, 'group', group('g1', 'one'));
    await a.cycle();
    await userPut(a, 'group', { ...group('g1', 'one'), updatedAt: '2030-01-01T00:00:00.000Z' });
    expect(await marks(a)).toEqual(['group:g1']);
    const r = await a.cycle();
    expect(r).toMatchObject({ outcome: 'ok', requests: 1, pushed: 0 });
    expect(await marks(a)).toEqual([]);
  });

  it('B1: both push before either pulls: both kept, one copy, identical everywhere', async () => {
    const { devs } = await world(2, idb);
    const [a, b] = devs as [Dev, Dev];
    await userPut(a, 'group', group('x', 'v0'));
    await sync(a, b);
    await userPut(a, 'group', group('x', 'A1'));
    await userPut(b, 'group', group('x', 'B1'));
    await sync(a, b);
    const g = await records(a, 'group');
    expect(g.size).toBe(2);
    expect([...g.values()].map(groupBody).sort()).toEqual(['A1', 'B1']);
    expect(await dump(a)).toBe(await dump(b));
    const copy = [...g.keys()].find((k) => k !== 'x')!;
    expect(copy).toMatch(/^x-[0-9a-f]{6}$/);
    expect((g.get(copy)!.name as string).endsWith(')')).toBe(true);
    expect(g.get(copy)!.name).toMatch(/^x \(conflict [0-9a-f]{6}\)$/);
    // a notice on each device that made a copy; the copy id is in `syncMeta.copies`
    for (const d of [a, b]) {
      const copies = (await meta(d, 'copies')) ?? [];
      const notices = (await meta(d, 'conflicts')) ?? [];
      if (copies.includes(copy)) {
        expect(notices.some((n) => n.copyId === copy && n.message.includes('Both are kept'))).toBe(
          true,
        );
      }
    }
  });

  it('the B1 window: a peer writes between our listing and our upload (RECHECK)', async () => {
    const inner = createMemoryRemote();
    const minted = new Set<string>();
    const b = await makeDevice({ id: B, idb, now: clock, minted, remote: wrapRemote(inner, {}) });
    let armed = false;
    const a = await makeDevice({
      id: A,
      idb,
      now: clock,
      minted,
      remote: wrapRemote(inner, {
        before: async (op) => {
          // right after A's first listing, B pushes its edit
          if (armed && op === 'list') {
            armed = false;
            await userPut(b, 'group', group('x', 'B1'));
            await b.cycle();
          }
        },
      }),
    });
    await userPut(a, 'group', group('x', 'v0'));
    await sync(a, b);
    await userPut(a, 'group', group('x', 'A1'));
    armed = true;
    const first = await a.cycle(); // lists (B pushes), lists again, pulls B1, resolves, pushes
    expect(first.outcome).toBe('ok');
    await sync(a, b);
    expect((await records(a, 'group')).size).toBe(2);
    expect(await dump(a)).toBe(await dump(b));
  });

  it('edit beats a concurrent delete; a later delete that descends everything wins', async () => {
    const { devs } = await world(2, idb);
    const [a, b] = devs as [Dev, Dev];
    await userPut(a, 'strategy', await strategy('s', 'v0'));
    await sync(a, b);
    await userPut(b, 'strategy', await strategy('s', 'B-edit'));
    await userDel(a, 'strategy', 's');
    await sync(a, b);
    expect(strategyBodies(await records(a, 'strategy'))).toEqual(['B-edit']);
    expect(await dump(a)).toBe(await dump(b));
    await userDel(a, 'strategy', 's');
    await sync(a, b);
    expect((await records(b, 'strategy')).size).toBe(0);
  });

  it('defs join: runIds union and the later rename; no copy', async () => {
    const { devs } = await world(2, idb);
    const [a, b] = devs as [Dev, Dev];
    const d0 = await def('j', {}, ['r0']);
    await userPut(a, 'def', d0.rec);
    await sync(a, b);
    await userPut(a, 'def', {
      ...d0.rec,
      runIds: ['r0', 'ra'],
      displayName: 'A',
      displayNameAt: '2026-02-01T00:00:00.000Z',
    });
    await userPut(b, 'def', {
      ...d0.rec,
      runIds: ['r0', 'rb'],
      displayName: 'B',
      displayNameAt: '2026-03-01T00:00:00.000Z',
    });
    await sync(a, b);
    const rec = (await records(a, 'def')).get(d0.id)!;
    expect(rec.runIds).toEqual(['r0', 'ra', 'rb']);
    expect(rec.displayName).toBe('B');
    expect((await records(a, 'def')).size).toBe(1);
    expect(await dump(a)).toBe(await dump(b));
    expect(await marks(a)).toEqual([]);
    expect(await marks(b)).toEqual([]);
  });

  it('dry-run definitions are never pushed and their mark is dropped', async () => {
    const { devs, spy } = await world(2, idb);
    const [a, b] = devs as [Dev, Dev];
    const dry = await def('dry', { dry: true });
    const live = await def('live');
    await userPut(a, 'def', dry.rec);
    await userPut(a, 'def', live.rec);
    await sync(a, b);
    expect([...(await records(b, 'def')).keys()]).toEqual([live.id]);
    expect(spy.published.some((e) => e.id === dry.id)).toBe(false);
    expect(await marks(a)).toEqual([]);
  });

  it('a run id that was deleted and then re-imported is not dropped from a joined definition', async () => {
    const { devs, inner } = await world(1, idb);
    const [a] = devs as [Dev];
    const stub = (id: string) => ({ runId: id, status: 'paused', extra: {} });
    const lib = async (dev: string, entries: SyncEntry[]) =>
      inner.create(
        LIB_NAME(dev),
        await encodeLib({
          format: 'spinner-sync-lib',
          version: 1,
          device: { id: dev, name: dev, appVersion: '2', coreVersion: '1' },
          hlc: entries
            .map((e) => e.hlc)
            .sort()
            .at(-1)!,
          writtenAt: new Date().toISOString(),
          entries,
        }),
        {},
      );
    const d1 = await def('rr', {}, ['gone', 'back']);
    const d2 = await def('rr', {}, ['gone', 'back', 'x']);
    // run "gone" is deleted for good; run "back" is deleted, then re-imported (descends the tombstone)
    const goneDel = await entryOf('run', 'gone', null, hlcOf(10, B), undefined, B, 1);
    const backDel = await entryOf('run', 'back', null, hlcOf(10, B, 1), undefined, B, 2);
    const backLive = await entryOf(
      'run',
      'back',
      stub('back') as never,
      hlcOf(20, C),
      { hlc: backDel.hlc, seen: backDel.vv },
      C,
      1,
    );
    const e1 = await entryOf('def', d1.id, d1.rec as never, hlcOf(30, B), undefined, B, 3);
    const e2 = await entryOf('def', d1.id, d2.rec as never, hlcOf(31, C), undefined, C, 2);
    await lib(B, [goneDel, backDel, e1]);
    await lib(C, [backLive, e2]);
    expect((await a.cycle()).outcome).toBe('ok');
    const rec = (await records(a, 'def')).get(d1.id)!;
    expect(rec.runIds).toEqual(['back', 'x']); // "gone" is dropped, "back" lives
  });

  it('settings: only framing and pace follow the account; LWW, no copy', async () => {
    const { devs } = await world(2, idb);
    const [a, b] = devs as [Dev, Dev];
    await userPut(a, 'setting', setting('pace', 'fast'));
    await userPut(b, 'setting', setting('pace', 'slow'));
    await sync(a, b);
    expect(await dump(a)).toBe(await dump(b));
    expect((await records(a, 'setting')).size).toBe(1);
  });

  it('listing lag on the own lib: no duplicate lib file, no false re-seed', async () => {
    const { devs, inner } = await world(1, idb, 3);
    const [a] = devs as [Dev];
    await userPut(a, 'group', group('g', '1'));
    await a.cycle();
    await userPut(a, 'group', group('g', '2'));
    await a.cycle();
    await userPut(a, 'group', group('g', '3'));
    await a.cycle();
    for (let i = 0; i < 6; i++) await a.cycle();
    const libs = (await inner.list()).filter((f) => f.name === LIB_NAME(A));
    expect(libs).toHaveLength(1);
    expect((await meta(a, 'files'))?.ownLib?.id).toBe(libs[0]!.id);
  });

  it('opaque: a newer-schema entry is kept, never applied, and the mark stays until an upgrade', async () => {
    const { devs, inner } = await world(2, idb);
    const [a, b] = devs as [Dev, Dev];
    // B publishes a group at record schema v:2
    const g = { ...group('g', 'future'), v: 2 };
    const e = await entryOf('group', 'g', g as never, hlcOf(Date.now(), B), undefined, B, 1);
    expect(e.v).toBe(2);
    const bytes = await encodeLib({
      format: 'spinner-sync-lib',
      version: 1,
      device: { id: B, name: 'B', appVersion: '2', coreVersion: '1' },
      hlc: e.hlc,
      writtenAt: new Date().toISOString(),
      entries: [e],
    });
    await inner.create(LIB_NAME(B), bytes, {});
    // A has its own, older group g and a pending edit
    await userPut(a, 'group', group('g', 'mine'));
    const r = await a.cycle();
    expect(r.outcome).toBe('ok');
    expect(groupBody((await records(a, 'group')).get('g'))).toBe('mine'); // untouched
    expect(await marks(a)).toEqual(['group:g']); // kept
    const idx = (await indexOf(a)).get('group:g')!;
    expect(idx.local).toBe(0);
    expect(idx.entry.v).toBe(2);
    // the lib A uploaded carries the v:2 entry as-is (a round trip through an older device)
    const mine = (await inner.list()).find((f) => f.name === LIB_NAME(A))!;
    const lib = await decodeLib(await inner.download(mine.id));
    expect(lib.entries.find((x) => x.key === 'group:g')).toEqual(e);
    // the app upgrades: the entry is understood now and applied; the local edit then competes
    SUPPORTED_V.group = 2;
    try {
      await sync(a, b);
      expect((await records(a, 'group')).size).toBeGreaterThanOrEqual(1);
      expect(await dump(a)).toBe(await dump(b));
      expect(await marks(a)).toEqual([]);
    } finally {
      SUPPORTED_V.group = 1;
    }
  });

  it('a bad entry (hash does not match) is skipped with a notice, the rest applies', async () => {
    const { devs, inner } = await world(1, idb);
    const [a] = devs as [Dev];
    const good = await entryOf(
      'group',
      'ok',
      group('ok', '1') as never,
      hlcOf(5, B),
      undefined,
      B,
      1,
    );
    const bad = await entryOf(
      'group',
      'bad',
      group('bad', '1') as never,
      hlcOf(6, B),
      undefined,
      B,
      2,
    );
    const tampered: SyncEntry = { ...bad, value: group('bad', '2') as never };
    await inner.create(
      LIB_NAME(B),
      await encodeLib({
        format: 'spinner-sync-lib',
        version: 1,
        device: { id: B, name: 'B', appVersion: '2', coreVersion: '1' },
        hlc: bad.hlc,
        writtenAt: new Date().toISOString(),
        entries: [good, tampered],
      }),
      {},
    );
    const r = await a.cycle();
    expect(r.outcome).toBe('ok');
    expect([...(await records(a, 'group')).keys()]).toEqual(['ok']);
    const notices = (await meta(a, 'conflicts')) ?? [];
    expect(notices.some((n) => /could not be verified/.test(n.message))).toBe(true);
  });

  it('the engine never writes a mark of its own; the user write that races an apply keeps its mark', async () => {
    const { devs } = await world(2, idb);
    const [a, b] = devs as [Dev, Dev];
    await userPut(a, 'group', group('g', 'a1'));
    await a.cycle();
    await b.cycle();
    expect(await marks(b)).toEqual([]);
    await userPut(a, 'group', group('g', 'a2'));
    await a.cycle();
    await userPut(b, 'group', group('g', 'b-local')); // dirty before B pulls a2
    await sync(b, a);
    expect((await records(b, 'group')).size).toBe(2); // concurrent with a2: kept both
  });
});

const strategyBodies = (m: Map<string, Record<string, unknown>>): string[] =>
  [...m.values()].map((r) => (r.strategy as { body: string }).body).sort();

describe('remote errors and root', () => {
  it('maps remote errors onto outcomes', async () => {
    const codes: [RemoteError['code'], string, string?][] = [
      ['auth', 'needs-auth', 'auth'],
      ['network', 'offline', 'network'],
      ['quota', 'error', 'quota'],
      ['forbidden', 'error', 'access-removed'],
      ['server', 'error', 'network'],
      ['rate', 'error', 'network'],
    ];
    for (const [code, outcome, ec] of codes) {
      const inner = createMemoryRemote({
        fault: (op) => (op === 'list' ? new RemoteError(code, 0, 'x') : undefined),
      });
      const a = await makeDevice({ id: A, remote: inner, now: clock });
      const r = await a.cycle();
      expect(r.outcome).toBe(outcome);
      expect(r.error?.code).toBe(ec);
    }
  });

  it('refuses a newer layout and turns off when the data was erased', async () => {
    const inner = createMemoryRemote();
    const a = await makeDevice({ id: A, remote: inner, now: clock });
    await a.cycle();
    const root = (await inner.list()).find((f) => f.name === 'spinner-sync.json')!;
    const doc = JSON.parse(new TextDecoder().decode(await inner.download(root.id))) as Record<
      string,
      unknown
    >;
    await inner.update(root.id, new TextEncoder().encode(JSON.stringify({ ...doc, version: 2 })));
    expect(await a.cycle()).toMatchObject({ outcome: 'error', error: { code: 'newer-layout' } });
    await inner.update(
      root.id,
      new TextEncoder().encode(JSON.stringify({ ...doc, erased: { at: '2999-01-01', by: B } })),
    );
    expect(await a.cycle()).toMatchObject({ outcome: 'off', error: { code: 'erased' } });
  });

  it('a missing root on a device that synced before is an error, never a silent re-push', async () => {
    const inner = createMemoryRemote();
    const a = await makeDevice({ id: A, remote: inner, now: clock });
    await userPut(a, 'group', group('g', '1'));
    await a.cycle();
    for (const f of await inner.list()) await inner.delete(f.id);
    const r = await a.cycle();
    expect(r).toMatchObject({ outcome: 'error', error: { code: 'erased' } });
    expect(await inner.list()).toEqual([]);
  });

  it('a disabled device does nothing', async () => {
    const inner = createMemoryRemote();
    const a = await makeDevice({ id: A, remote: inner, now: clock });
    await a.raw.tx(['syncMeta'], 'readwrite', (t) =>
      t.put('syncMeta', { k: 'prefs', v: { enabled: false, deviceName: 'x', runDownload: 'all' } }),
    );
    expect(await a.cycle()).toMatchObject({ outcome: 'off', requests: 0 });
  });

  it('reports progress phases', async () => {
    const inner = createMemoryRemote();
    const a = await makeDevice({ id: A, remote: inner, now: clock });
    const b = await makeDevice({ id: B, remote: inner, now: clock });
    await userPut(a, 'group', group('g', '1'));
    await a.cycle();
    await b.cycle();
    expect(new Set(b.progress)).toEqual(
      new Set(['list', 'pull', 'apply', 'push', 'upload-runs', 'gc']),
    );
  });
});
