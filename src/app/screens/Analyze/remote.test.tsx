// WP-S5b (B4): Analyze on a run that is only in Drive shows the RemoteRunCard, downloads it and
// then shows the analysis; on a paused stub it says the run is not here.
import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/sync', async (orig) =>
  (await import('../__fixtures__/remote-kit')).syncMock(await orig<object>()),
);

import { seedRemote, world } from '../__fixtures__/remote-kit';
import { clearRunCache } from './data';
import { Analyze } from './index';

afterEach(cleanup);

describe('Analyze with a run from another device', () => {
  it('shows the card with the name, downloads, then the analysis', async () => {
    clearRunCache();
    const s = await seedRemote(11);
    const { container } = render(
      <Analyze params={{ runId: s.remote.runId }} query={new URLSearchParams()} />,
    );
    const card = await waitFor(() => {
      const el = container.querySelector('[data-remote-run]');
      if (!el) throw new Error('no card');
      return el;
    });
    expect(container.querySelector('.remote-run-card')?.textContent).toContain(s.name);
    expect(card).toBeTruthy();
    await waitFor(() => expect(world.downloads).toEqual([s.remote.runId]));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(`Analyze: ${s.name}`),
    );
    expect(container.querySelector('[data-remote-run]')).toBeNull();
  }, 20_000);

  it('a paused stub has no results to show: not found, and nothing is downloaded', async () => {
    clearRunCache();
    const s = await seedRemote(12);
    const { container } = render(
      <Analyze params={{ runId: s.paused.runId }} query={new URLSearchParams()} />,
    );
    await waitFor(() => expect(container.textContent).toContain('Run not found'));
    expect(container.querySelector('[data-remote-run]')).toBeNull();
    expect(world.downloads).toEqual([]);
  }, 20_000);
});
