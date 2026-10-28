import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend } from '@core';
import { BUILTIN_LAYOUTS } from '@game/roulette';
import { createBackendRepo, setRepoForTests } from '../../services/db';
import { countUsage, createLayout, importLayoutText, layoutFileText } from '../../services/layouts';
import { libraryRepo, saveStrategy } from '../Define/data';
import { Library } from './index';

beforeEach(async () => {
  setRepoForTests(createBackendRepo(createMemoryBackend()));
  // The fallback data backend is module-level: empty what earlier tests left.
  const repo = await libraryRepo();
  for (const r of await repo.listLayouts()) await repo.deleteLayout(r.id);
  for (const r of await repo.listStrategies()) await repo.deleteStrategy(r.id);
  for (const r of await repo.listDefinitions())
    await repo.backend.tx(['definitions'], 'readwrite', (t) => t.delete('definitions', r.id));
  location.hash = '#/library?tab=layouts';
});
afterEach(() => {
  cleanup();
  setRepoForTests(null);
});

const q = (s: string) => new URLSearchParams(s);
const chipsStage = (from: { id: string; builtin?: true }) => ({
  id: 'play',
  layout: [{ bet: 'red', amount: 500 }],
  'x-chips': {
    v: 1,
    spots: [{ bet: 'red', chips: 1 }],
    chip: 500,
    from: { id: from.id, hash: 'h', name: 'n', ...(from.builtin ? { builtin: true } : {}) },
  },
});
const strategy = (id: string, stage: unknown) => ({
  schema: 1 as const,
  id,
  name: `S ${id}`,
  game: 'roulette',
  unit: 2500,
  stages: [stage],
});
const rows = () => screen.getByRole('list', { name: 'Layouts' }).querySelectorAll('li.lay-card');

describe('Layouts tab', () => {
  it('lists built-ins first with a pill, thumbnails and read-only actions', async () => {
    render(<Library params={{}} query={q('tab=layouts')} />);
    await waitFor(() => expect(rows()).toHaveLength(BUILTIN_LAYOUTS.length));
    const first = rows()[0] as HTMLElement;
    expect(within(first).getByText('Built-in')).toBeTruthy();
    expect(first.querySelector('.layout-thumb')).toBeTruthy();
    expect(within(first).getByRole('button', { name: /Duplicate .* to edit/ })).toBeTruthy();
    expect(within(first).queryByRole('button', { name: /^Delete/ })).toBeNull();
    expect(within(first).queryByRole('button', { name: /^Rename/ })).toBeNull();
    expect(within(first).getByText('Used in 0')).toBeTruthy();
  });

  it('duplicates a built-in, renames and deletes with a used-in warning', async () => {
    const mine = await createLayout({
      name: 'Mine',
      variant: 'european',
      spots: [{ bet: 'red', chips: 3 }],
    });
    await saveStrategy(strategy('uses-mine', chipsStage({ id: mine.id })) as never);
    const repo = await libraryRepo();
    await repo.putDefinition({
      v: 1,
      id: 'd1',
      definition: { strategy: strategy('x', chipsStage({ id: mine.id })) },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      origin: 'user',
      runIds: [],
    } as never);
    render(<Library params={{}} query={q('tab=layouts')} />);
    await waitFor(() => expect(rows()).toHaveLength(BUILTIN_LAYOUTS.length + 1));
    const li = () =>
      screen
        .getByRole('list', { name: 'Layouts' })
        .querySelector('[data-layout="mine"]') as HTMLElement;
    expect(within(li()).getByText('Used in 2')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: /Duplicate .* to edit/ })[0]!);
    await waitFor(() => expect(rows()).toHaveLength(BUILTIN_LAYOUTS.length + 2));
    expect((await repo.listLayouts()).map((r) => r.origin).sort()).toEqual(['builtin', 'user']);

    fireEvent.click(within(li()).getByRole('button', { name: 'Rename Mine' }));
    fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(li().textContent).toContain('Renamed'));

    fireEvent.click(within(li()).getByRole('button', { name: 'Delete Renamed' }));
    await screen.findByText(/It is used in 1 definition and 1 strategy/);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(li()).toBeNull());
    expect(await repo.getLayout('mine')).toBeUndefined();
  });

  it('filters by wheel', async () => {
    await createLayout({ name: 'Wheel', variant: 'american', spots: [{ bet: 'red', chips: 1 }] });
    render(<Library params={{}} query={q('tab=layouts')} />);
    await waitFor(() => expect(rows()).toHaveLength(BUILTIN_LAYOUTS.length + 1));
    fireEvent.click(screen.getByRole('button', { name: 'American' }));
    expect(rows()).toHaveLength(1);
  });
});

describe('editor page', () => {
  it('saves a rename and guards Back while there are unsaved edits', async () => {
    const mine = await createLayout({
      name: 'Mine',
      variant: 'european',
      spots: [{ bet: 'red', chips: 3 }],
    });
    const { rerender } = render(<Library params={{}} query={q(`tab=layouts&edit=${mine.id}`)} />);
    await screen.findByRole('button', { name: 'Back' });
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const name = screen.getByLabelText('Name');
    fireEvent.input(name, { target: { value: 'Mine 2' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    await waitFor(async () =>
      expect((await (await libraryRepo()).getLayout(mine.id))?.layout.name).toBe('Mine 2'),
    );

    // Dirty again, then the route drops `edit` (Android Back): the guard asks, the page stays.
    fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Mine 3' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0] ?? document.body);
    rerender(<Library params={{}} query={q('tab=layouts')} />);
    await screen.findByText('Discard changes?');
    expect(location.hash).toContain(`edit=${mine.id}`);
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByText('Discard changes?')).toBeNull();
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  });

  it('reports an unknown id and a built-in id without opening the editor', async () => {
    const { unmount } = render(<Library params={{}} query={q('tab=layouts&edit=nope')} />);
    await screen.findByText('Layout not found');
    unmount();
    render(<Library params={{}} query={q('tab=layouts&edit=james-bond')} />);
    await screen.findByText('Built-in layouts are read-only');
  });
});

describe('services', () => {
  it('countUsage scans definitions and strategies, separating built-ins from library ids', () => {
    const s = (from: { id: string; builtin?: true }) => ({
      strategy: strategy('a', chipsStage(from)),
    });
    const m = countUsage(
      [
        {
          definition: { strategy: strategy('d', chipsStage({ id: 'james-bond', builtin: true })) },
        } as never,
      ],
      [s({ id: 'james-bond', builtin: true }) as never, s({ id: 'james-bond' }) as never],
    );
    expect(m.get('b:james-bond')).toEqual({ definitions: 1, strategies: 1 });
    expect(m.get('u:james-bond')).toEqual({ definitions: 0, strategies: 1 });
  });

  it('imports: new, exists, renamed, invalid (not saved), foreign game, newer version', async () => {
    const repo = await libraryRepo();
    const good = {
      schema: 1,
      id: 'g',
      name: 'G',
      game: 'roulette',
      variant: 'european',
      spots: [{ bet: 'red', chips: 2 }],
    };
    const text = (layouts: unknown[], extra: Record<string, unknown> = {}) =>
      JSON.stringify({
        format: 'casino-lab-layout',
        version: 1,
        app: { id: 'spinner', version: '0' },
        layouts,
        ...extra,
      });
    let r = await importLayoutText(text([good]), repo);
    expect(r).toEqual({ ok: true, items: [{ status: 'imported', id: 'g', name: 'G' }] });
    r = await importLayoutText(text([good]), repo);
    expect(r).toEqual({ ok: true, items: [{ status: 'exists', id: 'g', name: 'G' }] });
    r = await importLayoutText(text([{ ...good, spots: [{ bet: 'red', chips: 5 }] }]), repo);
    expect(r).toEqual({
      ok: true,
      items: [{ status: 'imported', id: 'g-2', name: 'G', renamedFrom: 'g' }],
    });
    // a built-in re-imported is "already in your library"
    r = await importLayoutText(layoutFileText([BUILTIN_LAYOUTS[0]!]), repo);
    expect(r).toMatchObject({ ok: true, items: [{ status: 'exists' }] });

    const before = (await repo.listLayouts()).length;
    r = await importLayoutText(
      text([
        { ...good, id: 'bad', spots: [{ bet: 'nonsense', chips: 1 }] },
        { ...good, id: 'bad2', spots: [{ bet: 'red', chips: 0 }] },
        { ...good, id: 'bad3', variant: 'moon' },
      ]),
      repo,
    );
    expect(r.ok && r.items.map((i) => i.status)).toEqual(['invalid', 'invalid', 'invalid']);
    expect((await repo.listLayouts()).length).toBe(before);

    expect(await importLayoutText(text([{ ...good, game: 'craps' }]), repo)).toMatchObject({
      ok: false,
      kind: 'foreign-game',
    });
    expect(await importLayoutText(text([good], { version: 2 }), repo)).toMatchObject({
      ok: false,
      kind: 'newer-version',
    });
    expect(await importLayoutText('{', repo)).toMatchObject({ ok: false, kind: 'damaged' });
  });
});
