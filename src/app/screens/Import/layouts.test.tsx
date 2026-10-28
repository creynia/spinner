import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryBackend, createRepo } from '@core';
import { BUILTIN_LAYOUTS } from '@game/roulette';
import { createBackendRepo, setRepoForTests } from '../../services/db';
import { layoutFileText, MAX_LAYOUT_FILE_BYTES } from '../../services/layouts';
import { importBytes } from './importFile';
import { ImportView } from './index';

afterEach(() => {
  cleanup();
  setRepoForTests(null);
});
const enc = (s: string) => new TextEncoder().encode(s);
const mine = {
  schema: 1 as const,
  id: 'mine',
  name: 'Mine',
  game: 'roulette',
  variant: 'european',
  spots: [{ bet: 'red', chips: 2 }],
};

describe('Import layout files', () => {
  it('routes a casino-lab-layout file and dedupes by id', async () => {
    setRepoForTests(createBackendRepo(createMemoryBackend()));
    const repo = createRepo(createMemoryBackend());
    const bytes = enc(layoutFileText([mine, BUILTIN_LAYOUTS[0]!]));
    const first = await importBytes(bytes, repo);
    expect(first).toMatchObject({ ok: true, kind: 'layouts' });
    expect(first.ok && first.kind === 'layouts' && first.items.map((i) => i.status)).toEqual([
      'imported',
      'exists',
    ]);
    const again = await importBytes(bytes, repo);
    expect(again.ok && again.kind === 'layouts' && again.items.map((i) => i.status)).toEqual([
      'exists',
      'exists',
    ]);
    expect((await repo.listLayouts()).map((r) => r.origin)).toEqual(['import']);
  });

  it('refuses a layout file over the size cap with a clear message', async () => {
    const repo = createRepo(createMemoryBackend());
    const pad = layoutFileText([{ ...mine, notes: 'x'.repeat(10) }]).replace(
      '"version":1}',
      `"version":1,"pad":"${'x'.repeat(MAX_LAYOUT_FILE_BYTES)}"}`,
    );
    const r = await importBytes(enc(pad), repo);
    expect(r).toMatchObject({ ok: false, problem: { title: 'This layout file is too large' } });
    expect(await repo.listLayouts()).toHaveLength(0);
  });

  it('shows per-item results on the screen', async () => {
    const repo = createRepo(createMemoryBackend());
    render(<ImportView getRepo={() => Promise.resolve(repo)} />);
    const bad = { ...mine, id: 'bad', name: 'Bad', spots: [{ bet: 'nonsense', chips: 1 }] };
    const file = new File([layoutFileText([mine, bad])], 'x.layout.json', {
      type: 'application/json',
    });
    const input = document.querySelector<HTMLInputElement>('[data-file-input]')!;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(document.querySelector('[data-result="layouts"]')).toBeTruthy());
    const items = [...document.querySelectorAll('[data-item]')].map((e) =>
      e.getAttribute('data-item'),
    );
    expect(items).toEqual(['imported', 'invalid']);
    expect(screen.getByRole('link', { name: 'Open layouts' })).toBeTruthy();
    expect((await repo.listLayouts()).map((r) => r.id)).toEqual(['mine']);
  });
});
