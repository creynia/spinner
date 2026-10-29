// WP-S0: every stub throws "not implemented (WP-Sx)" until its package lands. A package that
// implements a stub deletes its row here; the signatures (checked by tsc) stay frozen.
import { describe, expect, it } from 'vitest';
import type { SyncEntry } from '../contracts/sync';
import * as sync from './index';

const entry = {} as SyncEntry;
const hlc = '0mh3k2z1c.0000.7k2m9qxd4a';
const WP = /^not implemented \(WP-(S2a|S2b)\): /;

const syncStubs: [string, string, () => unknown][] = [
  ['createClock', 'S2a', () => sync.createClock('7k2m9qxd4a', () => 0)],
  ['hlcDevice', 'S2a', () => sync.hlcDevice(hlc)],
  ['hlcWall', 'S2a', () => sync.hlcWall(hlc)],
  ['cmpHlc', 'S2a', () => sync.cmpHlc(hlc, hlc)],
  ['fingerprintValue', 'S2a', () => sync.fingerprintValue('def', {})],
  ['descends', 'S2a', () => sync.descends(entry, entry)],
  ['concurrent', 'S2a', () => sync.concurrent(entry, entry)],
  ['foldEntries', 'S2a', () => sync.foldEntries([], new Set())],
  ['equivalent', 'S2a', () => sync.equivalent(entry, entry)],
  ['joinDef', 'S2a', () => sync.joinDef([], new Set())],
  ['resolve', 'S2a', () => sync.resolve([], undefined, undefined, new Set())],
  ['LIB_NAME', 'S2a', () => sync.LIB_NAME('7k2m9qxd4a')],
  ['runBundleName', 'S2a', () => sync.runBundleName('r', 'd')],
  ['createMemoryRemote', 'S2b', () => sync.createMemoryRemote()],
  [
    'createSyncEngine',
    'S2b',
    () => sync.createSyncEngine({} as unknown as Parameters<typeof sync.createSyncEngine>[0]),
  ],
];

const asyncStubs: [string, string, () => Promise<unknown>][] = [
  ['entryOf', 'S2a', () => sync.entryOf('setting', 'framing', null, hlc, undefined, '7k2m9qxd4a')],
  ['verifyEntry', 'S2a', () => sync.verifyEntry(entry)],
  ['copyOf', 'S2a', () => sync.copyOf(entry, 'Laptop', new Set())],
  ['encodeLib', 'S2a', () => sync.encodeLib({} as never)],
  ['decodeLib', 'S2a', () => sync.decodeLib(new Uint8Array())],
];

describe('core/sync stubs (WP-S0)', () => {
  it.each(syncStubs)('%s throws not implemented (WP-%s)', (_name, wp, call) => {
    expect(call).toThrow(WP);
    expect(call).toThrow(`(WP-${wp})`);
  });
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
