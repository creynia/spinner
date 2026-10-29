// Order-independent merge of sync entries (sync.md §7.4, §7.5).
import type { DefinitionRecord } from '../contracts/experiment';
import type { DeviceId, Hlc, SyncEntry, SyncIndexRecord, SyncKind } from '../contracts/sync';
import { canonicalJson, sha256Pure, toHex, utf8Encode } from '../experiment';
import { entryOf, fingerprintValue, SUPPORTED_V } from './fingerprint';
import { cmpHlc } from './hlc';
import { descends } from './vv';

export interface Folded {
  winner: SyncEntry;
  losers: SyncEntry[];
  /**
   * The join of the vv of EVERY entry passed in, a local candidate's included. `resolve` computes
   * its own `seen` (published entries and the base only), which is what the engine stores.
   */
  seen: Record<DeviceId, number>;
}

type Vv = Record<DeviceId, number>;

const joinVv = (vs: Iterable<Vv>): Vv => {
  // a Map, so a key such as `__proto__` is just data
  const out = new Map<string, number>();
  for (const v of vs)
    for (const [d, n] of Object.entries(v)) out.set(d, Math.max(out.get(d) ?? 0, n));
  // key order must not depend on the order of the inputs (serialised output is order-independent)
  return Object.fromEntries([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
};
const vvKey = (v: Vv): string =>
  JSON.stringify(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const isDeleted = (e: SyncEntry): boolean => e.deleted === true;
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A total order on entries: HLC, then (only for malformed input) hash and vv. */
function cmpEntry(a: SyncEntry, b: SyncEntry): number {
  return (
    cmpHlc(a.hlc, b.hlc) ||
    cmpStr(a.hash, b.hash) ||
    cmpStr(vvKey(a.vv), vvKey(b.vv)) ||
    Number(isDeleted(a)) - Number(isDeleted(b))
  );
}

/** Newer record schema, or a kind this build does not know: kept, never interpreted. */
function opaqueReason(e: SyncEntry): string | undefined {
  if (!Object.hasOwn(SUPPORTED_V, e.kind)) return `unknown kind ${String(e.kind)} (${e.key})`;
  if (e.v > SUPPORTED_V[e.kind])
    return `${e.key} has record schema v${e.v}; this build understands v${SUPPORTED_V[e.kind]}`;
  return undefined;
}

/** Same hash and same deleted flag. */
export function equivalent(a: SyncEntry, b: SyncEntry): boolean {
  return a.hash === b.hash && isDeleted(a) === isDeleted(b);
}

/** Steps 1 and 2 of the fold: equivalence classes collapse, then the maximal elements. */
function maximalReps(all: readonly SyncEntry[]): SyncEntry[] {
  // 1. equivalence classes collapse into the lowest-HLC entry, with their vvs joined (N3)
  const classes = new Map<string, SyncEntry[]>();
  for (const e of all) {
    const k = `${isDeleted(e) ? 1 : 0}|${e.hash}`;
    const c = classes.get(k);
    if (c) c.push(e);
    else classes.set(k, [e]);
  }
  const reps: SyncEntry[] = [];
  for (const cls of classes.values()) {
    const low = cls.reduce((m, e) => (cmpEntry(e, m) < 0 ? e : m));
    reps.push({ ...low, vv: joinVv(cls.map((c) => c.vv)) });
  }
  // 2. maximal elements under strict vv dominance (no pairwise mutation)
  return reps.filter((e) => !reps.some((o) => o !== e && descends(o, e) && !descends(e, o)));
}

/**
 * Order-independent fold of every entry known for one key (§7.4). Never mutates an input entry.
 * A `def` fold that has an opaque (newer-schema) maximal entry does not join; `resolve` reports
 * such a key as opaque.
 */
export function foldEntries(all: readonly SyncEntry[], deletedRuns: ReadonlySet<string>): Folded {
  if (all.length === 0) throw new Error('foldEntries: empty set');
  const maximal = maximalReps(all);
  const seen = joinVv(all.map((e) => e.vv));
  // 3. winner
  const kind = all[0]!.kind;
  const byPreference = (a: SyncEntry, b: SyncEntry): number =>
    Number(isDeleted(a)) - Number(isDeleted(b)) || cmpEntry(b, a);
  const best = [...maximal].sort(byPreference)[0]!;
  const canJoin = kind === 'def' && !maximal.some((e) => opaqueReason(e) !== undefined);
  const winner = canJoin ? joinDef(maximal as SyncEntry<'def'>[], deletedRuns) : best;
  const losers =
    kind === 'def' || kind === 'setting' || kind === 'run'
      ? []
      : maximal.filter((e) => e !== best && !isDeleted(e)).sort(cmpEntry);
  return { winner, losers, seen };
}

// ------------------------------------------------------------------ joinDef

const DEF_KNOWN = new Set([
  'v',
  'id',
  'definition',
  'createdAt',
  'updatedAt',
  'derivedFrom',
  'displayName',
  'displayNameAt',
  'origin',
  'runIds',
]);

const normRunIds = (ids: readonly string[], deletedRuns: ReadonlySet<string>): string[] =>
  [...new Set(ids)].filter((id) => !deletedRuns.has(id)).sort();

/**
 * The join of the maximal definition entries (§7.5): a pure function of the set. `hlc` is the
 * highest live HLC, `vv` the join of every maximal vv; nothing is minted.
 */
export function joinDef(
  maximal: readonly SyncEntry<'def'>[],
  deletedRuns: ReadonlySet<string>,
): SyncEntry<'def'> {
  if (maximal.length === 0) throw new Error('joinDef: empty set');
  const vv = joinVv(maximal.map((e) => e.vv));
  const live = maximal.filter((e) => !isDeleted(e) && e.value !== null).sort(cmpEntry);
  if (live.length === 0) {
    // every maximal entry is a tombstone (equivalent ones collapse; take the latest regardless)
    const top = [...maximal].sort(cmpEntry).at(-1)!;
    return { ...top, vv };
  }
  if (live.length === 1) {
    const only = live[0]!;
    const ids = (only.value as DefinitionRecord).runIds ?? [];
    const norm = normRunIds(ids, deletedRuns);
    if (norm.length === ids.length && norm.every((x, i) => x === ids[i])) return { ...only, vv };
  }

  const top = live.at(-1)!; // highest HLC
  const recs = live.map((e) => e.value as DefinitionRecord & Record<string, unknown>);
  const topRec = recs.at(-1)!;

  const unknown: Record<string, unknown> = {};
  for (const r of recs) for (const k of Object.keys(r)) if (!DEF_KNOWN.has(k)) unknown[k] = r[k];

  const runIds = normRunIds(
    recs.flatMap((r) => r.runIds ?? []),
    deletedRuns,
  );

  // displayName: later displayNameAt wins, ties by the higher entry HLC (`live` is ascending)
  let nameFrom = 0;
  for (let i = 1; i < recs.length; i++) {
    if ((recs[i]!.displayNameAt ?? '') >= (recs[nameFrom]!.displayNameAt ?? '')) nameFrom = i;
  }
  // origin / derivedFrom: the earlier createdAt (ties: the lower HLC)
  let originFrom = 0;
  for (let i = 1; i < recs.length; i++) {
    if (recs[i]!.createdAt < recs[originFrom]!.createdAt) originFrom = i;
  }

  const value: Record<string, unknown> = {
    ...unknown,
    v: topRec.v,
    id: topRec.id,
    definition: topRec.definition,
    createdAt: recs.reduce((m, r) => (r.createdAt < m ? r.createdAt : m), recs[0]!.createdAt),
    updatedAt: recs.reduce((m, r) => (r.updatedAt > m ? r.updatedAt : m), recs[0]!.updatedAt),
    origin: recs[originFrom]!.origin,
    runIds,
  };
  if (recs[originFrom]!.derivedFrom !== undefined)
    value.derivedFrom = recs[originFrom]!.derivedFrom;
  if (recs[nameFrom]!.displayName !== undefined) value.displayName = recs[nameFrom]!.displayName;
  if (recs[nameFrom]!.displayNameAt !== undefined)
    value.displayNameAt = recs[nameFrom]!.displayNameAt;

  const hash = toHex(sha256Pure(utf8Encode(canonicalJson(fingerprintValue('def', value)))));
  return {
    key: top.key,
    kind: 'def',
    id: top.id,
    hlc: top.hlc,
    basis: top.basis,
    vv,
    hash,
    v: top.v,
    value: value as unknown as DefinitionRecord,
  };
}

// ------------------------------------------------------------------ copyOf

const COPY_KINDS: ReadonlySet<SyncKind> = new Set<SyncKind>(['strategy', 'layout', 'group']);
const SLUG_BASE_MAX = 33;
const NAME_MAX = 80;

function slugBase(id: string): string {
  const s = id
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_BASE_MAX)
    .replace(/-+$/g, '');
  return s === '' ? 'copy' : s;
}

const nameOf = (n: unknown, fallback: string): string => (typeof n === 'string' ? n : fallback);

/** The copy's id and name: a pure function of the loser's fingerprint (S-A). */
function copyName(name: string, hex6: string): string {
  const suffix = ` (conflict ${hex6})`;
  // by code points, so the name never ends in a lone surrogate
  const base = Array.from(name)
    .slice(0, NAME_MAX - suffix.length)
    .join('');
  return `${base.trimEnd()}${suffix}`;
}

/** The copy id for the `n`th attempt: 6 hex digits of the fingerprint, then 12, 18, ... (§7.7). */
const copyIdAt = (loser: SyncEntry, n: number): string | null =>
  loser.hash.length >= 6 * (n + 1)
    ? `${slugBase(loser.id)}-${loser.hash.slice(0, 6 * (n + 1))}`
    : null;

const copyable = (loser: SyncEntry): boolean =>
  COPY_KINDS.has(loser.kind) &&
  !isDeleted(loser) &&
  loser.value !== null &&
  opaqueReason(loser) === undefined &&
  loser.hash !== '';

/** The first-choice id of `loser`'s copy (`<slug>-<hex6>`), or null when it is never copied. */
export function copyIdOf(loser: SyncEntry): string | null {
  return copyable(loser) ? copyIdAt(loser, 0) : null;
}

/**
 * Every id `copyOf` can return for `loser`, in order: `<slug>-<hex6>`, then 12, 18, ... hex digits
 * (empty when the loser is never copied).
 */
export function copyIdChain(loser: SyncEntry): string[] {
  const out: string[] = [];
  if (!copyable(loser)) return out;
  for (let n = 0; ; n++) {
    const id = copyIdAt(loser, n);
    if (id === null) return out;
    out.push(id);
  }
}

/**
 * Whether `existing` (an index entry) is the copy of `loser` already made, on this device or
 * another one: its id is in the chain and its fingerprint equals the copy that id would get; or it
 * is a tombstone at a chain id (a deleted copy).
 * (A copy at the 12-digit id embeds that id, so its hash differs from the 6-digit copy's.)
 */
export async function isCopyOf(loser: SyncEntry, existing: SyncEntry): Promise<boolean> {
  const chain = copyIdChain(loser);
  const n = chain.indexOf(existing.id);
  if (n < 0) return false;
  // A tombstone at a chain id is taken to be a deleted copy (its content is gone, so it cannot be
  // told apart from an unrelated deleted record): it keeps the copy deleted on every device, also
  // those that never made it. The cost is a lost edit only if an unrelated record that lived at
  // exactly this id was deleted (about 2^-24).
  if (isDeleted(existing)) return true;
  const c = await copyOf(loser, new Set(chain.slice(0, n)), {
    hlc: loser.hlc,
    self: 'aaaaaaaaaa',
    counter: 1,
  });
  return c !== null && c.id === existing.id && c.hash === existing.hash;
}

/**
 * The copy of a losing entry. Its id and name `"<name> (conflict <hex6>)"` are a pure function of
 * the loser's fingerprint, identical across devices (S-A). The copy is a fresh entry minted by
 * this device: `hlc = mint.hlc`, `basis = null`, `vv = { [mint.self]: mint.counter }` where
 * `counter` is a fresh `vvCounter` value the caller consumed.
 *
 * When the first-choice id is taken, the id grows by the next 6 hex digits of the fingerprint
 * (12, 18, ...) until it is free (§7.7); the name always keeps hex6. `null` for kinds that are
 * never copied (def, setting, run), a tombstone, an entry this build cannot interpret, or when
 * every id of the chain is taken.
 *
 * ENGINE CONTRACT (sync.md §7.7), for each loser `l`, with `chain = copyIdChain(l)`:
 *  1. The id `copyOf` returns is what goes into `syncMeta.copies`.
 *  2. Skip `l` if any id of `chain` is in `copies`. This keeps a deleted copy deleted (accepted: if
 *     the user deletes a copy and the identical content comes back, no new copy is made).
 *  3. Skip `l` if any id of `chain` has an index entry, or a not-yet-applied remote entry of this
 *     cycle, for which `isCopyOf(l, entry)` holds (the copy exists, made here or by another device).
 *  4. `taken` holds only chain ids that have an index, store or incoming remote entry with other
 *     content (a live record that is not the copy). A tombstone at a chain id counts as a deleted copy (rule 3).
 * Without rules 2-3 a copy at the 12-digit id would be recreated every cycle.
 */
export async function copyOf(
  loser: SyncEntry,
  taken: ReadonlySet<string>,
  mint: { hlc: Hlc; self: DeviceId; counter: number },
): Promise<SyncEntry | null> {
  if (!copyable(loser)) return null;
  const hex6 = loser.hash.slice(0, 6);
  let copyId: string | null = null;
  for (let n = 0; copyId === null; n++) {
    const c = copyIdAt(loser, n);
    if (c === null) return null; // every prefix of the fingerprint is taken
    if (!taken.has(c)) copyId = c;
  }
  const src = loser.value as unknown as Record<string, unknown>;
  switch (loser.kind) {
    case 'strategy': {
      const strat = src.strategy as Record<string, unknown>;
      const strategy = {
        ...strat,
        id: copyId,
        name: copyName(nameOf(strat.name, loser.id), hex6),
      };
      const hash = toHex(sha256Pure(utf8Encode(canonicalJson(strategy))));
      return entryOf(
        'strategy',
        copyId,
        { ...src, id: copyId, strategy, hash } as never,
        mint.hlc,
        undefined,
        mint.self,
        mint.counter,
      );
    }
    case 'layout': {
      const layout = src.layout as Record<string, unknown>;
      const value = {
        ...src,
        id: copyId,
        layout: { ...layout, id: copyId, name: copyName(nameOf(layout.name, loser.id), hex6) },
      };
      return entryOf(
        'layout',
        copyId,
        value as never,
        mint.hlc,
        undefined,
        mint.self,
        mint.counter,
      );
    }
    default: {
      const value = { ...src, id: copyId, name: copyName(nameOf(src.name, loser.id), hex6) };
      return entryOf('group', copyId, value as never, mint.hlc, undefined, mint.self, mint.counter);
    }
  }
}

// ------------------------------------------------------------------ resolve

export type Resolution =
  | { do: 'skip-older' }
  | { do: 'apply'; entry: SyncEntry }
  | { do: 'keep-local' }
  | { do: 'join'; entry: SyncEntry }
  | { do: 'opaque'; reason: string };

/** foldEntries over remote ∪ {base} ∪ {local candidate}, mapped to an action; losers → copies. */
export function resolve(
  remote: readonly SyncEntry[],
  base: SyncIndexRecord | undefined,
  localCandidate: SyncEntry | undefined,
  deletedRuns: ReadonlySet<string>,
): { res: Resolution; losers: SyncEntry[]; seen: Record<DeviceId, number> } {
  const published = base ? [...remote, base.entry] : [...remote];
  const seen = joinVv([...published.map((e) => e.vv), base?.seen ?? {}]);
  const all = localCandidate ? [...published, localCandidate] : published;
  if (all.length === 0) return { res: { do: 'skip-older' }, losers: [], seen };

  // An opaque (newer-schema) entry that is maximal must not be overwritten, by a winner or by a
  // push whose `seen` would dominate it: the key stays as it is and the local mark stays.
  for (const m of maximalReps(all)) {
    const reason = opaqueReason(m);
    if (reason !== undefined) return { res: { do: 'opaque', reason }, losers: [], seen };
  }
  const f = foldEntries(all, deletedRuns);
  const w = f.winner;
  const losers = f.losers;

  if (localCandidate && equivalent(w, localCandidate)) {
    const twins = published.filter((e) => equivalent(e, localCandidate));
    // our edit already exists on the remote: take that entry as published, and drop the mark
    if (twins.length > 0) {
      const entry = foldEntries(twins, deletedRuns).winner;
      // ... but only if that entry descends every published entry. Otherwise applying it would
      // let a concurrent published entry win again (a deleted record would come back): our
      // candidate, which descends all of them, is pushed instead.
      if (published.every((o) => descends(entry, o))) {
        return { res: { do: 'apply', entry }, losers, seen };
      }
      return { res: { do: 'keep-local' }, losers, seen };
    }
    return { res: { do: 'keep-local' }, losers, seen };
  }
  if (!localCandidate && base && equivalent(w, base.entry)) {
    return { res: { do: 'skip-older' }, losers, seen };
  }
  if (w.kind === 'def' && !all.some((e) => equivalent(e, w))) {
    return { res: { do: 'join', entry: w }, losers, seen };
  }
  return { res: { do: 'apply', entry: w }, losers, seen };
}
