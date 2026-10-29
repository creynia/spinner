// WP-S5b (B4): the Compare picker lists runs from other devices; picking a remote done run
// downloads it first ("Downloading 1 run…"), then compares.
import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeRun } from '../../../core/store/__fixtures__/synth';

vi.mock('../../services/sync', async (orig) =>
  (await import('../__fixtures__/remote-kit')).syncMock(await orig<object>()),
);

import { getCoreRepo } from '../../services/runs';
import { clearRunCache } from '../Analyze/data';
import { seedRemote, world } from '../__fixtures__/remote-kit';
import { Compare } from './index';

afterEach(cleanup);

describe('Compare with runs from another device', () => {
  it('the picker offers the remote done run, marked, and not the paused stub', async () => {
    const s = await seedRemote(6);
    const local = await makeRun({
      sessions: 12,
      maxRounds: 20,
      chunkSize: 4,
      samples: 2,
      seed: 99,
      name: 'Local one',
    });
    await (await getCoreRepo()).importRun(local);
    render(<Compare params={{}} query={new URLSearchParams(`runs=${local.meta.runId}`)} />);
    const sel = await waitFor(() => screen.getByLabelText<HTMLSelectElement>('Finished runs'));
    const labels = [...sel.options].map((o) => o.textContent ?? '');
    expect(labels.some((l) => l.includes(s.name) && l.includes('☁'))).toBe(true);
    expect(labels.some((l) => l.includes('Paused'))).toBe(false);
    expect([...sel.options].some((o) => o.value === s.paused.runId)).toBe(false);
    expect([...sel.options].some((o) => o.value === s.remote.runId)).toBe(true);
  }, 20_000);

  it('downloads a remote run first, then compares', async () => {
    clearRunCache();
    const s = await seedRemote(7);
    const local = await makeRun({
      sessions: 12,
      maxRounds: 20,
      chunkSize: 4,
      samples: 2,
      seed: 98,
      name: 'Local two',
    });
    await (await getCoreRepo()).importRun(local);
    const order: string[] = [];
    const orig = world.onDownload;
    world.onDownload = async (id) => {
      order.push('download');
      await orig(id);
    };
    const { container } = render(
      <Compare
        params={{}}
        query={new URLSearchParams(`runs=${local.meta.runId},${s.remote.runId}`)}
      />,
    );
    await waitFor(() => expect(world.downloads).toEqual([s.remote.runId]));
    await waitFor(() => expect(container.querySelector('.compare')).not.toBeNull());
    expect(order).toEqual(['download']);
    expect(container.textContent).not.toContain('is not in this browser');
    // after the download the run is on this device
    await expect((await getCoreRepo()).getRun(s.remote.runId)).resolves.toBeDefined();
  }, 30_000);
});
