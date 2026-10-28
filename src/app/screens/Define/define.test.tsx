import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeShareLink } from '@core';
import { createMemoryRepo } from '../../services/db';
import { setRepoForTests } from '../../services/db';
import { setQuickCheckRunner } from '../../services/quickCheck';
import { Define } from './index';
import { analyze, defaultDoc, docToDefinition, definitionToDoc, setOverride } from './doc';

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
