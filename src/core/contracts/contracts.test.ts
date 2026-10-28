import { describe, expect, it } from 'vitest';
import { RESERVED_STOP_REASONS, STRATEGY_SCHEMA } from './strategy';
import { DEFINITION_SCHEMA, SHARE_LINK_MAX_CHARS } from './experiment';
import { ENDED_BY, ENDED_BY_STRATEGY_BASE, MAX_ROUNDS, MAX_SESSIONS } from './run';
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
