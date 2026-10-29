import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend } from '@core';
import { makeRun } from '../../../core/store/__fixtures__/synth';
import { createBackendRepo, setRepoForTests } from '../../services/db';
import { libraryRepo } from '../Define/data';
import { Library } from './index';

const run = await makeRun({ sessions: 12, maxRounds: 30, chunkSize: 8, samples: 3 });
const NAME = run.definition.name;

beforeEach(() => setRepoForTests(createBackendRepo(createMemoryBackend())));
afterEach(() => {
  cleanup();
  setRepoForTests(null);
});

async function open() {
  const repo = await libraryRepo();
  await repo.importRun(run);
  await repo.renameDefinition(run.meta.definitionId, NAME); // the core repo outlives each test
  render(<Library params={{}} query={new URLSearchParams('tab=definitions')} />);
  await waitFor(() => screen.getByRole('button', { name: `Rename ${NAME}` }));
  return repo;
}

describe('Library: rename a definition', () => {
  it('opens a labelled sheet, saves with Enter and keeps the id and the run', async () => {
    const repo = await open();
    fireEvent.click(screen.getByRole('button', { name: `Rename ${NAME}` }));
    const dlg = screen.getByRole('dialog');
    const input = within(dlg).getByLabelText<HTMLInputElement>('Name');
    expect(input.value).toBe(NAME);
    expect(document.activeElement).toBe(input);
    fireEvent.input(input, { target: { value: '  Calmer martingale ' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => screen.getByRole('button', { name: 'Rename Calmer martingale' }));
    const rec = await repo.getDefinition(run.meta.definitionId);
    expect(rec?.definition.name).toBe('Calmer martingale');
    expect(rec?.runIds).toEqual([run.meta.runId]);
    expect((await repo.getRun(run.meta.runId))?.definitionId).toBe(run.meta.definitionId);
  });

  it('rejects an empty name inline and Esc cancels without changing anything', async () => {
    const repo = await open();
    const trigger = screen.getByRole('button', { name: `Rename ${NAME}` });
    trigger.focus();
    fireEvent.click(trigger);
    const input = within(screen.getByRole('dialog')).getByLabelText('Name');
    fireEvent.input(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Enter a name/));
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect((await repo.getDefinition(run.meta.definitionId))?.definition.name).toBe(NAME);
  });
});
