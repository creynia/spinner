import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeShareLink } from '@core';
import { createMemoryRepo } from '../../services/db';
import { setRepoForTests } from '../../services/db';
import { setQuickCheckRunner } from '../../services/quickCheck';
import { Define } from './index';
import { BUILTIN_LAYOUTS } from '@game/roulette';
import {
  analyze,
  defaultDoc,
  docToDefinition,
  definitionToDoc,
  setOverride,
  strategyWithLayout,
} from './doc';

beforeEach(() => setRepoForTests(createMemoryRepo()));
afterEach(() => {
  cleanup();
  setRepoForTests(null);
});

const mount = (q = '', params: Record<string, string> = {}) =>
  render(<Define params={params} query={new URLSearchParams(q)} />);

describe('Define structure', () => {
  it('has one h1, the four cards and the action bar', () => {
    const { container } = mount();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    for (const name of ['Game & rules', 'Strategy', 'Session', 'Run']) {
      expect(screen.getByRole('heading', { level: 2, name: new RegExp(name) })).toBeTruthy();
    }
    const bar = screen.getByRole('region', { name: 'Actions' });
    for (const b of ['Quick check', 'Dry run', 'Run']) {
      expect(
        bar.querySelector(`button`) &&
          [...bar.querySelectorAll('button')].some((x) => x.textContent === b),
      ).toBe(true);
    }
    expect(screen.getByRole('button', { name: /Validation/ })).toBeTruthy();
  });

  it('starts valid: Run is enabled for the default flat-red experiment', () => {
    mount();
    const run = [
      ...screen.getByRole('region', { name: 'Actions' }).querySelectorAll('button'),
    ].find((b) => b.textContent === 'Run')!;
    expect(run.hasAttribute('disabled')).toBe(false);
  });

  it('?preset= loads that strategy into the builder', async () => {
    const { container } = mount('preset=martingale-red');
    await waitFor(() =>
      expect(container.querySelector<HTMLInputElement>('#exp-name')!.value).toMatch(/Martingale/),
    );
    expect(container.querySelectorAll('li.bstage')).toHaveLength(1);
    expect(container.textContent).toContain('martingale');
  });

  it('?layout= starts the strategy from that layout, one stage, valid and runnable', async () => {
    const { container } = mount('layout=james-bond');
    await waitFor(() =>
      expect(container.querySelector<HTMLInputElement>('#exp-name')!.value).toBe('James Bond'),
    );
    expect(container.querySelectorAll('li.bstage')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Chips on the table' })).toBeTruthy();
    expect(container.textContent).toContain('Started from the layout');
    const run = [...container.querySelectorAll('.define-bar button')].find(
      (b) => b.textContent === 'Run',
    )!;
    expect(run.hasAttribute('disabled')).toBe(false);
  });

  it('?layout= with an unknown id says so', async () => {
    mount('layout=nope');
    await waitFor(() => expect(screen.getByText(/layout was not found/)).toBeTruthy());
  });

  it('invalid JSON-level edits show errors in the panel badge and disable Run', async () => {
    const { container } = mount();
    fireEvent.click(screen.getByRole('radio', { name: 'JSON' }));
    const area = screen.getByLabelText<HTMLTextAreaElement>('Strategy JSON');
    const bad = JSON.parse(area.value) as { stages: { layout: { bet: string }[] }[] };
    bad.stages[0]!.layout[0]!.bet = 'not-a-bet';
    fireEvent.input(area, { target: { value: JSON.stringify(bad) } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Validation: \d+ error/ })).toBeTruthy(),
    );
    const run = [...container.querySelectorAll('.define-bar button')].find(
      (b) => b.textContent === 'Run',
    )!;
    expect(run.hasAttribute('disabled')).toBe(true);
    // round trip back to the builder once fixed
    bad.stages[0]!.layout[0]!.bet = 'black';
    fireEvent.input(area, { target: { value: JSON.stringify(bad) } });
    fireEvent.click(screen.getByRole('radio', { name: 'Builder' }));
    await waitFor(() =>
      expect(container.querySelector('li.blayout')!.textContent).toMatch(/Black/i),
    );
  });

  it('converts hours and spins at the pace', async () => {
    const { container } = mount();
    const toggle = screen.queryByRole('button', { name: /Session/ });
    if (toggle) fireEvent.click(toggle);
    const hours = container.querySelector<HTMLInputElement>('#hours')!;
    fireEvent.input(hours, { target: { value: '5' } });
    await waitFor(() =>
      expect(container.querySelector<HTMLInputElement>('#rounds')!.value).toBe('200'),
    );
  });

  it('la partage and en prison are exclusive and need the European wheel', () => {
    const doc = defaultDoc();
    const a = analyze({ ...doc, overrides: setOverride({}, ['laPartage'], true) });
    expect(a.rulesError).toBeNull();
    const b = analyze({ ...doc, preset: 'american', overrides: { laPartage: true } });
    expect(b.rulesError).not.toBeNull();
    const c = analyze({ ...doc, overrides: { laPartage: true, enPrison: true } });
    expect(c.rulesError).not.toBeNull();
  });

  it('Quick check shows a one-line verdict from the runner', async () => {
    setQuickCheckRunner(() =>
      Promise.resolve({ meanNet: -4100, halfWidth: 600, pAhead: 0.38, pBust: 0.02, n: 200 }),
    );
    mount();
    fireEvent.click(
      [...screen.getByRole('region', { name: 'Actions' }).querySelectorAll('button')].find(
        (b) => b.textContent === 'Quick check',
      )!,
    );
    await waitFor(() =>
      expect(screen.getByRole('status', { name: '' }).textContent ?? '').toBeDefined(),
    );
    await waitFor(() =>
      expect(document.querySelector('.define-verdict')!.textContent).toMatch(/P\(ahead\) 38%/),
    );
  });

  it('no stops raises the no-exit warning without blocking', () => {
    const a = analyze(defaultDoc());
    expect(a.strategy.some((d) => d.code === 'W_NO_EXIT')).toBe(true);
    expect(a.errorCount).toBe(0);
    expect(a.normalized).not.toBeNull();
  });
});

describe('share links', () => {
  it('round-trips a definition through the link', async () => {
    const doc = { ...defaultDoc(), name: 'Shared one', seed: 777, sessions: 123 };
    const norm = analyze(doc).normalized!;
    const r = await encodeShareLink(norm);
    expect('hash' in r).toBe(true);
    const q = new URLSearchParams((r as { hash: string }).hash.split('?')[1]);
    const { container } = mount(q.toString());
    await waitFor(() =>
      expect(container.querySelector<HTMLInputElement>('#exp-name')!.value).toBe('Shared one'),
    );
    expect(container.querySelector('.define-notice')!.textContent).toMatch(/Loaded from a link/);
    const back = docToDefinition(definitionToDoc(norm, { kind: 'link' }));
    expect(back.run.seed).toBe(777);
  });

  it('shows a clear error for a damaged link', async () => {
    mount('d=zzzz');
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/link|damaged|newer/i),
    );
  });
});

describe('review fixes', () => {
  it('Custom pace stays selected when the typed value equals a preset', async () => {
    const { container } = mount();
    const toggle = screen.queryByRole('button', { name: /Game & rules/ });
    if (toggle) fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    const field = await waitFor(() => container.querySelector<HTMLInputElement>('#pace-custom')!);
    expect(field).toBeTruthy();
    fireEvent.input(field, { target: { value: '100' } });
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Custom' }).getAttribute('aria-checked')).toBe(
        'true',
      ),
    );
    expect(container.querySelector('#pace-custom')).not.toBeNull();
  });

  it('table limits list every per-bet maximum', () => {
    const { container } = mount();
    const toggle = screen.queryByRole('button', { name: /Game & rules/ });
    if (toggle) fireEvent.click(toggle);
    for (const id of [
      'lim-omin',
      'lim-omax',
      'lim-imin',
      'lim-itot',
      'lim-straight',
      'lim-split',
      'lim-street',
      'lim-corner',
      'lim-sixline',
      'lim-basket',
    ]) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    }
  });

  it('the no-exit warning is worded for people and jumps to Stop when ahead', async () => {
    const { container } = mount();
    const badge = screen.getByRole('button', { name: /Validation/ });
    fireEvent.click(badge);
    // wide screens show the panel inline, phones a sheet
    const dlg = await waitFor(
      () => container.querySelector<HTMLElement>('.define-panel') ?? screen.getByRole('dialog'),
    );
    expect(dlg.textContent).toContain('This strategy never stops early');
    expect(dlg.textContent).toContain('all 500 spins');
    fireEvent.click(dlg.querySelector('.define-diag button')!);
    await waitFor(() => expect(container.querySelector('#define-stop-win-wrap')).not.toBeNull());
  });

  it('the first edit of a preset gives the strategy a new id, once', async () => {
    const { container } = mount('preset=flat-red');
    await waitFor(() =>
      expect(container.querySelector<HTMLInputElement>('#exp-name')!.value).toMatch(/Flat/),
    );
    fireEvent.click(screen.getByRole('radio', { name: 'JSON' }));
    const area = screen.getByLabelText<HTMLTextAreaElement>('Strategy JSON');
    const doc = JSON.parse(area.value) as { id: string; name: string };
    fireEvent.input(area, { target: { value: JSON.stringify({ ...doc, name: 'Mine' }) } });
    await waitFor(() =>
      expect(
        (
          JSON.parse(screen.getByLabelText<HTMLTextAreaElement>('Strategy JSON').value) as {
            id: string;
          }
        ).id,
      ).toBe('flat-red-edit'),
    );
    fireEvent.input(screen.getByLabelText<HTMLTextAreaElement>('Strategy JSON'), {
      target: { value: JSON.stringify({ ...doc, id: 'flat-red-edit', name: 'Mine 2' }) },
    });
    expect(
      (
        JSON.parse(screen.getByLabelText<HTMLTextAreaElement>('Strategy JSON').value) as {
          id: string;
        }
      ).id,
    ).toBe('flat-red-edit');
  });

  it('out-of-range numbers show an inline error instead of being ignored', async () => {
    const { container } = mount();
    const toggle = screen.queryByRole('button', { name: /Run$/ });
    if (toggle && toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
    fireEvent.input(container.querySelector('#sessions')!, { target: { value: '0' } });
    await waitFor(() => expect(container.querySelector('#sessions-err')).not.toBeNull());
  });

  it('a garbage link says it is not a valid link', async () => {
    mount('d=!!!!');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Not a valid link/));
  });
});

describe('strategyWithLayout', () => {
  const layout = BUILTIN_LAYOUTS.find((l) => l.id === 'two-dozens')!;
  const from = { id: layout.id, hash: 'h', name: layout.name, builtin: true as const };
  const fresh = defaultDoc().strategy;

  it('replaces the untouched start with a single stage of the layout', () => {
    const r = strategyWithLayout(defaultDoc().strategy, fresh, layout, from, 500);
    expect(r.appended).toBe(false);
    const stages = (r.strategy as { stages: Record<string, unknown>[] }).stages;
    expect(stages).toHaveLength(1);
    expect(stages[0]!['x-chips']).toMatchObject({ chip: 500, from });
    expect((stages[0]!.layout as unknown[]).length).toBe(layout.spots.length);
  });

  it('appends a new stage when the strategy was already edited', () => {
    const base = { ...(fresh as object), name: 'Mine' };
    const r = strategyWithLayout(base, fresh, layout, from, 500);
    expect(r.appended).toBe(true);
    const stages = (r.strategy as { stages: { id: string }[] }).stages;
    expect(stages.map((x) => x.id)).toEqual(['flat', 'layout-2']);
  });
});
