// Test helpers for the pure sync parts (not exported from the barrel).
import { canonicalJson } from '../experiment';
import type { Json } from '../contracts/game';
import type { DeviceId, SyncEntry, SyncKind } from '../contracts/sync';

export function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
}

export function perms<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  return xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

/** Deterministic PRNG (LCG), `rnd(n)` in [0, n). */
export function rng(seed: number): (n: number) => number {
  let s = seed >>> 0 || 1;
  return (n) => ((s = (s * 1103515245 + 12345) >>> 0) >>> 8) % n;
}

export const DEVICES = ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc', 'dddddddddd'] as const;

export const hlcOf = (wall: number, device: DeviceId, counter = 0): string =>
  `${wall.toString(36).padStart(9, '0')}.${counter.toString(36).padStart(4, '0')}.${device}`;

/** A bare entry (no verified hash): `hash` stands for the content, `null` is a tombstone. */
export function bare(
  kind: SyncKind,
  id: string,
  device: DeviceId,
  wall: number,
  vv: Record<DeviceId, number>,
  content: string | null,
  value?: unknown,
): SyncEntry {
  return {
    key: `${kind}:${id}`,
    kind,
    id,
    hlc: hlcOf(wall, device),
    basis: null,
    vv,
    hash: content === null ? '' : content,
    ...(content === null ? { deleted: true as const } : {}),
    v: 1,
    value: content === null ? null : (value ?? { content }),
  } as SyncEntry;
}

/** Everything that identifies a fold result, as one comparable string. */
export function foldSig(f: {
  winner: SyncEntry;
  losers: SyncEntry[];
  seen: Record<string, number>;
}): string {
  return canonicalJson([f.winner, f.losers, f.seen] as unknown as Json);
}
