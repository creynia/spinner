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
