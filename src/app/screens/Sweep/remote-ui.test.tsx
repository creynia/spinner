// WP-S5b: the sweep screen names a variant whose download from Drive failed, with Retry, and keeps
// the chart when at least two variants remain.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeRun } from '../../../core/store/__fixtures__/synth';

vi.mock('../../services/sync', async (orig) =>
  (await import('../__fixtures__/remote-kit')).syncMock(await orig<object>()),
);

import { getCoreRepo } from '../../services/runs';
import { clearRunCache } from '../Analyze/data';
import { seedRemote, world } from '../__fixtures__/remote-kit';
import { Sweep } from './index';

afterEach(cleanup);

async function localRun(seed: number, name: string) {
  const d = await makeRun({ sessions: 12, maxRounds: 20, chunkSize: 4, samples: 2, seed, name });
  await (await getCoreRepo()).importRun(d);
  return d;
}

async function group(id: string, runs: { meta: { runId: string; definitionId: string } }[]) {
  const repo = await getCoreRepo();
  await repo.putGroup({
    v: 1,
    id,
    kind: 'sweep',
    name: 'sweep',
    baseDefinitionId: runs[0]!.meta.definitionId,
    sweep: { path: '/run/seed', values: runs.map((_, i) => i + 1) },
    variantDefinitionIds: runs.map((r) => r.meta.definitionId),
    runIds: runs.map((r) => r.meta.runId),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

describe('Sweep: a variant that cannot be downloaded', () => {
  it('lists it with its reason and Retry, keeps the chart of the other two, and Retry brings it back', async () => {
    clearRunCache();
    const s = await seedRemote(30);
    const l1 = await localRun(71, 'Sweep one');
    const l2 = await localRun(72, 'Sweep two');
    await group('g-fail-1', [l1, l2, s.data]);
    world.downloadResult = () => 'offline';
    const { container } = render(
      <Sweep params={{ groupId: 'g-fail-1' }} query={new URLSearchParams()} />,
    );
    const alert = await waitFor(() => {
      const el = container.querySelector('[data-download-failed]');
      if (!el) throw new Error('no failure');
      return el;
    });
    expect(alert.textContent).toContain(`Couldn't download ${s.name} from Drive: you're offline.`);
    expect(alert.textContent).not.toContain(s.remote.runId);
    expect(container.querySelector('[data-variants]')).not.toBeNull(); // two variants chart

    world.downloadResult = null;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(container.querySelector('[data-download-failed]')).toBeNull());
    expect(container.querySelector('[data-variants]')).not.toBeNull();
    expect(world.downloads).toContain(s.remote.runId);
  }, 20_000);

  it('with fewer than two variants left it shows the message and no chart', async () => {
    clearRunCache();
    const s = await seedRemote(31);
    const l1 = await localRun(73, 'Sweep three');
    await group('g-fail-2', [l1, s.data]);
    world.downloadResult = () => 'corrupt';
    const { container } = render(
      <Sweep params={{ groupId: 'g-fail-2' }} query={new URLSearchParams()} />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-download-failed="corrupt"]')).not.toBeNull(),
    );
    expect(container.textContent).toContain(
      `Couldn't download ${s.name} from Drive: its file in Drive is damaged.`,
    );
    expect(container.querySelector('[data-variants]')).toBeNull();
  }, 20_000);
});
