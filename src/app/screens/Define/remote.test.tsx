// WP-S5b (B4): Define's "Compare with…" sheet lists runs from other devices; a remote done run
// can be picked (its definition is here, no download needed); a paused stub is greyed.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/sync', async (orig) =>
  (await import('../__fixtures__/remote-kit')).syncMock(await orig<object>()),
);

import { createMemoryRepo, setRepoForTests } from '../../services/db';
import { seedRemote } from '../__fixtures__/remote-kit';
import { loadDefinitionOfRun } from './data';
import { Define } from './index';

beforeEach(() => setRepoForTests(createMemoryRepo()));
afterEach(() => {
  cleanup();
  setRepoForTests(null);
});

describe('Define → Compare with… and runs from another device', () => {
  it('lists the remote done run (badge) and the paused stub (disabled, "Paused on Laptop")', async () => {
    const s = await seedRemote(8);
    render(<Define params={{}} query={new URLSearchParams()} />);
    fireEvent.click(screen.getByRole('button', { name: /Compare with/ }));
    const list = await waitFor(() => screen.getByRole('list', { name: 'Runs to compare with' }));
    const buttons = [...list.querySelectorAll('button')];
    const done = buttons.find((b) => b.textContent?.includes('In Drive'))!;
    expect(done.textContent).toContain(s.name);
    expect(done.disabled).toBe(false);
    const stub = buttons.find((b) => b.textContent?.includes('Paused on Laptop'))!;
    expect(stub.disabled).toBe(true);
    expect(stub.classList.contains('row-stub')).toBe(true);
    fireEvent.click(done);
    await waitFor(() =>
      expect(location.hash).toBe(`#/define?compare=${encodeURIComponent(s.remote.runId)}`),
    );
  }, 20_000);

  it('the definition of a remote-only run resolves from its stub', async () => {
    const s = await seedRemote(9);
    const def = await loadDefinitionOfRun(s.remote.runId);
    expect(def?.name).toBe(s.name);
    expect(await loadDefinitionOfRun('nobody')).toBeNull();
  }, 20_000);
});
