// Erase the remote, reset local sync state (sync.md §7.10). WP-S2c.
import {
  SYNCED_SETTING_KEYS,
  SYNC_FORMAT,
  SYNC_LAYOUT_VERSION,
  RemoteError,
} from '../contracts/sync';
import type { SyncRootV1 } from '../contracts/sync';
import { canonicalJson, utf8Encode } from '../experiment';
import type { Backend, StoreName } from '../store';
import { internalOf } from './apply';
import type { SyncCtx } from './ctx';
import { ROOT_NAME } from './libfile';
import { sigOf } from './runs';

/**
 * The `syncMeta` rows a local reset clears: what describes the old remote or the old index.
 * Never `device` or `vvCounter` (N1), and never `prefs`, `account`, `clock` or `conflicts`: the
 * caller (account switch, erase, Replace) owns those. `copies` is cleared by erase only.
 */
export const RESET_META = [
  'seen',
  'files',
  'last',
  'libSha',
  'bundles',
  'uploads',
  'gcAt',
] as const;

/** Result stores of a run; cleared with `runs` when a device's data is replaced. */
const RUN_STORES: readonly StoreName[] = [
  'runs',
  'runParts',
  'summaries',
  'checkpoints',
  'breakdowns',
  'samples',
];
const LIBRARY_STORES: readonly StoreName[] = ['definitions', 'strategies', 'layouts', 'groups'];

export interface ClearOptions {
  /** Also forget the copy ids (erase). */
  copies?: boolean;
  /** Also delete every record of the synced stores, in the same transaction (Replace). */
  wipeData?: boolean;
}

/** One transaction through `raw`: no dirty mark is written, and nothing is half-cleared. */
export async function clearLocal(raw: Backend, o: ClearOptions = {}): Promise<void> {
  const meta = new Set<string>([...RESET_META, ...(o.copies ? ['copies'] : [])]);
  const stores: StoreName[] = ['syncIndex', 'syncDirty', 'syncMeta'];
  const dels: [StoreName, IDBValidKey][] = [];
  for (const s of ['syncIndex', 'syncDirty'] as const) {
    for (const k of await raw.getAllKeys(s)) dels.push([s, k]);
  }
  for (const k of await raw.getAllKeys('syncMeta')) {
    if (typeof k === 'string' && meta.has(k)) dels.push(['syncMeta', k]);
  }
  if (o.wipeData) {
    for (const s of [...LIBRARY_STORES, ...RUN_STORES]) {
      stores.push(s);
      for (const k of await raw.getAllKeys(s)) dels.push([s, k]);
    }
    stores.push('settings');
    for (const k of SYNCED_SETTING_KEYS) dels.push(['settings', k]);
  }
  await raw.tx(stores, 'readwrite', (t) => {
    for (const [s, k] of dels) t.delete(s, k);
  });
}

/**
 * Remove my data from Drive: the root is rewritten with `erased` first (other devices stop at
 * once), then every other file goes, one at a time. Safe to repeat after a failure. Then the
 * local sync state is reset, `copies` included; local data stays. Signing out is the caller's.
 */
export async function eraseRemote(ctx: SyncCtx): Promise<void> {
  const st = internalOf(ctx);
  const { remote, deps } = ctx;
  const o = sigOf(ctx);
  const files = await remote.list(o);
  const at = new Date(deps.now()).toISOString();
  const doc: SyncRootV1 = {
    format: SYNC_FORMAT,
    version: SYNC_LAYOUT_VERSION,
    createdAt: at,
    createdBy: ctx.deviceId,
    erased: { at, by: ctx.deviceId },
  };
  const bytes = utf8Encode(canonicalJson(doc as never));
  const roots = files
    .filter((f) => f.name === ROOT_NAME)
    .sort((a, b) =>
      a.modifiedTime < b.modifiedTime ? -1 : a.modifiedTime > b.modifiedTime ? 1 : 0,
    );
  const keep = roots[0];
  if (keep) {
    try {
      await remote.update(keep.id, bytes, o);
    } catch (e) {
      if (!(e instanceof RemoteError) || e.code !== 'not-found') throw e;
      await remote.create(ROOT_NAME, bytes, { appProperties: { kind: 'root' }, ...(o ?? {}) });
    }
  } else {
    await remote.create(ROOT_NAME, bytes, { appProperties: { kind: 'root' }, ...(o ?? {}) });
  }
  const rest = files.filter((f) => f.id !== keep?.id);
  let n = 0;
  deps.onProgress({ phase: 'gc', done: 0, total: rest.length });
  for (const f of rest) {
    deps.signal?.throwIfAborted();
    try {
      await remote.delete(f.id, o);
    } catch (e) {
      if (!(e instanceof RemoteError) || e.code !== 'not-found') throw e;
    }
    deps.onProgress({ phase: 'gc', done: ++n, total: rest.length });
  }
  await clearLocal(st.raw, { copies: true });
}

/**
 * Clears `syncIndex`, `syncDirty` and the rows of `RESET_META`, never `device` or `vvCounter`
 * (N1) and never `copies` (a deleted copy stays deleted through re-seed, account switch and
 * Replace). With `last` gone, the next cycle is a first sync.
 */
export async function resetLocalSyncState(ctx: SyncCtx): Promise<void> {
  await clearLocal(internalOf(ctx).raw);
}
