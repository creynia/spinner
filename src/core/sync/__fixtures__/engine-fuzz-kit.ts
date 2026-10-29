// WP-S2b: the harness of the call-level convergence fuzz through the real engine (sync.md §11.1);
// the tests are engine.fuzz.test.ts and engine.fuzz-sa.test.ts. Three devices
// share one memory remote. Every remote call of every device first runs a scheduler hook, which
// may run steps of the OTHER devices (user edits, whole cycles, restarts) before the call
// proceeds, so cycles interleave mid-cycle and the B1 race falls anywhere in a cycle. Network
// faults (before and after the effect) are injected too. The harness ideas are merge.fuzz.test.ts's.
//
// Asserted, over every entry PUBLISHED OR ATTEMPTED (a faulted upload was still minted):
//   - every live maximal entry of a copyable kind survives (as itself or as a copy);
//   - a def's maximal entries all survive in the join (runIds union);
//   - no key whose maximal entries are all tombstones is alive on any device;
//   - no (device, counter) is minted twice, across restarts;
//   - zero copies of copies;
//   - the devices converge to identical stores, with no dirty marks left.
import { expect, vi } from 'vitest';
import type { RunData } from '../../contracts/run';
import type { RemoteStore, RunStub } from '../../contracts/sync';
import { RemoteError, type SyncEntry, type SyncKind } from '../../contracts/sync';
import { libDevice, LIMITS, TEST_HOOKS } from '../apply';
import {
  def,
  dump,
  group,
  groupBody,
  indexOf,
  layout,
  layoutBody,
  makeDevice,
  marks,
  newSpy,
  records,
  setting,
  strategy,
  strategyBody,
  userDel,
  userPut,
  worldClock,
  wrapRemote,
  type Dev,
} from '../engine-testkit';
import { hashOf } from '../fingerprint';
import { hlcDevice } from '../hlc';
import { createMemoryRemote } from '../memory-remote';
import { rng } from '../testkit';
import { descends } from '../vv';
import { sha256Hex } from '../../experiment';
import { finishRun, importRunFile, putStubRun, tinyRun } from './runs-kit';

export const SEEDS = Number(process.env.FUZZ_SEEDS ?? 50);
export const FROM = Number(process.env.FUZZ_FROM ?? 1);
const IDS = ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc'];

let clock: () => number;

/** Call from `beforeEach`: a seed replays exactly (one chain of awaits, a driven clock). */
export function fuzzBefore(): void {
  LIMITS.pullParallel = 1;
  clock = worldClock();
  vi.spyOn(Date, 'now').mockImplementation(() => clock());
}
/** Call from `afterEach`. */
export function fuzzAfter(): void {
  LIMITS.pullParallel = 4;
  delete TEST_HOOKS.onMint;
  delete TEST_HOOKS.onTwin;
  delete TEST_HOOKS.onFold;
  vi.restoreAllMocks();
}

export interface Opts {
  seed: number;
  steps: number;
  idb?: boolean;
  /** Bodies come from a pool this small (S-A: identical edits on different devices are common). */
  pool?: number;
  /** Devices 0 | 1,2 cannot see each other's lib files until `healAt`. */
  healAt?: number;
  faults?: boolean;
  /** S2c: runs (private, paused-then-done, shared imports, deletes) join the operations. */
  runs?: boolean;
}

const sig = (e: SyncEntry): string => `${e.key}|${e.hlc}|${e.hash}|${JSON.stringify(e.vv)}`;
const BODY = { group: groupBody, strategy: strategyBody, layout: layoutBody } as const;
/** Runs of the S2c fuzz: PRIVATE ones are finished by one device each, SHARED ones are imported. */
const PRIVATE_RUNS = 5;
const SHARED_RUNS = 2;
let runPool: Promise<RunData[]> | undefined;
const pooled = (): Promise<RunData[]> =>
  (runPool ??= Promise.all(
    Array.from({ length: PRIVATE_RUNS + SHARED_RUNS }, (_, i) => tinyRun(i + 1)),
  ));
const RUN_STORES = ['runs', 'summaries', 'checkpoints', 'breakdowns', 'samples'] as const;

const COPY_ID = /^[a-z0-9]+-[0-9a-f]{6}([0-9a-f]{6})*$/;

async function run(o: Opts) {
  clock = worldClock(); // every seed starts from the same time: a failing seed replays alone
  const rnd = rng(o.seed * 7919 + 13);
  const inner = createMemoryRemote();
  const spy = newSpy();
  const minted = new Set<string>();
  const mintedEntries: SyncEntry[] = [];
  TEST_HOOKS.onMint = (e) => mintedEntries.push(e);
  const TRACE = process.env.FUZZ_TRACE;
  if (TRACE) {
    const f = (e?: SyncEntry): string =>
      e
        ? `${e.hlc.slice(5, 12)}${JSON.stringify(e.vv).replace(/"|aaaaaaaaaa|bbbbbbbbbb|cccccccccc/g, (m) => (m === '"' ? '' : m[0]!))}${e.deleted ? 'DEL' : ''}${e.hash.slice(0, 3)}`
        : '-';
    TEST_HOOKS.onFold = (x) => {
      if (!TRACE.split(',').includes(x.key)) return;
      process.stderr.write(
        `FOLD ${x.self[0]} base=${f(x.base)} remote=[${x.remote.map(f).join(' ')}] cand=${f(x.cand)} snap=${x.snap} => ${x.did} ${f(x.winner)} losers=[${x.losers.map(f).join(' ')}]\n`,
      );
    };
  }
  // A candidate whose equivalent published entry was applied instead (a "twin") is nobody's edit:
  // its content lives on in the twin. It still supersedes what it descends (the user did edit
  // after those), so it stays in the log, but it is not required to survive itself.
  const phantoms = new Set<SyncEntry>();
  TEST_HOOKS.onTwin = (e) => phantoms.add(e);
  const violations: string[] = [];
  const results: { outcome: string; code?: string; message?: string }[] = [];
  let partitioned = o.healAt !== undefined;
  let quiet = false;
  let depth = 0;
  const busy = new Set<number>();
  const defs = [await def('one'), await def('two')];
  const pool = o.runs ? await pooled() : [];
  const finished = new Set<number>();
  const paused = new Map<number, number>();
  /** Run ids deleted by anyone: not imported again (see the `it.fails` in runs.test.ts). */
  const deletedIds = new Set<string>();
  const devs: Dev[] = [];

  const group0 = (id: string): boolean => id === IDS[0];
  const hookFor = (i: number) => async (): Promise<void> => {
    if (quiet || depth >= 2) return;
    depth++;
    try {
      for (let n = rnd(3); n > 0; n--) {
        const j = rnd(3);
        const r = rnd(10);
        if (r < 4) await edit(j);
        else if (r < 7) {
          if (j !== i && !busy.has(j)) await cycle(j);
        } else if (r < 8) {
          if (!busy.has(j)) devs[j]!.restart();
        }
      }
    } finally {
      depth--;
    }
  };

  const body = (j: number, step: number): string =>
    o.pool ? ['red', 'black', 'green'][rnd(o.pool)]! : `${IDS[j]!.slice(0, 1)}${step}`;
  let step = 0;
  const WATCH = process.env.FUZZ_WATCH;
  const seenState = new Map<string, string>();
  async function watch(label: string): Promise<void> {
    if (!WATCH) return;
    for (const d of devs) {
      const st: string[] = [];
      for (const [id, r] of await records(d, 'group')) if (groupBody(r) === WATCH) st.push(id);
      for (const m of await marks(d)) st.push(`mark:${m}`);
      const cur = `${st.join(',')} | ${(await d.raw.get<{ v: string[] }>('syncMeta', 'copies'))?.v?.length ?? 0}`;
      if (seenState.get(d.id) !== cur) {
        seenState.set(d.id, cur);
        process.stderr.write(`${label} ${d.id.slice(0, 1)}: ${cur}\n`);
      }
    }
  }
  /**
   * A user write supersedes what this device minted for the key before it: the user's later edit
   * or delete is the final word of that device (even when it mints nothing, a delete of a key that
   * is already a tombstone).
   */
  const superseded = new Set<string>();
  function supersede(d: Dev, kind: SyncKind, id: string): void {
    for (const e of mintedEntries) {
      if (e.key === `${kind}:${id}` && hlcDevice(e.hlc) === d.id) superseded.add(sig(e));
    }
  }
  async function put(d: Dev, kind: SyncKind, id: string, rec: unknown): Promise<void> {
    supersede(d, kind, id);
    await userPut(d, kind, rec);
  }
  async function del(d: Dev, kind: SyncKind, id: string): Promise<void> {
    supersede(d, kind, id);
    await userDel(d, kind, id);
  }
  async function runOp(j: number): Promise<void> {
    const d = devs[j]!;
    step++;
    const k = rnd(10);
    if (k < 3) {
      // pause a run that was never finished (a stub only), on this device
      const i = rnd(PRIVATE_RUNS);
      if (!finished.has(i) && !paused.has(i)) {
        paused.set(i, j);
        await putStubRun(d, pool[i]!.meta, 'paused');
      }
    } else if (k < 5) {
      // finish a private run, once, on the device that paused it (else this one)
      const i = rnd(PRIVATE_RUNS);
      if (!finished.has(i)) {
        finished.add(i);
        await finishRun(devs[paused.get(i) ?? j]!, pool[i]!);
      }
    } else if (k < 7) {
      // the same file imported on whichever devices happen to pick it: a shared run
      const data = pool[PRIVATE_RUNS + rnd(SHARED_RUNS)]!;
      if (!deletedIds.has(data.meta.runId)) await importRunFile(d, data);
    } else {
      const have = await d.raw.getAllKeys('runs');
      if (have.length > 0) {
        const id = have[rnd(have.length)] as string;
        deletedIds.add(id);
        // Repo.deleteRun: the results go and the definition forgets the run, in one transaction
        const m = await d.raw.get<{ definitionId: string }>('runs', id);
        const rec = m && (await d.raw.get<{ runIds: string[] }>('definitions', m.definitionId));
        await d.tracked.tx([...RUN_STORES, 'definitions'], 'readwrite', (t) => {
          for (const s of RUN_STORES) t.delete(s, id);
          if (rec) t.put('definitions', { ...rec, runIds: rec.runIds.filter((r) => r !== id) });
        });
      }
    }
  }
  async function edit(j: number): Promise<void> {
    if (o.runs && rnd(4) === 0) return runOp(j);
    const d = devs[j]!;
    step++;
    const k = rnd(10);
    const b = body(j, step);
    if (k < 3) {
      const id = ['p', 'q'][rnd(2)]!;
      if (rnd(6) === 0) await del(d, 'group', id);
      else await put(d, 'group', id, group(id, b));
    } else if (k < 5) {
      const id = ['s1', 's2'][rnd(2)]!;
      if (rnd(6) === 0) await del(d, 'strategy', id);
      else await put(d, 'strategy', id, await strategy(id, b));
    } else if (k < 7) {
      const id = 'l1';
      if (rnd(6) === 0) await del(d, 'layout', id);
      else await put(d, 'layout', id, await layout(id, b));
    } else if (k < 8) {
      {
        const key = ['framing', 'pace'][rnd(2)]!;
        await put(d, 'setting', key, setting(key, b));
      }
    } else {
      const x = defs[rnd(2)]!;
      if (rnd(6) === 0) await del(d, 'def', x.id);
      else {
        const runIds = ['r1', 'r2', 'r3', 'r4'].filter(() => rnd(2) === 0);
        await put(d, 'def', x.id, {
          ...x.rec,
          runIds,
          displayName: b,
          displayNameAt: new Date(clock()).toISOString(),
        });
      }
    }
    await watch(`edit ${IDS[j]!.slice(0, 1)} k${k} ${b}`);
  }
  async function cycle(j: number): Promise<void> {
    busy.add(j);
    try {
      const r = await devs[j]!.cycle();
      await watch(
        `cycle ${IDS[j]!.slice(0, 1)} ${r.outcome} p${r.pushed} a${r.applied} c${r.copies} depth${depth}`,
      );
      results.push({
        outcome: r.outcome,
        ...(r.error ? { code: r.error.code, message: r.error.message } : {}),
      });
    } finally {
      busy.delete(j);
    }
  }

  for (let i = 0; i < 3; i++) {
    devs.push(
      await makeDevice({
        id: IDS[i]!,
        idb: o.idb ?? false,
        now: clock,
        minted,
        violations,
        // S2c: two devices download every run, one fetches on open
        ...(o.runs
          ? {
              prefs: { enabled: true, runDownload: i < 2 ? ('all' as const) : ('onOpen' as const) },
            }
          : {}),
        remote: wrapRemote(inner, {
          spy,
          before: hookFor(i),
          visible: (f) => {
            if (!partitioned) return true;
            const dv = libDevice(f.name);
            return dv === null || group0(dv) === group0(IDS[i]!);
          },
          fault: (op, _n, phase) =>
            o.faults && !quiet && rnd(100) < 2
              ? new RemoteError('network', 0, `injected ${op} ${phase}`)
              : undefined,
        }),
      }),
    );
  }

  for (let s = 0; s < o.steps; s++) {
    if (o.healAt !== undefined && s === o.healAt) partitioned = false;
    const j = rnd(3);
    const r = rnd(10);
    if (r < 4) await edit(j);
    else if (r < 9) {
      if (!busy.has(j)) await cycle(j);
    } else devs[j]!.restart();
  }

  // Edits that are still unpushed cannot have been superseded by anything this device has seen: each
  // must exist in the end, as itself or as a copy (model.test.mts's "last local value").
  const unsynced: { kind: 'group' | 'strategy' | 'layout'; body: string; at: string }[] = [];
  for (const d of devs) {
    for (const m of await marks(d)) {
      const [kind, id] = [m.slice(0, m.indexOf(':')) as SyncKind, m.slice(m.indexOf(':') + 1)];
      if (kind !== 'group' && kind !== 'strategy' && kind !== 'layout') continue;
      const rec = (await records(d, kind)).get(id);
      if (!rec) continue;
      // a re-save of what the index already holds changes nothing: not an edit
      const base = (await indexOf(d)).get(m);
      if (base && !base.entry.deleted && base.entry.hash === (await hashOf(kind, rec))) continue;
      unsynced.push({
        kind,
        body: BODY[kind](rec),
        at: `${d.id[0]} ${m} base=${base ? sig(base.entry) : '-'}`,
      });
    }
  }

  // settle: no hooks, no faults, no partition; every device syncs until a full round is quiet
  quiet = true;
  partitioned = false;
  for (let round = 0; round < 8; round++) {
    let moved = 0;
    for (let j = 0; j < 3; j++) {
      const r = await devs[j]!.cycle();
      results.push({
        outcome: r.outcome,
        ...(r.error ? { code: r.error.code, message: r.error.message } : {}),
      });
      moved += r.pushed + r.applied + r.copies;
    }
    if (moved === 0 && round >= 1) break;
  }
  return {
    devs,
    inner,
    spy,
    violations,
    results,
    minted,
    mintedEntries,
    phantoms,
    unsynced,
    superseded,
  };
}

const keyOf = (e: SyncEntry): string => e.key;
/** The definitions of the S2c runs ("Run def n"): their runIds follow run deletes, not edits. */
const runDef = (rec: Record<string, unknown> | undefined): boolean =>
  /^Run def/.test(String((rec?.definition as { name?: string } | undefined)?.name ?? ''));

export async function check(o: Opts, label: string): Promise<number> {
  const { devs, inner, spy, violations, results, mintedEntries, phantoms, unsynced, superseded } =
    await run(o);
  const where = `${label} seed ${o.seed}`;
  // the engine itself never fails, apart from the faults the test injects
  for (const r of results) {
    if (r.outcome === 'error' || r.outcome === 'needs-auth') {
      expect.fail(`${where}: cycle ${r.outcome} ${r.code} ${r.message}`);
    }
  }
  expect(violations, `${where}: vv values minted twice`).toEqual([]);

  // converge, no marks left
  const first = await dump(devs[0]!);
  for (const d of devs) {
    expect(await dump(d), where).toBe(first);
    expect(await marks(d), `${where} marks`).toEqual([]);
  }

  // published + attempted entries, per key; maximal = not strictly dominated
  const byKey = new Map<string, SyncEntry[]>();
  for (const e of [...spy.published, ...mintedEntries])
    byKey.set(keyOf(e), [...(byKey.get(keyOf(e)) ?? []), e]);
  const maximal = new Map<string, SyncEntry[]>();
  for (const [k, es] of byKey) {
    maximal.set(
      k,
      es.filter((e) => !es.some((x) => descends(x, e) && !descends(e, x))),
    );
  }
  // With a small content pool, identical edits are common and "an edit" has no identity (two
  // devices that set the same value are one edit): the survival accounting needs unique bodies.
  // The pool run asserts convergence, vv uniqueness and zero copies of copies (S-A).
  const accounting = !o.pool;
  for (const u of accounting ? unsynced : []) {
    const present = [...(await records(devs[0]!, u.kind)).values()].map(BODY[u.kind]);
    expect(present, `${where} unsynced ${u.kind} ${u.body} lost at ${u.at}`).toContain(u.body);
  }
  const finalStores = new Map<SyncKind, Map<string, Record<string, unknown>>>();
  for (const kind of ['group', 'strategy', 'layout', 'def', 'setting'] as const)
    finalStores.set(kind, await records(devs[0]!, kind));
  const bodies: Record<string, (r: unknown) => string> = {
    group: groupBody,
    strategy: strategyBody,
    layout: layoutBody,
  };
  let copies = 0;
  for (const [key, ms] of accounting ? maximal : []) {
    const kind = ms[0]!.kind;
    const real = ms.filter((e) => !phantoms.has(e));
    if (real.length === 0) continue; // only phantoms: nothing here must survive
    const liveAll = real.filter((e) => !e.deleted);
    const live = liveAll.filter((e) => !superseded.has(sig(e)));
    const id = ms[0]!.id;
    if (liveAll.length === 0) {
      for (const d of devs) {
        expect((await records(d, kind)).has(id), `${where} resurrected ${key}`).toBe(false);
      }
      continue;
    }
    if (kind in bodies) {
      const all = new Set([...finalStores.get(kind)!.values()].map(bodies[kind]!));
      for (const e of live) {
        const lostBody = bodies[kind]!(e.value);
        if (all.has(lostBody)) continue;
        const hist = (byKey.get(key) ?? [])
          .map(
            (x) => `${x.hlc} ${JSON.stringify(x.vv)} ${x.deleted ? 'DEL' : bodies[kind]!(x.value)}`,
          )
          .join('\n  ');
        const finals = [...finalStores.get(kind)!].map(([id, r]) => `${id}=${bodies[kind]!(r)}`);
        expect.fail(`${where} lost ${key} ${lostBody}\n  ${hist}\nfinal: ${finals.join(' ')}`);
      }
    }
    if (kind === 'def' && live.length > 0 && !runDef(finalStores.get('def')!.get(id))) {
      const rec = finalStores.get('def')!.get(id);
      if (!rec) {
        const f = (e: SyncEntry): string =>
          `${e.hlc.slice(5, 12)} ${JSON.stringify(e.vv)} ${e.deleted ? 'DEL' : 'live'}${phantoms.has(e) ? ' phantom' : ''}`;
        expect.fail(
          `${where} def ${id} vanished\n live maximal: ${live.map(f).join('; ')}\n all maximal: ${ms.map(f).join('; ')}\n history:\n  ${(byKey.get(key) ?? []).map(f).join('\n  ')}`,
        );
      }
      for (const e of live) {
        for (const r of (e.value as unknown as { runIds: string[] }).runIds) {
          expect(rec.runIds as string[], `${where} def runIds lost ${r}`).toContain(r);
        }
      }
    }
  }
  // zero copies of copies, and every copy is named by its fingerprint
  for (const [kind, re] of [
    ['group', /^[pq]( \(conflict [0-9a-f]{6}\))?$/],
    ['strategy', /^s[12]( \(conflict [0-9a-f]{6}\))?$/],
    ['layout', /^l1( \(conflict [0-9a-f]{6}\))?$/],
  ] as const) {
    for (const [id, rec] of finalStores.get(kind)!) {
      const name = kind === 'group' ? (rec.name as string) : (rec[kind] as { name: string }).name;
      expect(name, `${where} ${kind} ${id}`).toMatch(re);
      if (!/^(p|q|s1|s2|l1)$/.test(id)) {
        expect(id, where).toMatch(COPY_ID);
        copies++;
      }
    }
  }
  // each device's persistent counter covers every vv[self] anywhere
  for (const d of devs) {
    const stored = (await d.raw.get<{ v: number }>('syncMeta', 'vvCounter'))?.v ?? 0;
    for (const e of spy.published) {
      expect(e.vv[d.id] ?? 0, `${where} counter of ${d.id}`).toBeLessThanOrEqual(stored);
    }
  }
  if (o.runs) await checkRuns(devs, inner, where);
  return copies;
}

/**
 * S2c: runs converge like every other kind, and what the index says about a run is true on the
 * device and on the remote: a live done stub's bundle is in Drive with the stub's sha256; a
 * device that downloads everything holds every live done run; a deleted run is held nowhere.
 */
async function checkRuns(devs: Dev[], inner: RemoteStore, where: string): Promise<void> {
  const files = await inner.list();
  const bundles = new Map<string, string[]>(); // name -> sha256 of every file of that name
  for (const f of files.filter((x) => x.name.startsWith('run.'))) {
    bundles.set(f.name, [
      ...(bundles.get(f.name) ?? []),
      await sha256Hex(await inner.download(f.id)),
    ]);
  }
  let first: string | undefined;
  for (const [j, d] of devs.entries()) {
    const rows = [...(await indexOf(d))].filter(([k]) => k.startsWith('run:'));
    const sig = rows
      .map(([k, r]) => `${k}|${r.entry.deleted ? 'DEL' : r.entry.hash}`)
      .sort()
      .join('\n');
    first ??= sig;
    expect(sig, `${where} run entries of device ${j}`).toBe(first);
    const local = new Set((await d.raw.getAllKeys('runs')).map(String));
    for (const [k, row] of rows) {
      const id = k.slice(4);
      if (row.entry.deleted) {
        expect(local.has(id), `${where} deleted run ${id} still on device ${j}`).toBe(false);
        continue;
      }
      expect(row.local, `${where} local flag of ${id} on device ${j}`).toBe(local.has(id) ? 1 : 0);
      const stub = row.entry.value as RunStub;
      if (stub.status !== 'done') {
        expect(stub.bundle, `${where} ${id} stub-only has a bundle`).toBeUndefined();
        continue;
      }
      expect(stub.bundle, `${where} done run ${id} without a bundle`).toBeDefined();
      expect(bundles.get(stub.bundle!.name), `${where} bundle of ${id} is in Drive`).toContain(
        stub.bundle!.sha256,
      );
      if (j < 2) {
        const m = await d.raw.get<{ status: string; resultsDigest?: string }>('runs', id);
        expect(m?.status, `${where} device ${j} (download all) lacks ${id}`).toBe('done');
        expect(m?.resultsDigest).toBe(stub.resultsDigest);
      }
    }
    // a run held here that the index does not know would never sync: every local run is indexed
    for (const id of local) {
      const row = rows.find(([k]) => k === `run:${id}`)?.[1];
      const m = await d.raw.get<{ status: string }>('runs', id);
      if (m?.status === 'done')
        expect(row, `${where} unindexed run ${id} on device ${j}`).toBeDefined();
    }
  }
  for (const [name, shas] of bundles) {
    expect(shas.length, `${where} ${name} copies`).toBeLessThanOrEqual(devs.length);
  }
}
