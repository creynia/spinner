// WP-S0 stubs: every one is implemented now (S2a, S2b, S2c); only the constants test remains.
import { describe, expect, it } from 'vitest';
import * as sync from './index';

describe('core/sync stubs (WP-S0)', () => {
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
