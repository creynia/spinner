import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Diagnostic, StrategyDefinition } from '@core/contracts/strategy';
import { validateStrategy } from '@core/strategy';
import { ROULETTE_PRESETS, roulette } from '@game/roulette';
import { rouletteUi } from '@game/roulette/ui';
import goldens from './__fixtures__/roulette-goldens.json';
import { Builder } from '@core/ui/builder/Builder';
import type { BuilderEnv } from '@core/ui/builder/env';
import { StrategyEditor } from '@core/ui/builder/StrategyEditor';

afterEach(cleanup);

const rules = ROULETTE_PRESETS.european;
const env: BuilderEnv = {
  facts: roulette.facts,
  catalog: roulette.bets.catalog(rules),
  rules,
  ui: rouletteUi as unknown as BuilderEnv['ui'],
  roundWord: 'spin',
  unit: 2500,
  extraTargets: ['zero', 'green'],
};
const golden = (id: string) =>
  structuredClone((goldens as unknown as StrategyDefinition[]).find((d) => d.id === id)!);

describe('Builder structure', () => {
  it('renders stages as cards with a layout list and rules read as sentences', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Builder
        value={golden('red-mart-then-flat')}
        onChange={onChange}
        env={env}
        diagnostics={[]}
      />,
    );
    const stages = container.querySelectorAll('li.bstage');
    expect(stages.length).toBeGreaterThanOrEqual(2);
    expect(within(stages[0] as HTMLElement).getByRole('list', { name: /layout/i })).toBeTruthy();
    const rule = container.querySelector('li.brule')!;
    const words = [...rule.querySelectorAll('.bkw')].map((e) => e.textContent);
    expect(words).toContain('when');
    expect(words).toContain('then');
    expect(rule.querySelectorAll('button.bchip').length).toBeGreaterThanOrEqual(2);
  });

  it('every control is a labelled button; reorder buttons have positions in their names', () => {
    const { container } = render(
      <Builder
        value={golden('red-mart-then-flat')}
        onChange={() => undefined}
        env={env}
        diagnostics={[]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Move stage 2 up' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move stage 1 up' }).hasAttribute('disabled')).toBe(
      true,
    );
    for (const b of container.querySelectorAll('button')) {
      expect((b.textContent ?? '').trim() !== '' || b.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('moving a stage down reorders the JSON', () => {
    const onChange = vi.fn();
    render(
      <Builder
        value={golden('red-mart-then-flat')}
        onChange={onChange}
        env={env}
        diagnostics={[]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Move stage 1 down' }));
    const next = onChange.mock.calls[0]![0] as StrategyDefinition;
    expect(next.stages[1]!.id).toBe(golden('red-mart-then-flat').stages[0]!.id);
  });

  it('tapping an effect chip opens its editor and Done writes the change', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Builder
        value={golden('red-mart-then-flat')}
        onChange={onChange}
        env={env}
        diagnostics={[]}
      />,
    );
    const chip = container.querySelector('li.brule button[aria-label^="Effect"]') as HTMLElement;
    fireEvent.click(chip);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('attaches diagnostics to the row whose path is a prefix', () => {
    const d: Diagnostic = {
      code: 'E_UNKNOWN_STAGE',
      severity: 'error',
      path: '/stages/0/rules/0/then/0/goto',
      message: 'unknown stage nope',
    };
    const { container } = render(
      <Builder
        value={golden('red-mart-then-flat')}
        onChange={() => undefined}
        env={env}
        diagnostics={[d]}
      />,
    );
    const row = container.querySelector('#b-rule-0-0')!;
    expect(row.textContent).toContain('unknown stage nope');
    expect(row.querySelector('.bchip--err')).not.toBeNull();
  });

  it('every golden renders without throwing and validates in context', () => {
    for (const g of goldens as unknown as StrategyDefinition[]) {
      const { unmount } = render(
        <Builder value={g} onChange={() => undefined} env={env} diagnostics={[]} />,
      );
      unmount();
    }
    expect(validateStrategy(golden('flat-red'), null)).toEqual([]);
  });
});

describe('StrategyEditor', () => {
  it('switches to the JSON tab and reports parsed edits; bad JSON shows an alert', () => {
    const onChange = vi.fn();
    const v = golden('flat-red');
    render(
      <StrategyEditor value={v} onChange={onChange} env={env} diagnostics={[]} structural={[]} />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'JSON' }));
    const area = screen.getByLabelText<HTMLTextAreaElement>('Strategy JSON');
    fireEvent.input(area, { target: { value: '{ not json' } });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.input(area, { target: { value: JSON.stringify({ ...v, name: 'Renamed' }) } });
    expect((onChange.mock.calls[0]![0] as StrategyDefinition).name).toBe('Renamed');
  });

  it('refuses the builder tab while the document is not a strategy', () => {
    render(
      <StrategyEditor
        value={{ nope: 1 }}
        onChange={() => undefined}
        env={env}
        diagnostics={[]}
        structural={[]}
      />,
    );
    expect(screen.getByLabelText('Strategy JSON')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('unavailable');
  });
});

describe('review fixes', () => {
  const stratWith = (stages: unknown, extra: Record<string, unknown> = {}) =>
    ({
      schema: 1,
      id: 's',
      name: 's',
      game: 'roulette',
      unit: 2500,
      stages,
      ...extra,
    }) as StrategyDefinition;

  it('variables are plain numbers, not dollars', () => {
    const v = stratWith(
      [
        {
          id: 'a',
          layout: [{ bet: 'red', amount: { units: 1 } }],
          rules: [
            {
              when: { cmp: [{ var: 'x' }, '>', 3] },
              then: [{ inc: 'x' }, { set: 'x', to: 0 }],
            },
          ],
        },
      ],
      { vars: { x: 0 } },
    );
    const onChange = vi.fn();
    const { container } = render(
      <Builder value={v} onChange={onChange} env={env} diagnostics={[]} />,
    );
    const text = container.querySelector('#b-rule-0-0')!.textContent;
    expect(text).toContain('x > 3');
    expect(text).not.toContain('$0.03');
    expect(text).toContain('add 1 to x');
    // editing "inc by" offers a Number field and writes the plain value
    fireEvent.click(container.querySelector('#b-rule-0-0 button[aria-label^="Effect 1"]')!);
    expect(screen.getByLabelText('Number')).toBeTruthy();
    expect(screen.queryByLabelText('Dollars')).toBeNull();
    fireEvent.input(screen.getByLabelText('Number'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    const next = onChange.mock.calls[0]![0] as StrategyDefinition;
    expect(next.stages[0]!.rules![0]!.then[0]).toEqual({ inc: 'x', by: 2 });
  });

  it('a money comparison still reads in dollars', () => {
    const v = stratWith([
      {
        id: 'a',
        layout: [],
        rules: [{ when: { cmp: ['net', '<=', -10000] }, then: [{ stop: 'x' }] }],
      },
    ]);
    const { container } = render(
      <Builder value={v} onChange={() => undefined} env={env} diagnostics={[]} />,
    );
    expect(container.querySelector('#b-rule-0-0')!.textContent).toContain('−$100');
  });

  it('renaming a variable rewrites its references', () => {
    const v = stratWith(
      [
        {
          id: 'a',
          layout: [{ bet: 'red', amount: { units: 1 } }],
          rules: [{ when: { cmp: [{ var: 'x' }, '>', 3] }, then: [{ inc: 'x' }] }],
        },
      ],
      { vars: { x: 0 } },
    );
    const onChange = vi.fn();
    render(<Builder value={v} onChange={onChange} env={env} diagnostics={[]} />);
    fireEvent.input(screen.getByLabelText('Variable 1 name'), { target: { value: 'count' } });
    const next = onChange.mock.calls[0]![0] as StrategyDefinition;
    expect(next.vars).toEqual({ count: 0 });
    expect(JSON.stringify(next.stages)).toContain('"inc":"count"');
    expect(JSON.stringify(next.stages)).toContain('"var":"count"');
  });

  it('the progression editor shows only the fields its kind has', () => {
    const mk = (kind: string) =>
      stratWith([{ id: 'a', layout: [{ bet: 'red', amount: { prog: 'p' } }] }], {
        progressions: {
          p: {
            kind,
            track: 'red',
            ...(kind === 'martingale' ? { maxSteps: 5, onCap: 'reset' } : {}),
          },
        },
      });
    const { unmount } = render(
      <Builder value={mk('martingale')} onChange={() => undefined} env={env} diagnostics={[]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Progression: p: martingale/ }));
    expect(screen.getByLabelText('Maximum steps')).toBeTruthy();
    expect(screen.getByLabelText(/Multiplier/)).toBeTruthy();
    unmount();
    cleanup();
    render(<Builder value={mk('1-3-2-6')} onChange={() => undefined} env={env} diagnostics={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Progression: p: 1-3-2-6/ }));
    expect(screen.queryByLabelText(/Maximum steps/)).toBeNull();
  });

  it('keeps `offset` when the everyN counting changes', () => {
    const v = stratWith([
      {
        id: 'a',
        layout: [],
        rules: [{ when: { everyN: 5, offset: 2 }, then: [{ skipRound: true }] }],
      },
    ]);
    const onChange = vi.fn();
    const { container } = render(
      <Builder value={v} onChange={onChange} env={env} diagnostics={[]} />,
    );
    fireEvent.click(container.querySelector('#b-rule-0-0 button[aria-label^="Condition 1"]')!);
    fireEvent.change(screen.getByLabelText('Counting'), { target: { value: 'stage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    const next = onChange.mock.calls[0]![0] as StrategyDefinition;
    expect(next.stages[0]!.rules![0]!.when).toEqual({ everyN: 5, offset: 2, of: 'stage' });
  });

  it('moving an item keeps keyboard focus on its move button', async () => {
    const { container } = render(
      <Builder
        value={golden('red-mart-then-flat')}
        onChange={() => undefined}
        env={env}
        diagnostics={[]}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Move stage 1 down' });
    btn.focus();
    fireEvent.click(btn);
    await new Promise((r) => setTimeout(r, 80));
    expect(container).toBeTruthy();
    // the value prop did not change in this harness, so focus returns to a stage move button
    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toMatch(
      /^Move stage 2 /,
    );
  });

  it('opens On enter and on exit when it has a diagnostic and asks before deleting a stage', () => {
    const d: Diagnostic = {
      code: 'E_X',
      severity: 'error',
      path: '/stages/0/onEnter/0',
      message: 'bad hook',
    };
    const v = stratWith([{ id: 'a', layout: [], onEnter: [{ clear: true }] }]);
    const onChange = vi.fn();
    const { container } = render(
      <Builder value={v} onChange={onChange} env={env} diagnostics={[d]} />,
    );
    expect((container.querySelector('details.bhooks') as HTMLDetailsElement).open).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete stage 1' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete stage' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
