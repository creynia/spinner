/**
 * PROTOTYPE model of the merge rule (sync.md §7.4, review B1): per-key version vectors as the
 * transitive form of parent pointers, `basis` = the parent's HLC, a deterministic winner for
 * concurrent entries (an edit beats a delete, else the higher HLC), and a deterministic conflicted
 * copy of each concurrent loser, so any device can create the copy and all devices create the same one.
 * Only strategy/layout-like kinds (whole-record values under a user slug) are modelled.
 */
export type Vv = Record<string, number>;
export interface Entry {
  id: string;
  /** `<wall>.<counter>.<device>` compared as a tuple. */
  hlc: [number, number, string];
  /** HLC of the entry this one was edited from (null: created fresh). Informational; `vv` decides. */
  basis: [number, number, string] | null;
  vv: Vv;
  deleted: boolean;
  value: { name: string; body: string } | null;
}

export const cmpHlc = (a: Entry['hlc'], b: Entry['hlc']): number =>
  a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);

/** a ≥ b pointwise. */
export function dominates(a: Vv, b: Vv): boolean {
  for (const [d, n] of Object.entries(b)) if ((a[d] ?? 0) < n) return false;
  return true;
}
export const joinVv = (a: Vv, b: Vv): Vv => {
  const out: Vv = { ...a };
  for (const [d, n] of Object.entries(b)) out[d] = Math.max(out[d] ?? 0, n);
  return out;
};
export const sameEntry = (a: Entry, b: Entry): boolean => cmpHlc(a.hlc, b.hlc) === 0;

/** Deterministic copy id: same on every device (the loser's id + a content fingerprint). */
export function copyIdOf(loser: Entry): string {
  let h = 2166136261;
  for (const ch of `${loser.id}|${loser.value?.body}|${loser.hlc.join('.')}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return `${loser.id}-${(h >>> 0).toString(36).padStart(7, '0').slice(0, 6)}`;
}

/**
 * Merge two entries for one key. Commutative, associative, idempotent on the winner; `losers`
 * are the concurrent live entries that did not win (each becomes a conflicted copy).
 */
export function merge(a: Entry, b: Entry): { winner: Entry; losers: Entry[] } {
  if (sameEntry(a, b)) return { winner: a, losers: [] };
  if (dominates(a.vv, b.vv)) return { winner: a, losers: [] };
  if (dominates(b.vv, a.vv)) return { winner: b, losers: [] };
  // concurrent
  let w: Entry;
  if (a.deleted !== b.deleted) w = a.deleted ? b : a; // an edit beats a delete
  else w = cmpHlc(a.hlc, b.hlc) > 0 ? a : b;
  const l = w === a ? b : a;
  // the winner absorbs the loser's history, so later merges see it as a descendant of both
  const winner: Entry = { ...w, vv: joinVv(a.vv, b.vv) };
  return { winner, losers: l.deleted ? [] : [l] };
}

// ------------------------------------------------------------------ a tiny device + remote model

export class Remote {
  libs = new Map<string, Map<string, Entry>>();
  /** Each device writes only its own lib (sync.md D5). */
  write(dev: string, entries: Map<string, Entry>): void {
    this.libs.set(dev, new Map([...entries].map(([k, e]) => [k, structuredClone(e)])));
  }
  read(): Entry[] {
    return [...this.libs.values()].flatMap((m) => [...m.values()].map((e) => structuredClone(e)));
  }
}

export class Device {
  /** Local records (what the app shows). */
  store = new Map<string, { name: string; body: string }>();
  /** syncIndex: last agreed entry per id. */
  base = new Map<string, Entry>();
  /** syncDirty: id -> edit time (`at`); entries are minted from edit time, not push time. */
  dirty = new Map<string, number>();
  /** Copies already created or seen (never recreate after a delete). */
  seenCopies = new Set<string>();
  private wall = 0;
  private ctr = 0;
  constructor(
    readonly id: string,
    readonly remote: Remote,
    private readonly clock: () => number,
  ) {}

  private tick(at: number): Entry['hlc'] {
    const now = at;
    if (now > this.wall) {
      this.wall = now;
      this.ctr = 0;
    } else this.ctr += 1;
    return [this.wall, this.ctr, this.id];
  }
  private recv(h: Entry['hlc']): void {
    if (h[0] > this.wall || (h[0] === this.wall && h[1] > this.ctr)) [this.wall, this.ctr] = [h[0], h[1]];
  }

  edit(id: string, body: string): void {
    this.store.set(id, { name: id, body });
    this.dirty.set(id, this.clock());
  }
  del(id: string): void {
    this.store.delete(id);
    this.dirty.set(id, this.clock());
  }

  /** Pull and apply every lib file (sync.md §7.3 PULL + APPLY). */
  pull(): void {
    const byId = new Map<string, Entry>();
    const losers: Entry[] = [];
    for (const e of this.remote.read()) {
      const have = byId.get(e.id);
      if (!have) byId.set(e.id, e);
      else {
        const m = merge(have, e);
        byId.set(e.id, m.winner);
        losers.push(...m.losers);
      }
    }
    for (const r of byId.values()) {
      this.recv(r.hlc);
      const base = this.base.get(r.id);
      if (base && dominates(base.vv, r.vv)) continue; // already have it (or newer)
      if (this.dirty.has(r.id)) {
        // a local unpushed edit is concurrent with anything not already in the base
        const local = this.localEntry(r.id, base);
        const m = merge(local, r);
        losers.push(...m.losers);
        this.base.set(r.id, { ...r, vv: m.winner.vv });
        if (m.winner === local || sameEntry(m.winner, local)) {
          // local wins: keep it dirty, it pushes with the joined history
        } else {
          this.apply(m.winner);
          this.dirty.delete(r.id);
        }
        continue;
      }
      const m = base ? merge(base, r) : { winner: r, losers: [] as Entry[] };
      losers.push(...m.losers);
      this.base.set(r.id, m.winner);
      this.apply(m.winner);
    }
    for (const l of losers) this.makeCopy(l);
  }

  private localEntry(id: string, base: Entry | undefined): Entry {
    const v = this.store.get(id) ?? null;
    return {
      id,
      hlc: [this.dirty.get(id) ?? 0, 0, this.id], // unpushed: its edit time
      basis: base?.hlc ?? null,
      vv: { ...(base?.vv ?? {}), [this.id]: (base?.vv[this.id] ?? 0) + 1 },
      deleted: v === null,
      value: v,
    };
  }

  private apply(e: Entry): void {
    if (e.deleted || !e.value) this.store.delete(e.id);
    else this.store.set(e.id, { ...e.value });
  }

  private makeCopy(l: Entry): void {
    if (!l.value) return;
    const cid = copyIdOf(l);
    if (this.seenCopies.has(cid) || this.base.has(cid)) return;
    this.seenCopies.add(cid);
    this.store.set(cid, { name: `${l.value.name} (${l.hlc[2]})`, body: l.value.body });
    this.dirty.set(cid, this.clock());
  }

  /** Push: mint entries for dirty ids and write our whole lib (sync.md §7.3 PUSH). */
  push(): void {
    for (const [id, at] of this.dirty) {
      const base = this.base.get(id);
      const v = this.store.get(id) ?? null;
      if (!base && v === null) continue;
      const e: Entry = {
        id,
        hlc: this.tick(at),
        basis: base?.hlc ?? null,
        vv: { ...(base?.vv ?? {}), [this.id]: (base?.vv[this.id] ?? 0) + 1 },
        deleted: v === null,
        value: v,
      };
      this.base.set(id, e);
    }
    this.dirty.clear();
    this.remote.write(this.id, this.base);
  }
}
