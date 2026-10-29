// WP-S5b (B4): Watch on a run that is only in Drive shows the RemoteRunCard, then the session.
import { cleanup, render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/sync', async (orig) =>
  (await import('../remote-kit')).syncMock(await orig<object>()),
);

import { getCoreRepo, remoteRunName } from '../../services/runs';
import { seedRemote, world } from '../remote-kit';
import { defaultDeps, type WatchDeps } from './deps';
import { WatchView } from './WatchView';

afterEach(cleanup);
const deps = (): WatchDeps => ({
  ...defaultDeps,
  loadRun: async (id) => (await getCoreRepo()).loadRun(id),
  remoteName: remoteRunName,
});

describe('Watch with a run from another device', () => {
  it('shows the card with the name, downloads, then loads the run', async () => {
    const s = await seedRemote(13);
    const idx = s.data.samples[0]!.index;
    const { container } = render(
      <WatchView
        params={{ runId: s.remote.runId, index: String(idx) }}
        query={new URLSearchParams()}
        deps={deps()}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('.remote-run-card')?.textContent).toContain(s.name),
    );
    await waitFor(() => expect(world.downloads).toEqual([s.remote.runId]));
    await waitFor(() => expect(container.querySelector('.remote-run-card')).toBeNull());
    await waitFor(() => expect(container.textContent).toContain(s.name));
    expect(container.textContent).not.toContain('Run not found');
  }, 20_000);

  it('a paused stub is not found and nothing is downloaded', async () => {
    const s = await seedRemote(14);
    const { container } = render(
      <WatchView
        params={{ runId: s.paused.runId, index: '0' }}
        query={new URLSearchParams()}
        deps={deps()}
      />,
    );
    await waitFor(() => expect(container.textContent).toContain('Run not found'));
    expect(world.downloads).toEqual([]);
  }, 20_000);
});
