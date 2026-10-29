// WP-S5b (B4): a sweep treats a done run that is only in Drive as done (matched by simKey) and
// never starts a run for that variant. A paused stub is not resumable here, so its variant starts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedDefinition } from '@core/contracts/experiment';

vi.mock('../../services/sync', async (orig) =>
  (await import('../remote-kit')).syncMock(await orig<object>()),
);
const started: string[] = [];
vi.mock('../../services/runs', async (orig) => {
  const real = await orig<typeof import('../../services/runs')>();
  return {
    ...real,
    startRun: vi.fn(async (def: NormalizedDefinition) => {
      started.push(def.name);
      return 'new-run';
    }),
    resumeStored: vi.fn(async () => undefined),
    getController: () => undefined,
  };
});

import { getCoreRepo, runKeys } from '../../services/runs';
import { seedRemote } from '../remote-kit';
import { runSweep, sweepQueue } from './sweep';

beforeEach(() => (started.length = 0));

describe('runSweep with runs from another device', () => {
  it('reuses a remote done run by simKey and starts only the variants nobody has', async () => {
    const s = await seedRemote(10);
    const repo = await getCoreRepo();
    const rec = (await repo.getDefinition(s.data.meta.definitionId))!;
    // a second variant, which only a paused stub (same simKey would be wrong) knows about
    const other = {
      ...rec.definition,
      name: 'Other variant',
      run: { ...rec.definition.run, seed: 4242 },
    };
    const otherKeys = await runKeys(other);
    const keys = await runKeys(rec.definition);
    // the remote stub is the done run for the first variant (keys of this definition)
    expect(keys.simKey).toBe(s.remote.simKey);
    await repo.putDefinition({ ...rec, id: otherKeys.definitionId, definition: other, runIds: [] });
    await repo.putGroup({
      v: 1,
      id: 'g-remote',
      kind: 'sweep',
      name: 'sweep',
      baseDefinitionId: rec.id,
      sweep: { path: '/run/seed', values: [rec.definition.run.seed, 4242] },
      variantDefinitionIds: [rec.id, otherKeys.definitionId],
      runIds: [],
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
    });
    await runSweep('g-remote');
    expect(sweepQueue.get()['g-remote']?.error).toBeUndefined();
    expect(started).toEqual(['Other variant']);
    const g = (await repo.listGroups()).find((x) => x.id === 'g-remote')!;
    expect(g.runIds).toEqual([s.remote.runId, 'new-run']);
  }, 20_000);
});
