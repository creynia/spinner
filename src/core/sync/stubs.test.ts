// WP-S0: every remaining stub throws "not implemented (WP-Sx)" until its package lands. A package that
// implements a stub deletes its row here; the signatures (checked by tsc) stay frozen.
import { describe, expect, it } from 'vitest';
import * as sync from './index';

const ctx = {} as sync.SyncCtx;
const WP = /^not implemented \(WP-S2c\): /;

const asyncStubs: [string, string, () => Promise<unknown>][] = [
  ['uploadPendingRuns', 'S2c', () => sync.uploadPendingRuns(ctx, 0)],
  ['downloadRun', 'S2c', () => sync.downloadRun(ctx, 'r')],
  ['evictRun', 'S2c', () => sync.evictRun(ctx, 'r')],
  ['runGc', 'S2c', () => sync.runGc(ctx)],
  ['previewFirst', 'S2c', () => sync.previewFirst(ctx)],
  ['beginFirst', 'S2c', () => sync.beginFirst(ctx, 'merge')],
  ['reseed', 'S2c', () => sync.reseed(ctx)],
  ['eraseRemote', 'S2c', () => sync.eraseRemote(ctx)],
  ['resetLocalSyncState', 'S2c', () => sync.resetLocalSyncState(ctx)],
];

describe('core/sync stubs (WP-S0)', () => {
  it.each(asyncStubs)('%s rejects not implemented (WP-%s)', async (_name, wp, call) => {
    const p = call(); // never throws synchronously
    await expect(p).rejects.toThrow(WP);
    await expect(call()).rejects.toThrow(`(WP-${wp})`);
  });
  it('keeps the constants real', () => {
    expect(sync.ROOT_NAME).toBe('spinner-sync.json');
    expect(Object.keys(sync.SUPPORTED_V).sort()).toEqual([
      'def',
      'group',
      'layout',
      'run',
      'setting',
      'strategy',
    ]);
  });
});
