// Determinism through the real pool, controller and plugin: the same roulette definition gives an
// identical `resultsDigest` with 1 or 3 workers and with other batch sizes (PLAYBOOK §7.1). The
// 10,000 x 500 version lives in tests/perf (PERF=1).
import { describe, expect, it } from 'vitest';
import { REFERENCE_3_STAGE, rouletteDef, runViaPool } from './roulette-helpers';

describe('roulette determinism across workers and batch sizes', () => {
  it('1 worker, 3 workers and forced batch sizes share one resultsDigest', async () => {
    const def = rouletteDef('perf-reference', {
      strategy: REFERENCE_3_STAGE,
      sessions: 600,
      maxRounds: 200,
      samples: 6,
    });
    const a = await runViaPool(def, 1);
    const b = await runViaPool(def, 3);
    const c = await runViaPool(def, 2, { batchChunks: 1 });
    expect(a.data.sessions).toBe(600);
    expect(a.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(b.digest).toBe(a.digest);
    expect(c.digest).toBe(a.digest);
  });
});
