import { describe, expect, it } from 'vitest';
import { RESERVED_STOP_REASONS, STRATEGY_SCHEMA } from './strategy';
import { DEFINITION_SCHEMA, SHARE_LINK_MAX_CHARS } from './experiment';
import { ENDED_BY, ENDED_BY_STRATEGY_BASE, MAX_ROUNDS, MAX_SESSIONS, type RunMeta } from './run';
import {
  DEVICE_ID_PATTERN,
  HLC_PATTERN,
  RemoteError,
  RESUMABLE_CHUNK,
  RESUMABLE_THRESHOLD,
  SYNC_FORMAT,
  SYNC_KINDS,
  SYNC_LAYOUT_VERSION,
  SYNCED_SETTING_KEYS,
  type AuthState,
  type LibFileV1,
  type RunStub,
  type SyncAccountRecord,
  type SyncEntry,
  type SyncErrorCode,
  type SyncMetaRecord,
  type SyncState,
} from './sync';
import { SIM_PROTOCOL } from './protocol';
import { CORE_VERSION } from './version';
import {
  LAYOUT_FILE_FORMAT,
  LAYOUT_SCHEMA,
  MAX_CHIPS_PER_SPOT,
  MAX_LAYOUT_SPOTS,
  STAGE_CHIPS_KEY,
  type ChipLayout,
  type ChipValue,
  type LayoutFileV1,
  type LayoutRecord,
  type StageChips,
} from './layout';

describe('contract constants', () => {
  it('has a semver core version (R5: it lives in contracts/version.ts)', () => {
    expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('freezes the schema versions and limits', () => {
    expect([STRATEGY_SCHEMA, DEFINITION_SCHEMA, SIM_PROTOCOL]).toEqual([1, 1, 1]);
    expect([MAX_SESSIONS, MAX_ROUNDS, SHARE_LINK_MAX_CHARS]).toEqual([100_000, 100_000, 8000]);
  });
  it('reserves exactly the session-level endedBy names for strategies (S8)', () => {
    expect([...RESERVED_STOP_REASONS].sort()).toEqual(Object.keys(ENDED_BY).sort());
    expect(Math.max(...Object.values(ENDED_BY))).toBeLessThan(ENDED_BY_STRATEGY_BASE);
  });
});

describe('chip layout contract (layouts.md §2, §10)', () => {
  it('freezes the layout constants', () => {
    expect([LAYOUT_SCHEMA, MAX_LAYOUT_SPOTS, MAX_CHIPS_PER_SPOT]).toEqual([1, 64, 1000]);
    expect([STAGE_CHIPS_KEY, LAYOUT_FILE_FORMAT]).toEqual(['x-chips', 'casino-lab-layout']);
  });
  it('type-checks sample layouts, stage chips and a layout file', () => {
    const layout: ChipLayout = {
      schema: LAYOUT_SCHEMA,
      id: 'corners-and-red',
      name: 'Corners and red',
      game: 'roulette',
      variant: 'european',
      spots: [
        { bet: 'red', chips: 5 },
        { bet: 'voisins', chips: 9 },
      ],
      'x-note': 1,
    };
    const chips: StageChips[] = ([500, { units: 1 }, { prog: 'm' }] satisfies ChipValue[]).map(
      (chip) => ({ v: 1, spots: layout.spots, chip }),
    );
    const record: LayoutRecord = {
      v: 1,
      id: layout.id,
      layout,
      hash: '00',
      createdAt: '2026-10-28T00:00:00Z',
      updatedAt: '2026-10-28T00:00:00Z',
      origin: 'user',
    };
    const file: LayoutFileV1 = {
      format: LAYOUT_FILE_FORMAT,
      version: 1,
      app: { id: 'spinner', version: '0' },
      layouts: [record.layout],
    };
    expect(chips).toHaveLength(3);
    expect(file.layouts[0]?.spots).toHaveLength(2);
  });
  it('does not bump CORE_VERSION for additive layout types (D12)', () => {
    expect(CORE_VERSION).toBe('0.1.0');
  });
});

describe('sync contract (sync.md §4.1)', () => {
  it('pins the constants', () => {
    expect([SYNC_FORMAT, SYNC_LAYOUT_VERSION]).toEqual(['spinner-sync', 1]);
    expect([RESUMABLE_THRESHOLD, RESUMABLE_CHUNK]).toEqual([5 * 1024 * 1024, 8 * 1024 * 1024]);
    expect(RESUMABLE_CHUNK % (256 * 1024)).toBe(0);
    expect([...SYNC_KINDS]).toEqual(['def', 'strategy', 'layout', 'group', 'setting', 'run']);
    expect([...SYNCED_SETTING_KEYS]).toEqual(['framing', 'pace']);
  });
  it('matches the HLC shape and rejects others', () => {
    expect(HLC_PATTERN.test('0mh3k2z1c.0000.7k2m9qxd4a')).toBe(true);
    expect(HLC_PATTERN.test('0mh3k2z1c.0000.7k2m9qxd4')).toBe(false);
    expect(HLC_PATTERN.test('0MH3K2Z1C.0000.7k2m9qxd4a')).toBe(false);
    expect(HLC_PATTERN.test('0mh3k2z1c.0000.7k2m9qxd4u')).toBe(false); // u is not Crockford
  });
  it('RemoteError carries code, status and retryAfterMs', () => {
    const e = new RemoteError('rate', 429, 'slow down', 2000);
    expect(e).toBeInstanceOf(Error);
    expect([e.name, e.code, e.status, e.retryAfterMs, e.message]).toEqual([
      'RemoteError',
      'rate',
      429,
      2000,
      'slow down',
    ]);
    expect(new RemoteError('network', 0, 'offline').retryAfterMs).toBeUndefined();
  });
  it('type-checks a run stub, an entry, a lib file and the status shapes', () => {
    const stub: RunStub = {
      runId: 'r1',
      definitionId: 'd1',
      simKey: 's',
      runKey: 'k',
      status: 'done',
      sessions: 10,
      completedSessions: 10,
      prefixSessions: 10,
      createdAt: '2026-01-01T00:00:00Z',
      appVersion: '0.1.0',
      gameId: 'roulette',
      gameVersion: '1',
      coreVersion: '1.0.0',
      extra: {
        device: { cores: 4, workers: 3, ua: 'x' },
        timing: { elapsedMs: 1 },
        resumes: [],
      },
    };
    const entry: SyncEntry<'run'> = {
      key: 'run:r1',
      kind: 'run',
      id: 'r1',
      hlc: '0mh3k2z1c.0000.7k2m9qxd4a',
      basis: null,
      vv: { '7k2m9qxd4a': 1 },
      hash: '',
      v: 1,
      value: stub,
    };
    const lib: LibFileV1 = {
      format: 'spinner-sync-lib',
      version: 1,
      device: { id: '7k2m9qxd4a', name: 'Laptop', appVersion: '0.1.0', coreVersion: '1.0.0' },
      hlc: entry.hlc,
      writtenAt: '2026-01-01T00:00:00Z',
      entries: [entry],
    };
    const auth: AuthState[] = [
      { state: 'unconfigured' },
      { state: 'signed-out' },
      { state: 'signed-in', email: 'a@b.c', expiresAt: 1 },
      { state: 'expired', email: 'a@b.c' },
      { state: 'redirecting' },
    ];
    const states: SyncState[] = [
      'off',
      'idle',
      'syncing',
      'needs-auth',
      'offline',
      'backoff',
      'drive-full',
      'error',
      'local-full',
      'waiting-run',
    ];
    expect([lib.entries.length, auth.length, states.length]).toEqual([1, 5, 10]);
  });
  it('matches device ids', () => {
    expect(DEVICE_ID_PATTERN.test('7k2m9qxd4a')).toBe(true);
    expect(DEVICE_ID_PATTERN.test('7k2m9qxd4u')).toBe(false);
    expect(DEVICE_ID_PATTERN.test('7k2m9qxd4')).toBe(false);
  });
  it('types syncMeta rows by key', () => {
    const account: SyncAccountRecord = { accountId: 'a', email: 'a@b.c', boundAt: 'x' };
    const rows: SyncMetaRecord[] = [
      { k: 'account', v: account },
      { k: 'vvCounter', v: 3 },
      { k: 'files', v: { ownLib: { id: 'f' } } },
    ];
    const codes: SyncErrorCode[] = ['newer-layout', 'access-removed', 'account-mismatch', 'erased'];
    expect([rows.length, codes.length]).toEqual([3, 4]);
  });
  it('adds RunMeta.synced additively', () => {
    const synced: NonNullable<RunMeta['synced']> = {
      from: '7k2m9qxd4a',
      fromName: 'Laptop',
      at: '2026-01-01T00:00:00Z',
    };
    expect(Object.keys(synced)).toEqual(['from', 'fromName', 'at']);
  });
  it('does not touch CORE_VERSION', () => {
    expect(CORE_VERSION).toBe('0.1.0');
  });
});
