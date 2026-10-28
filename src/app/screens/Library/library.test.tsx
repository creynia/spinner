import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend } from '@core';
import { createBackendRepo, setRepoForTests } from '../../services/db';
import { saveStrategy } from '../Define/data';
import { Library } from './index';

beforeEach(() => setRepoForTests(createBackendRepo(createMemoryBackend())));
afterEach(() => {
  cleanup();
  setRepoForTests(null);
});

const strategy = (id: string, tags: string[] = []) => ({
  schema: 1 as const,
  id,
  name: `Strategy ${id}`,
  game: 'roulette',
  unit: 2500,
  tags,
  stages: [{ id: 'play', layout: [{ bet: 'red', amount: { units: 1 } }] }],
});

describe('Library', () => {
  it('lists the built-in presets and an empty state for saved strategies', async () => {
    const { container } = render(<Library params={{}} query={new URLSearchParams()} />);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    await waitFor(() => expect(screen.getByText('No saved strategies yet')).toBeTruthy());
    expect(
      screen.getByRole('list', { name: 'Built-in presets' }).querySelectorAll('li'),
    ).toHaveLength(12);
    expect(screen.getByRole('tablist', { name: 'Library sections' })).toBeTruthy();
  });

  it('shows saved strategies, filters by search and tag, duplicates and deletes with confirm', async () => {
    await (async () => {
      await (await import('../Define/data')).libraryRepo();
    })();
    await saveStrategy(strategy('alpha', ['safe']));
    await saveStrategy(strategy('beta', ['wild']));
    render(<Library params={{}} query={new URLSearchParams()} />);
    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'Saved strategies' })).toBeTruthy(),
    );
    const saved = () =>
      screen.getByRole('list', { name: 'Saved strategies' }).querySelectorAll('li');
    expect(saved()).toHaveLength(2);

    fireEvent.input(screen.getByLabelText('Search'), { target: { value: 'beta' } });
    expect(saved()).toHaveLength(1);
    fireEvent.input(screen.getByLabelText('Search'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'safe' }));
    expect(saved()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'safe' }));

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Strategy alpha' }));
    await waitFor(() => expect(saved()).toHaveLength(3));

    fireEvent.click(screen.getByRole('button', { name: 'Delete Strategy beta' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!);
    await waitFor(() => expect(saved()).toHaveLength(2));
  });

  it('opens a preset in Define', () => {
    render(<Library params={{}} query={new URLSearchParams()} />);
    const link = document.querySelector('a[href="#/define?preset=flat-red"]');
    expect(link).not.toBeNull();
  });
});
