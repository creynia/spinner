import { describe, expect, it } from 'vitest';
import { RESERVED_STOP_REASONS, STRATEGY_SCHEMA } from './strategy';
import { DEFINITION_SCHEMA, SHARE_LINK_MAX_CHARS } from './experiment';
import { ENDED_BY, ENDED_BY_STRATEGY_BASE, MAX_ROUNDS, MAX_SESSIONS } from './run';
import { SIM_PROTOCOL } from './protocol';
import { CORE_VERSION } from './version';

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
