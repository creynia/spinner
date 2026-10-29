// Order-independent merge of sync entries (sync.md §7.4, §7.5). STUB from WP-S0; WP-S2a writes
// the bodies.
import type { DeviceId, SyncEntry, SyncIndexRecord } from '../contracts/sync';
import { notImplemented, notImplementedAsync } from './stub';

export interface Folded {
  winner: SyncEntry;
  losers: SyncEntry[];
  seen: Record<DeviceId, number>;
}

/** Order-independent fold of every entry known for one key (§7.4). Never mutates an input entry. */
export function foldEntries(_all: readonly SyncEntry[], _deletedRuns: ReadonlySet<string>): Folded {
  return notImplemented('S2a', 'foldEntries');
}

/** Same hash and same deleted flag. */
export function equivalent(_a: SyncEntry, _b: SyncEntry): boolean {
  return notImplemented('S2a', 'equivalent');
}

export function joinDef(
  _maximal: readonly SyncEntry<'def'>[],
  _deletedRuns: ReadonlySet<string>,
): SyncEntry<'def'> {
  return notImplemented('S2a', 'joinDef');
}

/**
 * A pure function of the loser's fingerprint: id and name `"<name> (conflict <hex6>)"` are
 * identical across devices (S-A). `null` when the copy id is already taken.
 */
export function copyOf(
  _loser: SyncEntry,
  _deviceName: string,
  _taken: ReadonlySet<string>,
): Promise<SyncEntry | null> {
  return notImplementedAsync('S2a', 'copyOf');
}

export type Resolution =
  | { do: 'skip-older' }
  | { do: 'apply'; entry: SyncEntry }
  | { do: 'keep-local' }
  | { do: 'join'; entry: SyncEntry }
  | { do: 'opaque'; reason: string };

/** foldEntries over remote ∪ {base} ∪ {local candidate}, mapped to an action; losers → copies. */
export function resolve(
  _remote: readonly SyncEntry[],
  _base: SyncIndexRecord | undefined,
  _localCandidate: SyncEntry | undefined,
  _deletedRuns: ReadonlySet<string>,
): { res: Resolution; losers: SyncEntry[]; seen: Record<DeviceId, number> } {
  return notImplemented('S2a', 'resolve');
}
