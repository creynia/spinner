// The cross-tab channel (sync.md §7.11): `BroadcastChannel('spinner-sync')`, shared with the token
// messages of the auth source and the redirect return page (`{ type: 'token' }`, ignored here).
import type { SyncKey, SyncKind, SyncStatus } from '@core';

export const CHANNEL_NAME = 'spinner-sync';

export type SyncMessage =
  /** The lock holder's status, mirrored by the other tabs. */
  | { type: 'status'; from: string; status: SyncStatus }
  /** A cycle changed these kinds of local records: every tab refreshes (and reloads its meta). */
  | { type: 'changed'; from: string; kinds: SyncKind[] }
  /** Local edits made in a tab (maybe a hidden one that must not sync): a visible tab picks them up. */
  | { type: 'dirty'; from: string; keys: SyncKey[] };

export interface SyncChannel {
  post(m: SyncMessage): void;
  onMessage(fn: (m: SyncMessage) => void): () => void;
  close(): void;
}

/** The slice of `BroadcastChannel` used; tests pass an in-memory bus. */
export interface ChannelLike {
  postMessage(data: unknown): void;
  addEventListener(type: 'message', fn: (e: { data: unknown }) => void): void;
  removeEventListener(type: 'message', fn: (e: { data: unknown }) => void): void;
  close(): void;
}

const KNOWN = new Set(['status', 'changed', 'dirty']);

function isMessage(d: unknown): d is SyncMessage {
  if (typeof d !== 'object' || d === null) return false;
  const m = d as { type?: unknown; from?: unknown };
  return typeof m.type === 'string' && KNOWN.has(m.type) && typeof m.from === 'string';
}

export function createSyncChannel(make?: () => ChannelLike | null): SyncChannel {
  let ch: ChannelLike | null = null;
  try {
    ch = make
      ? make()
      : typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel(CHANNEL_NAME);
  } catch {
    ch = null; // no cross-tab messages: each tab still works alone
  }
  const fns = new Set<(m: SyncMessage) => void>();
  const on = (e: { data: unknown }): void => {
    if (!isMessage(e.data)) return;
    for (const fn of [...fns]) fn(e.data);
  };
  ch?.addEventListener('message', on);
  return {
    post(m) {
      try {
        ch?.postMessage(m);
      } catch {
        // closed channel
      }
    },
    onMessage(fn) {
      fns.add(fn);
      return () => void fns.delete(fn);
    },
    close() {
      fns.clear();
      ch?.removeEventListener('message', on);
      ch?.close();
      ch = null;
    },
  };
}
