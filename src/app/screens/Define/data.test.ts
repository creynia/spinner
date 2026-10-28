import type * as Runs from '../../services/runs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryBackend } from '@core';
import type { NormalizedDefinition } from '@core/contracts/experiment';
import type { RunMeta } from '@core/contracts/run';
import { createBackendRepo, setRepoForTests } from '../../services/db';

let counter = 0;
const putRun = vi.fn<(id: string) => Promise<void>>();
vi.mock('../../services/runs', async () => {
  const { createStore } = await import('../../state/store');
  const actual = await vi.importActual<typeof Runs>('../../services/runs');
  return {
    ...actual,
    activeRun: createStore(null),
    // Like main's un-keyed startRun: every run gets the empty definition id.
    startRun: async () => {
      const id = `run-${++counter}`;
      await putRun(id);
      return id;
    },
  };
});

import { libraryRepo, markDryRun, purgeDryRuns, isDryRunId, startDryRun } from './data';
import { analyze, defaultDoc } from './doc';

const meta = (runId: string): RunMeta =>
  ({
    v: 1,
    runId,
    definitionId: '',
    status: 'done',
    createdAt: new Date().toISOString(),
  }) as RunMeta;

describe('dry runs', () => {
  beforeEach(() => {
    counter = 0;
    localStorage.clear();
    setRepoForTests(createBackendRepo(createMemoryBackend()));
  });

  it('dry run -> real run -> dry run keeps the real run (never matches by definition id)', async () => {
    const repo = await libraryRepo();
    putRun.mockImplementation((id) => repo.putRun(meta(id)));
    const def = analyze(defaultDoc()).normalized as NormalizedDefinition;
    const dry1 = await startDryRun(def);
    expect(isDryRunId(dry1)).toBe(true);
    // a real run, started without keys, shares definitionId ''
    await repo.putRun(meta('real-1'));
    const dry2 = await startDryRun(def);
    const ids = (await repo.listRuns()).map((r) => r.runId).sort();
    expect(ids).toContain('real-1');
    expect(ids).toContain(dry2);
    expect(ids).not.toContain(dry1);
  });

  it('purge ignores empty ids and unknown runs', async () => {
    const repo = await libraryRepo();
    await repo.putRun(meta('keep'));
    markDryRun('');
    markDryRun('gone');
    await purgeDryRuns();
    expect((await repo.listRuns()).map((r) => r.runId)).toContain('keep');
  });
});
