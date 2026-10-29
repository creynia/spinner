// WP-S5b (B4): Library shows runs that are only in Drive (badge), greys stubs of unfinished runs,
// counts a definition's runs over local runs and stubs, and offers Remove download and Re-upload.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/sync', async (orig) =>
  (await import('../remote-kit')).syncMock(await orig<object>()),
);

import { getCoreRepo } from '../../services/runs';
import { seedRemote, world } from '../remote-kit';
import { Library } from './index';

afterEach(cleanup);
const runsTab = () => render(<Library params={{}} query={new URLSearchParams('tab=runs')} />);

describe('Library → Runs with runs from another device', () => {
  it('badges the remote done run, greys the paused stub, and has no Delete for either', async () => {
    const s = await seedRemote(2);
    runsTab();
    const list = await waitFor(() => screen.getByRole('list', { name: 'Runs' }));
    const rows = [...list.querySelectorAll('li')];
    const done = rows.find((r) => r.textContent?.includes('In Drive'))!;
    expect(done.querySelector('a')!.getAttribute('href')).toBe(`#/analyze/${s.remote.runId}`);
    const stub = rows.find((r) => r.textContent?.includes('Paused on Laptop'))!;
    expect(stub.querySelector('a')).toBeNull();
    expect(stub.querySelector('.row-stub')).not.toBeNull();
    for (const r of [done, stub]) expect(within(r as HTMLElement).queryByText('Delete')).toBeNull();
    // not on this device, so nothing to remove
    expect(screen.queryByRole('button', { name: /Remove download/ })).toBeNull();
  }, 20_000);

  it('counts a definition’s runs over local runs and stubs, ignoring ids that exist nowhere', async () => {
    await seedRemote(3);
    render(<Library params={{}} query={new URLSearchParams('tab=definitions')} />);
    const list = await waitFor(() => screen.getByRole('list', { name: 'Saved definitions' }));
    // runIds lists the done run and the paused run (both stubs) and one that nobody has
    const repo = await getCoreRepo();
    const defs = await repo.listDefinitions();
    expect(defs[0]!.runIds.length).toBe(2);
    expect(list.textContent).toMatch(/2 runs/);
    cleanup();
    const rec = defs[0]!;
    await repo.backend.tx(['definitions'], 'readwrite', (t) =>
      t.put('definitions', { ...rec, runIds: [...rec.runIds, 'nowhere'] }),
    );
    render(<Library params={{}} query={new URLSearchParams('tab=definitions')} />);
    const again = await waitFor(() => screen.getByRole('list', { name: 'Saved definitions' }));
    expect(again.textContent).toMatch(/2 runs/);
    expect(again.textContent).not.toMatch(/3 runs/);
  }, 20_000);

  it('Remove download evicts a downloaded run; a refusal is shown and nothing is lost', async () => {
    const s = await seedRemote(4);
    await world.onDownload(s.remote.runId); // the run is on this device again
    runsTab();
    const btn = await waitFor(() =>
      screen.getByRole('button', { name: new RegExp(`Remove download of ${s.name}`) }),
    );
    world.evictError = 'This run is not in Drive, so it cannot be removed from this device.';
    fireEvent.click(btn);
    await waitFor(() => expect(world.evictCalls).toBe(1));
    expect(world.evicted).toEqual([]);
    await expect((await getCoreRepo()).getRun(s.remote.runId)).resolves.toBeDefined();

    world.evictError = null;
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`Remove download of ${s.name}`) }),
    );
    await waitFor(() => expect(world.evicted).toEqual([s.remote.runId]));
    // the row stays, now as a remote run (badge, no Remove download)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Remove download/ })).toBeNull(),
    );
    expect(screen.getByRole('list', { name: 'Runs' }).textContent).toContain('In Drive');
  }, 20_000);

  it('Re-upload asks the sync service to upload this device’s copy', async () => {
    const s = await seedRemote(5);
    await world.onDownload(s.remote.runId);
    runsTab();
    fireEvent.click(
      await waitFor(() => screen.getByRole('button', { name: new RegExp(`Re-upload ${s.name}`) })),
    );
    await waitFor(() => expect(world.reuploaded).toEqual([s.remote.runId]));
  }, 20_000);
});
