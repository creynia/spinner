/**
 * PROTOTYPE model of the merge rule (sync.md §7.4, rev 3). Covers whole-record kinds only
 * (strategy, layout, group): a value under a user id.
 *
 * - `vv`: a per-key version vector. This device's component comes from ONE persistent, monotone
 *   per-device counter (`syncMeta.vvCounter`) that survives every reset (N1).
 * - `fold(set)` does not depend on the order of the set (N2):
 *   1. Equivalent entries (same fingerprint and deleted flag) collapse into the lowest-HLC one, with
 *      their vvs joined (N3).
 *   2. Then it takes the maximal elements under strict vv dominance.
 *   3. Among them, the winner is an edit over a delete, then the higher HLC.
 *   4. Every other maximal live entry is a loser, which becomes a deterministic copy.
 *   No entry's ancestry is ever fabricated. The only vv change is the join inside an equivalence
 *   class of identical content.
 * - `seen`: the join of every folded published vv. It is kept locally as the basis of the next
 *   local edit and is never published as the winner's own vv.
 */
export type Vv = Record<string, number>;
export type Hlc = [number, number, string];
export interface Entry {
  id: string;
  hlc: Hlc;
  /** Parent HLC. Informational only; `vv` decides ancestry. */
  basis: Hlc | null;
  vv: Vv;
  deleted: boolean;
  value: { name: string; body: string } | null;
}

export const cmpHlc = (a: Hlc, b: Hlc): number =>
  a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);
export function dominates(a: Vv, b: Vv): boolean {
  for (const [d, n] of Object.entries(b)) if ((a[d] ?? 0) < n) return false;
  return true;
}
const strictlyDominates = (a: Vv, b: Vv): boolean => dominates(a, b) && !dominates(b, a);
export const joinVv = (...vs: Vv[]): Vv => {
  const out: Vv = {};
  for (const v of vs) for (const [d, n] of Object.entries(v)) out[d] = Math.max(out[d] ?? 0, n);
  return out;
};
export const fp = (e: Entry): string => (e.deleted ? 'DEL' : `${e.value?.name}|${e.value?.body}`);
const vvKey = (v: Vv): string => JSON.stringify(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)));

export function copyIdOf(loser: Entry): string {
  let h = 2166136261;
  for (const ch of `${loser.id}|${fp(loser)}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return `${loser.id}-${(h >>> 0).toString(36).padStart(7, '0').slice(0, 6)}`;
}
export const isCopyId = (id: string): boolean => /-[0-9a-z]{6}$/.test(id);

export interface Folded {
  winner: Entry;
  losers: Entry[];
  /** The join of every folded vv: the basis for this device's next edit (never published). */
  seen: Vv;
}

/** Order-independent fold of every entry known for one key. */
export function fold(all: readonly Entry[]): Folded {
  if (all.length === 0) throw new Error('empty');
  const classes = new Map<string, Entry[]>();
  for (const e of all) classes.set(fp(e), [...(classes.get(fp(e)) ?? []), e]);
  const reps: Entry[] = [...classes.values()].map((cls) => {
    const low = [...cls].sort((a, b) => cmpHlc(a.hlc, b.hlc))[0]!;
    return { ...low, vv: joinVv(...cls.map((c) => c.vv)) };
  });
  const maximal = reps.filter((e) => !reps.some((o) => o !== e && strictlyDominates(o.vv, e.vv)));
  const winner = [...maximal].sort((a, b) =>
    a.deleted !== b.deleted ? (a.deleted ? 1 : -1) : cmpHlc(b.hlc, a.hlc),
  )[0]!;
  const losers = maximal
    .filter((e) => e !== winner && !e.deleted)
    .sort((a, b) => cmpHlc(a.hlc, b.hlc));
  return { winner, losers, seen: joinVv(...all.map((e) => e.vv)) };
}

/** A comparable summary of a fold, for the permutation tests. */
export const foldSig = (f: Folded): string =>
  JSON.stringify([
    fp(f.winner),
    f.winner.hlc,
    vvKey(f.winner.vv),
    f.losers.map((l) => [fp(l), l.hlc]),
    vvKey(f.seen),
  ]);

// ------------------------------------------------------------------ device + remote model

export class Remote {
  libs = new Map<string, Map<string, Entry>>();
  write(dev: string, entries: Map<string, Entry>): void {
    this.libs.set(dev, new Map([...entries].map(([k, e]) => [k, structuredClone(e)])));
  }
  read(): Entry[] {
    return [...this.libs.values()].flatMap((m) => [...m.values()].map((e) => structuredClone(e)));
  }
}

interface IndexRow {
  /** Published as-is. */
  entry: Entry;
  /** Local only. */
  seen: Vv;
}

export class Device {
  store = new Map<string, { name: string; body: string }>();
  index = new Map<string, IndexRow>();
  /** id -> edit time. */
  dirty = new Map<string, number>();
  copies = new Set<string>();
  /** N1: persistent and monotone across resets (`syncMeta.vvCounter`). */
  private vvCounter = 0;
  private needsPull = false;
  private wall = 0;
  private ctr = 0;
  constructor(
    readonly id: string,
    readonly remote: Remote,
    private readonly clock: () => number,
  ) {}

  private tickAt(at: number): Hlc {
    if (at > this.wall) {
      this.wall = at;
      this.ctr = 0;
    } else this.ctr += 1;
    return [this.wall, this.ctr, this.id];
  }
  private recv(h: Hlc): void {
    if (h[0] > this.wall || (h[0] === this.wall && h[1] > this.ctr)) [this.wall, this.ctr] = [h[0], h[1]];
  }

  edit(id: string, body: string): void {
    this.store.set(id, { name: this.store.get(id)?.name ?? id, body });
    this.dirty.set(id, this.clock());
  }
  del(id: string): void {
    this.store.delete(id);
    this.dirty.set(id, this.clock());
  }
  /**
   * `resetLocalSyncState` (account switch): forget the index, keep the local records, the device
   * id and `vvCounter`; every record becomes a candidate (pull happens before push).
   */
  reset(): void {
    this.needsPull = true; // a re-seed is begin('merge'): it pulls before it pushes
    this.index.clear();
    this.copies.clear();
    for (const id of this.store.keys()) this.dirty.set(id, this.clock());
  }

  /** Replace: wipe local records and sync state; `vvCounter` survives (N1). */
  replace(): void {
    this.store.clear();
    this.index.clear();
    this.dirty.clear();
    this.copies.clear();
    this.needsPull = true;
  }

  private candidate(id: string, at: number): Entry {
    const row = this.index.get(id);
    const v = this.store.get(id) ?? null;
    return {
      id,
      hlc: [at, 0, this.id],
      basis: row?.entry.hlc ?? null,
      // consumes a real counter value: a candidate's vv may be absorbed (equivalence join), so its
      // component must never be reused by a later, different entry (gaps are harmless)
      vv: { ...(row?.seen ?? {}), [this.id]: ++this.vvCounter },
      deleted: v === null,
      value: v ? { ...v } : null,
    };
  }

  pull(): void {
    this.needsPull = false;
    const byId = new Map<string, Entry[]>();
    for (const e of this.remote.read()) byId.set(e.id, [...(byId.get(e.id) ?? []), e]);
    for (const [id, remote] of byId) {
      for (const e of remote) this.recv(e.hlc);
      const row = this.index.get(id);
      const at = this.dirty.get(id);
      const published = [...remote, ...(row ? [row.entry] : [])];
      const local = at !== undefined ? this.candidate(id, at) : undefined;
      const f = fold(local ? [...published, local] : published);
      const seen = joinVv(...published.map((e) => e.vv), row?.seen ?? {});
      const winnerIsLocal =
        local !== undefined && fp(f.winner) === fp(local) && !published.some((e) => fp(e) === fp(local));
      if (winnerIsLocal) {
        // Stays dirty. The next push mints from `seen`, so it descends from everything folded.
        this.index.set(id, { entry: row?.entry ?? f.winner, seen });
      } else {
        const w = f.winner;
        if (w.deleted || !w.value) this.store.delete(id);
        else this.store.set(id, { ...w.value });
        this.dirty.delete(id);
        this.index.set(id, { entry: w, seen });
      }
      for (const l of f.losers) this.makeCopy(l);
    }
  }

  private makeCopy(l: Entry): void {
    if (!l.value) return;
    const cid = copyIdOf(l);
    if (this.copies.has(cid) || this.index.has(cid) || this.store.has(cid)) return;
    this.copies.add(cid);
    this.store.set(cid, { name: `${l.value.name} (${l.hlc[2]})`, body: l.value.body });
    this.dirty.set(cid, l.hlc[0]); // the loser's edit time
  }

  push(): void {
    if (this.needsPull) this.pull();
    for (const [id, at] of this.dirty) {
      const row = this.index.get(id);
      const v = this.store.get(id) ?? null;
      if (!row && v === null) continue;
      const e: Entry = {
        id,
        hlc: this.tickAt(at),
        basis: row?.entry.hlc ?? null,
        vv: { ...(row?.seen ?? {}), [this.id]: ++this.vvCounter },
        deleted: v === null,
        value: v ? { ...v } : null,
      };
      this.index.set(id, { entry: e, seen: e.vv });
    }
    this.dirty.clear();
    this.remote.write(this.id, new Map([...this.index].map(([k, r]) => [k, r.entry])));
  }
}
