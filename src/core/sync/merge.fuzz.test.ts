// WP-S2a: the prototype's model.test.mts, ported onto the real entryOf / resolve / copyOf and the
// real clock (sync.md §7.4, §11.1): B1, transitive descent, edit vs delete, N1, N3, the S-A
// small-pool partition-and-heal fuzz, and the main fuzz with its copy-count asserts.
import { describe, expect, it } from 'vitest';
import type { ExperimentGroup } from '../contracts/experiment';
import type { DeviceId, SyncEntry, SyncIndexRecord } from '../contracts/sync';
import { entryOf } from './fingerprint';
import { createClock, hlcWall, type HlcClock } from './hlc';
import { copyIdOf, copyOf, foldEntries, resolve } from './merge';
import { rng } from './testkit';
import { descends } from './vv';

interface Val {
  name: string;
  body: string;
}
const COPY_ID = /-[0-9a-f]{6,}$/;
const none = new Set<string>();

/** Drive: per device, a map of the entries that device last wrote. */
class Remote {
  libs = new Map<DeviceId, Map<string, SyncEntry>>();
  /** Every entry ever published, once (by key and hlc). */
  log = new Map<string, SyncEntry>();
  write(dev: DeviceId, entries: Map<string, SyncEntry>): void {
    for (const e of entries.values()) this.log.set(`${e.key}|${e.hlc}`, structuredClone(e));
    this.libs.set(dev, new Map([...entries].map(([k, e]) => [k, structuredClone(e)])));
  }
  read(): SyncEntry[] {
    return [...this.libs.values()].flatMap((m) => [...m.values()].map((e) => structuredClone(e)));
  }
}

const toGroup = (id: string, v: Val): ExperimentGroup => ({
  v: 1,
  id,
  kind: 'compare',
  name: v.name,
  runIds: [v.body],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
const fromGroup = (g: ExperimentGroup): Val => ({ name: g.name, body: g.runIds[0]! });

/** A device that syncs `group` records through the real merge functions (the §7.3 loop, no remote). */
class Device {
  store = new Map<string, Val>();
  index = new Map<string, SyncIndexRecord>();
  dirty = new Map<string, number>();
  copies = new Set<string>();
  /** N1: persistent and monotone across every reset (`syncMeta.vvCounter`). */
  vvCounter = 0;
  needsPull = false;
  /** Every (device, counter) ever minted, across all devices of the world. */
  static minted = new Set<string>();
  /** Published entries that a later local edit or delete (on top of them) superseded. */
  static superseded = new Set<string>();
  readonly clock: HlcClock;
  constructor(
    readonly id: DeviceId,
    public remote: Remote,
    private readonly now: () => number,
  ) {
    this.clock = createClock(id, now);
  }

  /** A fresh vvCounter value; asserts that no (self, counter) is ever minted twice. */
  next(): number {
    const n = ++this.vvCounter;
    const k = `${this.id}:${n}`;
    if (Device.minted.has(k)) throw new Error(`vv value reused: ${k}`);
    Device.minted.add(k);
    return n;
  }

  private supersede(id: string): void {
    const base = this.index.get(`group:${id}`)?.entry;
    if (base) Device.superseded.add(`${base.key}|${base.hlc}`);
  }

  edit(id: string, body: string): void {
    this.supersede(id);
    this.store.set(id, { name: this.store.get(id)?.name ?? id, body });
    this.dirty.set(id, this.now());
  }
  del(id: string): void {
    this.supersede(id);
    this.store.delete(id);
    this.dirty.set(id, this.now());
  }
  /** resetLocalSyncState: forget the index, keep the records, the device id and vvCounter. */
  reset(): void {
    this.needsPull = true;
    this.index.clear();
    this.copies.clear();
    for (const id of this.store.keys()) this.dirty.set(id, this.now());
  }
  /** Replace: wipe local records and sync state; vvCounter survives (N1). */
  replace(): void {
    this.store.clear();
    this.index.clear();
    this.dirty.clear();
    this.copies.clear();
    this.needsPull = true;
  }

  private mint(id: string, at: number): Promise<SyncEntry> {
    const row = this.index.get(`group:${id}`);
    const v = this.store.get(id);
    return entryOf(
      'group',
      id,
      v ? toGroup(id, v) : null,
      this.clock.tickAt(at),
      row ? { hlc: row.entry.hlc, seen: row.seen } : undefined,
      this.id,
      this.next(),
    );
  }

  async pull(): Promise<void> {
    this.needsPull = false;
    const byKey = new Map<string, SyncEntry[]>();
    for (const e of this.remote.read()) byKey.set(e.key, [...(byKey.get(e.key) ?? []), e]);
    for (const [key, remote] of byKey) {
      for (const e of remote) this.clock.recv(e.hlc);
      const id = remote[0]!.id;
      const at = this.dirty.get(id);
      const base = this.index.get(key);
      const local = at !== undefined ? await this.mint(id, at) : undefined;
      const { res, losers, seen } = resolve(remote, base, local, none);
      switch (res.do) {
        case 'skip-older':
          if (base) this.index.set(key, { ...base, seen });
          break;
        case 'keep-local':
          // the mark stays; the next push mints from `seen`
          this.index.set(key, {
            key: key as never,
            kind: 'group',
            entry: base?.entry ?? foldEntries(remote, none).winner,
            seen,
            local: 1,
          });
          break;
        case 'apply':
        case 'join': {
          const w = res.entry;
          if (w.deleted || !w.value) this.store.delete(id);
          else this.store.set(id, fromGroup(w.value as ExperimentGroup));
          this.dirty.delete(id);
          this.index.set(key, { key: w.key, kind: w.kind, entry: w, seen, local: 1 });
          break;
        }
        case 'opaque':
          throw new Error('unexpected opaque');
      }
      for (const l of losers) {
        const first = copyIdOf(l);
        if (first === null || this.copies.has(first)) continue; // a copy we made stays made
        const mint = () => ({
          hlc: this.clock.tickAt(hlcWall(l.hlc)),
          self: this.id,
          counter: this.next(),
        });
        // the engine's contract: an id that already holds this very copy (made by another device)
        // is not "taken"; an id that holds unrelated content (live or tombstone) is.
        const ideal = (await copyOf(l, none, mint()))!;
        const held = this.index.get(ideal.key)?.entry;
        if (held && held.hash === ideal.hash) continue;
        const taken = new Set<string>();
        if (this.store.has(first) || this.index.has(`group:${first}`)) taken.add(first);
        const c = taken.size ? await copyOf(l, taken, mint()) : ideal;
        if (!c) continue;
        this.copies.add(c.id);
        this.store.set(c.id, fromGroup(c.value as ExperimentGroup));
        this.dirty.set(c.id, hlcWall(l.hlc)); // the loser's edit time
      }
    }
  }

  async push(): Promise<void> {
    if (this.needsPull) await this.pull();
    for (const [id, at] of this.dirty) {
      const row = this.index.get(`group:${id}`);
      if (!row && !this.store.has(id)) continue;
      const e = await this.mint(id, at);
      this.index.set(e.key, { key: e.key, kind: e.kind, entry: e, seen: e.vv, local: 1 });
    }
    this.dirty.clear();
    this.remote.write(this.id, new Map([...this.index].map(([k, r]) => [k, r.entry])));
  }
}

function world(n: number) {
  Device.minted = new Set();
  Device.superseded = new Set();
  let t = 1000;
  const now = () => (t += 1);
  const remote = new Remote();
  const devs = Array.from(
    { length: n },
    (_, i) => new Device(`d${i}`.padEnd(10, 'x'), remote, now),
  );
  const settle = async () => {
    for (let r = 0; r < 4; r++)
      for (const d of devs) {
        await d.pull();
        await d.push();
      }
  };
  const dump = (d: Device) => JSON.stringify([...d.store].sort(([a], [b]) => (a < b ? -1 : 1)));
  return { devs, remote, settle, dump };
}
const bodies = (d: Device) => [...d.store.values()].map((v) => v.body).sort();
const SEEDS = Number(process.env.MODEL_SEEDS ?? 40);

describe('merge model on the real functions', () => {
  it('B1: B pushes without having seen A1: both kept, one copy, same on both', async () => {
    const { devs, settle, dump } = world(2);
    const [a, b] = devs as [Device, Device];
    a.edit('x', 'v0');
    await a.push();
    await b.pull();
    a.edit('x', 'A1');
    b.edit('x', 'B1');
    await a.pull();
    await b.pull();
    await a.push();
    await b.push(); // never saw A1
    await settle();
    expect(bodies(a)).toEqual(['A1', 'B1']);
    expect(a.store.size).toBe(2);
    expect(dump(a)).toBe(dump(b));
  });

  it('a transitive descendant is not a conflict (A -> C -> D)', async () => {
    const { devs, settle } = world(3);
    const [a, c, d] = devs as [Device, Device, Device];
    a.edit('s', 'e1');
    await a.push();
    await c.pull();
    c.edit('s', 'e2');
    await c.push();
    await d.pull();
    d.edit('s', 'e3');
    await d.push();
    await a.pull();
    expect(a.store.get('s')?.body).toBe('e3');
    expect(a.store.size).toBe(1);
    await settle();
    for (const x of devs) expect(x.store.size).toBe(1);
  });

  it('a concurrent edit beats a later delete', async () => {
    const { devs, settle } = world(2);
    const [a, b] = devs as [Device, Device];
    a.edit('l', 'v0');
    await a.push();
    await b.pull();
    b.edit('l', 'B-edit');
    a.del('l');
    await a.pull();
    await b.pull();
    await b.push();
    await a.push();
    await settle();
    expect(a.store.get('l')?.body).toBe('B-edit');
    expect(b.store.get('l')?.body).toBe('B-edit');
  });

  it('N1: push 3 edits, lose the own lib, reset, edit: the new edit survives', async () => {
    const { devs, remote, settle } = world(2);
    const [a, b] = devs as [Device, Device];
    for (const v of ['1', '2', '3']) {
      a.edit('k', v);
      await a.push();
    }
    await b.pull();
    await b.push(); // the peer's lib now holds a's {a: 3}
    remote.libs.delete(a.id); // own lib gone (GC'd as stale / deleted by hand)
    const before = a.vvCounter;
    a.reset(); // re-seed; vvCounter survives
    expect(a.vvCounter).toBe(before);
    a.edit('k', 'NEW');
    await a.pull();
    await a.push();
    await settle();
    expect(a.store.get('k')?.body).toBe('NEW');
    expect(b.store.get('k')?.body).toBe('NEW');
    expect(a.store.size).toBe(1); // NEW descends from '3' (counter 4 > 3): no conflict
  });

  it('N1 (Replace): vvCounter survives the wipe, so a later edit still dominates', async () => {
    const { devs, remote, settle } = world(2);
    const [a, b] = devs as [Device, Device];
    for (const v of ['1', '2']) {
      a.edit('k', v);
      await a.push();
    }
    await b.pull();
    await b.push();
    remote.libs.delete(a.id);
    a.replace();
    await a.pull(); // takes b's copy of the record
    a.edit('k', 'AFTER');
    await a.push();
    await settle();
    expect(a.store.get('k')?.body).toBe('AFTER');
    expect(b.store.get('k')?.body).toBe('AFTER');
    expect(a.store.size).toBe(1);
  });

  it('N3: three devices create the same conflicted copy: one copy, no copy of a copy', async () => {
    const { devs, settle } = world(3);
    const [a, b, c] = devs as [Device, Device, Device];
    a.edit('m', 'v0');
    await a.push();
    await b.pull();
    await c.pull();
    a.edit('m', 'A');
    b.edit('m', 'B');
    await a.push();
    await b.push();
    // c sees the conflict and creates the copy; so do a and b, independently
    await c.pull();
    await a.pull();
    await b.pull();
    await c.push();
    await a.push();
    await b.push();
    await settle();
    for (const d of devs) {
      expect(d.store.size).toBe(2);
      expect([...d.store.keys()].filter((k) => COPY_ID.test(k))).toHaveLength(1);
      expect([...d.store.values()].some((v) => /\(conflict .*\(conflict /.test(v.name))).toBe(
        false,
      );
    }
  });

  it('S-A: small content pool, partition then heal: zero copies of copies, view-independent names', async () => {
    let copiesSeen = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rnd = rng(seed * 7919);
      const { devs, settle, dump } = world(3);
      const pool = ['red', 'black']; // identical edits on different devices are common
      // partition: d0 alone, d1 + d2 together (each side syncs only via its own remote)
      const left = new Remote();
      const right = new Remote();
      const real = devs[0]!.remote;
      const side = (d: Device) => (d === devs[0] ? left : right);
      for (let step = 0; step < 300; step++) {
        const d = devs[rnd(3)]!;
        const op = rnd(9);
        const id = ['p', 'q'][rnd(2)]!;
        d.remote = step < 200 ? side(d) : real; // heal at 200
        if (op < 4) d.edit(id, pool[rnd(2)]!);
        else if (op < 5) d.del(id);
        else if (op < 7) await d.pull();
        else await d.push();
      }
      for (const d of devs) d.remote = real;
      // heal: merge both partitions' lib files into the real remote, then settle
      for (const part of [left, right])
        for (const [dev, m] of part.libs)
          real.libs.set(dev, new Map([...(real.libs.get(dev) ?? []), ...m]));
      await settle();
      const first = dump(devs[0]!);
      for (const d of devs) expect(dump(d), `seed ${seed}`).toBe(first);
      for (const [id, v] of devs[0]!.store) {
        expect(id, `seed ${seed}`).toMatch(/^[pq](-[0-9a-f]{6})?$/); // no copy of a copy
        if (id.length > 1)
          expect(v.name, `seed ${seed}`).toMatch(/^[pq] \(conflict [0-9a-f]{6}\)$/);
        if (id.length > 1) copiesSeen++;
      }
    }
    expect(copiesSeen).toBeGreaterThan(0);
  }, 600_000);

  it.each([true, false])(
    'main fuzz (Replace %s): converge, keep edits, copy counts',
    async (withReplace) => {
      let copiesSeen = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const rnd = rng(seed);
        const { devs, settle, dump } = world(3);
        const ids = ['p', 'q', 'r'];
        for (let step = 0; step < 400; step++) {
          const d = devs[rnd(3)]!;
          const op = rnd(11);
          const id = ids[rnd(3)]!;
          if (op < 4) d.edit(id, `${d.id}-${step}`);
          else if (op < 5) d.del(id);
          else if (op < 8) await d.pull();
          else if (op < 10) await d.push();
          else if (rnd(2) === 0)
            d.remote.libs.delete(d.id); // own lib lost: the index is kept
          else if (withReplace) d.replace(); // Replace: local wiped, vvCounter kept (N1)
        }
        const lastLocal = devs.flatMap((d) =>
          [...d.dirty.keys()]
            .filter((id) => !COPY_ID.test(id))
            .map((id) => d.store.get(id)?.body)
            .filter(Boolean),
        );
        await settle();
        const first = dump(devs[0]!);
        for (const d of devs) expect(dump(d), `seed ${seed}`).toBe(first);
        const all = new Set([...devs[0]!.store.values()].map((v) => v.body));
        for (const b of lastLocal) expect(all.has(b!), `seed ${seed} lost ${b}`).toBe(true);
        // copies are only of the three base ids, and each content is copied at most once
        for (const id of devs[0]!.store.keys())
          expect(id, `seed ${seed}`).toMatch(/^[pqr](-[0-9a-f]{6})?$/);
        const copyBodies = [...devs[0]!.store]
          .filter(([k]) => COPY_ID.test(k))
          .map(([, v]) => `${v.name}|${v.body}`);
        expect(new Set(copyBodies).size, `seed ${seed}`).toBe(copyBodies.length);
        copiesSeen += copyBodies.length;
        // no published edit is lost: every maximal live entry ever published (read by anyone) has its
        // body in the final stores, as itself or as a copy. Without Replace nothing legitimately
        // discards a published edit that no later entry descends from.
        if (!withReplace) {
          const log = [...devs[0]!.remote.log.values()];
          for (const e of log) {
            if (e.deleted || Device.superseded.has(`${e.key}|${e.hlc}`)) continue;
            const dominated = log.some(
              (o) => o.key === e.key && o !== e && descends(o, e) && !descends(e, o),
            );
            if (dominated) continue;
            const body = fromGroup(e.value as ExperimentGroup).body;
            expect(all.has(body), `seed ${seed} lost published ${e.key} ${body}`).toBe(true);
          }
        }
        // no vv value is ever reused: each device's counter is >= its component anywhere
        for (const d of devs)
          for (const e of d.remote.read())
            expect(e.vv[d.id] ?? 0, `seed ${seed}`).toBeLessThanOrEqual(d.vvCounter);
      }
      expect(copiesSeen).toBeGreaterThan(0); // the fuzz really exercises copies
    },
    600_000,
  );
});
