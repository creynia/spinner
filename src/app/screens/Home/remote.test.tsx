// WP-S5b (B4): Home lists a run that is only in Drive with its verdict and a badge, and a paused
// run of another device greyed and without a link.
import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/sync', async (orig) =>
  (await import('../__fixtures__/remote-kit')).syncMock(await orig<object>()),
);

import { listRecentRuns, refreshRuns } from '../../services/runs';
import { seedRemote } from '../__fixtures__/remote-kit';
import { Home } from './index';

afterEach(cleanup);

describe('Home with runs from another device', () => {
  it('shows the remote done run (badge, verdict, link) and the paused stub (greyed, no link)', async () => {
    const s = await seedRemote(1);
    const items = await listRecentRuns(10);
    const done = items.find((i) => i.runId === s.remote.runId)!;
    expect(done.remote?.bytes).toBe(1_800_000);
    expect(done.verdict?.meanNet).toBe(-4100);
    expect(done.name).toBe(s.name);
    expect(items.find((i) => i.runId === s.paused.runId)?.remote).toBeDefined();

    await refreshRuns();
    render(<Home />);
    const list = await waitFor(() => screen.getByRole('list', { name: 'Recent runs' }));
    const rows = [...list.querySelectorAll('li')];
    const doneRow = rows.find((r) => r.textContent?.includes('In Drive') && r.querySelector('a'))!;
    expect(doneRow.textContent).toContain(s.name);
    expect(doneRow.textContent).toMatch(/mean/);
    expect(doneRow.querySelector('a')!.getAttribute('href')).toBe(`#/analyze/${s.remote.runId}`);
    const stubRow = rows.find((r) => r.textContent?.includes('Paused on Laptop'))!;
    expect(stubRow.textContent).toContain('Paused on Laptop · 41%');
    expect(stubRow.querySelector('a')).toBeNull();
    expect(stubRow.querySelector('.row-stub')).not.toBeNull();
    // a stub cannot be resumed from here
    expect(document.querySelector('.resume-card')).toBeNull();
  }, 20_000);
});
