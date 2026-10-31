// Ladder calculator: presets fill every field, bad input shows the error and keeps the last
// result (greyed), outputs match calculate(), the live sentence settles after a pause.
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { amountsHint, LadderCalculator, runOutText, summarySentence } from './LadderCalculator';
import { CALC_PRESETS, calculate } from './calculator';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const field = (c: Element, id: string) => c.querySelector<HTMLInputElement>(`#calc-${id}`)!;
const stat = (c: Element, label: string): HTMLElement =>
  [...c.querySelectorAll('.stat')].find(
    (s) => s.querySelector('.stat-label')?.textContent === label,
  )! as HTMLElement;
const type = (el: HTMLInputElement, v: string): void => {
  fireEvent.input(el, { target: { value: v } });
};

describe('LadderCalculator', () => {
  it('starts with the defaults: red doubling from $25 in a $5,000 bankroll', () => {
    const { container } = render(<LadderCalculator />);
    expect(field(container, 'c').value).toBe('18');
    expect(field(container, 'base').value).toBe('25');
    expect(field(container, 'unit').value).toBe('1');
    expect(field(container, 'max').value).toBe('5000');
    expect(field(container, 'bankroll').value).toBe('5000');
    expect(field(container, 'spins').value).toBe('500');
    expect(field(container, 'w').value).toBe('0');
    expect(stat(container, 'Levels that fit').querySelector('.stat-value')?.textContent).toBe('7');
  });

  it('a preset fills every field and the outputs follow', () => {
    const { container, getByRole } = render(<LadderCalculator />);
    const chip = getByRole('button', { name: 'Red, doubling from $5' });
    fireEvent.click(chip);
    const p = CALC_PRESETS.find((x) => x.id === 'red-5')!.input;
    expect(field(container, 'c').value).toBe('18');
    expect(field(container, 'base').value).toBe('5');
    expect(field(container, 'unit').value).toBe('5');
    expect(field(container, 'max').value).toBe('5000');
    expect(field(container, 'bankroll').value).toBe('5115');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    const levels = stat(container, 'Levels that fit');
    expect(levels.querySelector('.stat-value')?.textContent).toBe('10');
    expect(levels.querySelector('.stat-hint')?.textContent).toBe('$5, $10, $20 … $2,560');
    const r = calculate(p);
    expect(stat(container, 'Typical session stays ahead until').textContent).toContain('1,117');
    expect(Math.abs(r.ladder.nHalf - 1117)).toBeLessThan(3);
    expect(stat(container, 'Typical session stays ahead until').textContent).toContain(
      'beyond this 500-spin session',
    );
  });

  it('the dozen preset gives 11 levels', () => {
    const { container, getByRole } = render(<LadderCalculator />);
    fireEvent.click(getByRole('button', { name: 'Dozen, ×1.5 from $25' }));
    expect(field(container, 'c').value).toBe('12');
    expect(stat(container, 'Levels that fit').querySelector('.stat-value')?.textContent).toBe('11');
  });

  it('invalid coverage shows the error and keeps the last result, greyed', () => {
    const { container } = render(<LadderCalculator />);
    const before = container.querySelector('.research-calc-stats')!.textContent;
    type(field(container, 'c'), '40');
    expect(container.querySelector('#calc-c-err')?.textContent).toBe('Pick 1 to 35 numbers.');
    expect(field(container, 'c').getAttribute('aria-invalid')).toBe('true');
    const out = container.querySelector('.research-calc-outputs')!;
    expect(out.getAttribute('aria-disabled')).toBe('true');
    expect(container.querySelector('.research-calc-stats')!.textContent).toBe(before);
    type(field(container, 'c'), '12');
    expect(container.querySelector('#calc-c-err')).toBeNull();
    expect(out.getAttribute('aria-disabled')).toBeNull();
    expect(container.querySelector('.research-calc-stats')!.textContent).not.toBe(before);
  });

  it('a first bet above the bet maximum is an error; a bankroll below the first bet too', () => {
    const { container } = render(<LadderCalculator />);
    type(field(container, 'base'), '6000');
    expect(container.querySelector('#calc-base-err')?.textContent).toBe(
      'The first bet must fit under the bet maximum.',
    );
    type(field(container, 'base'), '25');
    type(field(container, 'bankroll'), '10');
    expect(container.querySelector('#calc-bankroll-err')?.textContent).toBe(
      'The bankroll must cover the first bet.',
    );
  });

  it('flags text that is not money', () => {
    const { container } = render(<LadderCalculator />);
    type(field(container, 'bankroll'), 'abc');
    expect(container.querySelector('#calc-bankroll-err')?.textContent).toMatch(/Enter an amount/);
    expect(container.querySelector('.research-calc-outputs')!.getAttribute('aria-disabled')).toBe(
      'true',
    );
  });

  it('a bankroll that cannot fit the first bet level says nothing fits', () => {
    const { container } = render(<LadderCalculator initial={{ ...CALC_PRESETS[0]!.input }} />);
    type(field(container, 'bankroll'), '25');
    type(field(container, 'base'), '25');
    type(field(container, 'unit'), '30');
    // first bet rounds up to $30, which no longer fits $25
    expect(container.textContent).toContain(
      'The first bet does not fit: raise the bankroll or the bet maximum.',
    );
  });

  it('a cash-out target changes the chance of ending ahead and the typical session', () => {
    const { container, getByRole } = render(<LadderCalculator />);
    fireEvent.click(getByRole('button', { name: 'Red, doubling from $25' }));
    const none = stat(container, 'Chance of ending ahead').querySelector(
      '.stat-value',
    )!.textContent;
    type(field(container, 'w'), '20');
    const w20 = stat(container, 'Chance of ending ahead').querySelector('.stat-value')!.textContent;
    expect(w20).not.toBe(none);
    expect(stat(container, 'Typical session (predicted)').textContent).toContain('+$');
    expect(container.querySelector('#calc-w-hint')?.textContent).toMatch(/= \$\d/);
  });

  it('warns when the growth does not win back the losses', () => {
    // a dozen at $1 with $10 chips: the third level only breaks even
    const input = {
      c: 12,
      base: 100,
      unit: 1000,
      betMax: 500000,
      bankroll: 500000,
      spins: 500,
      w: 0,
    };
    expect(calculate(input).ladder.firstDeficitLevel).toBe(2);
    const { container } = render(<LadderCalculator initial={input} />);
    expect(container.querySelector('.research-calc-outputs p.error')?.textContent).toBe(
      'Level 3 does not win back the losses before it: raise the growth or the chip size.',
    );
  });

  it('announces a summary 600 ms after the last change, not on load', () => {
    vi.useFakeTimers();
    const { container } = render(<LadderCalculator />);
    const live = container.querySelector('[aria-live="polite"]')!;
    void act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(live.textContent).toBe('');
    type(field(container, 'c'), '12');
    void act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(live.textContent).toBe('');
    void act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(live.textContent).toMatch(
      /^\d+ levels; typical session ahead until about spin [\d,]+; chance of ending ahead [\d.]+%$/,
    );
  });
});

describe('formatting helpers', () => {
  it('amountsHint shows the first three and the last', () => {
    expect(amountsHint([500, 1000, 2000, 4000, 256000])).toBe('$5, $10, $20 … $2,560');
    expect(amountsHint([500, 1000])).toBe('$5, $10');
  });

  it('runOutText gives the percentage and the odds', () => {
    expect(runOutText((19 / 37) ** 10)).toMatch(/^0\.13% \(1 in 7\d\d\)$/);
    expect(runOutText(1e-12)).toContain('more than 1 in a billion');
  });

  it('summarySentence names levels, horizon and chance', () => {
    const r = calculate(CALC_PRESETS[1]!.input);
    expect(summarySentence(r)).toMatch(
      /^10 levels; typical session ahead until about spin 1,11\d;/,
    );
  });
});
