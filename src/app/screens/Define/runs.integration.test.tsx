// Define's starts go through the keyed services/runs.startRun: real runs (in-thread workers) show up
// under their definition's name, dry runs stay out of Home and the Library.
import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInThreadTransport, createPool } from '@core';
import { roulette } from '@game/roulette';

vi.mock('../../services/pool', () => {
  let pool: ReturnType<typeof createPool> | null = null;
  return {
    poolSize: () => 1,
    getPool: () => {
      pool ??= createPool({
        size: 1,
        spawn: () => createInThreadTransport(roulette, { hop: 'microtask' }),
      });
      return pool;
    },
  };
});

import { getCoreRepo, listRecentRuns, startRun } from '../../services/runs';
import { Home } from '../Home';
import { Library } from '../Library';
import { analyze, defaultDoc } from './doc';
import { startDryRun } from './data';

afterEach(cleanup);

async function finish(runId: string): Promise<void> {
  const repo = await getCoreRepo();
  for (let i = 0; i < 200; i++) {
    if ((await repo.getRun(runId))?.status === 'done') return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} did not finish`);
}

describe('runs started from Define', () => {
  it('a real run lists under its definition name; the dry run is hidden everywhere', async () => {
    const doc = { ...defaultDoc(), name: 'Integration exp', sessions: 5, maxRounds: 20 };
    const def = analyze(doc).normalized!;
    expect(def).not.toBeNull();

    const real = await startRun(def);
    await finish(real);
    const dry = await startDryRun(def);
    await finish(dry);

    const items = await listRecentRuns(10);
    expect(items.map((i) => i.runId)).toContain(real);
    expect(items.map((i) => i.runId)).not.toContain(dry);
    expect(items.find((i) => i.runId === real)!.name).toBe('Integration exp');
    expect(items.some((i) => i.name === 'Untitled experiment')).toBe(false);

    const home = render(<Home />);
    await waitFor(() => expect(home.container.textContent).toContain('Integration exp'));
    const recent = screen.getByRole('heading', { name: 'Recent runs' }).closest('section')!;
    expect(recent.textContent).toContain('Integration exp');
    expect(recent.textContent).not.toContain('Dry run');
    expect(recent.textContent).not.toContain('Untitled experiment');
    home.unmount();

    const lib = render(<Library params={{}} query={new URLSearchParams('tab=definitions')} />);
    const list = await waitFor(() => screen.getByRole('list', { name: 'Saved definitions' }));
    expect(list.textContent).toContain('Integration exp');
    expect(list.textContent).toMatch(/1 run\b/);
    expect(list.textContent).not.toContain('Dry run');
    lib.unmount();
  }, 30_000);
});
