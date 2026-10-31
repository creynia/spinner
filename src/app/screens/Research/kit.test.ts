// Scales, formats and MathText of the Research kit.
import { cleanup } from '@testing-library/preact';
import { h, render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MathText,
  axisMoney,
  chartHeight,
  money,
  niceDomain,
  niceTicks,
  pct1,
  scaleLinear,
  seriesColor,
  spins,
  tickCountFor,
} from './kit';

afterEach(cleanup);

describe('scales', () => {
  it('scaleLinear maps the domain onto the range, either way round', () => {
    const f = scaleLinear(0, 500, 10, 110);
    expect([f(0), f(250), f(500)]).toEqual([10, 60, 110]);
    const g = scaleLinear(-100, 100, 200, 0);
    expect([g(-100), g(0), g(100)]).toEqual([200, 100, 0]);
    expect(scaleLinear(3, 3, 0, 10)(3)).toBe(5);
  });

  it('niceTicks gives round steps inside the range', () => {
    expect(niceTicks(0, 500, 5)).toEqual([0, 100, 200, 300, 400, 500]);
    expect(niceTicks(0, 2.5, 5)).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
    expect(niceTicks(-4200, 3100, 4)).toEqual([-4000, -2000, 0, 2000]);
    expect(niceTicks(1, 1)).toEqual([1]);
    expect(niceTicks(Number.NaN, 1)).toEqual([]);
  });

  it('niceDomain widens to tick steps', () => {
    expect(niceDomain(-4200, 3100, 4)).toEqual([-6000, 4000]);
    expect(niceDomain(0, 0)).toEqual([-1, 1]);
  });

  it('tickCountFor and chartHeight', () => {
    expect(tickCountFor(300, 80)).toBe(3);
    expect(tickCountFor(10, 80)).toBe(2);
    expect([chartHeight(294), chartHeight(1000), chartHeight(100)]).toEqual([220, 380, 220]);
  });

  it('seriesColor cycles through the six chart tokens, 1-based', () => {
    expect([seriesColor(1), seriesColor(6), seriesColor(7)]).toEqual([
      'var(--chart-1)',
      'var(--chart-6)',
      'var(--chart-1)',
    ]);
  });
});

describe('formats', () => {
  it('pct1 keeps one decimal', () => {
    expect(pct1(0.9031)).toBe('90.3%');
    expect(pct1(0)).toBe('0.0%');
  });

  it('money is signed, in dollars from cents', () => {
    expect(money(28600)).toBe('+$286');
    expect(money(-4600)).toBe('-$46');
    expect(money(0)).toBe('$0.00');
  });

  it('spins groups thousands', () => {
    expect(spins(1117)).toBe('1,117');
    expect(spins(500)).toBe('500');
  });

  it('axisMoney is compact', () => {
    expect(axisMoney(0)).toBe('$0');
    expect(axisMoney(50000)).toBe('$500');
    expect(axisMoney(150000)).toBe('$1.5k');
    expect(axisMoney(-500000)).toBe('-$5k');
    expect(axisMoney(Number.NaN)).toBe('–');
  });
});

describe('MathText', () => {
  const html = (text: string): string => {
    const box = document.createElement('div');
    render(h(MathText, { text }), box);
    return box.innerHTML;
  };

  it('turns ^ and _ into sup and sub', () => {
    expect(html('p^2 + x_i')).toBe('p<sup>2</sup> + x<sub>i</sub>');
    expect(html('e^(-x) and (1 - q)^W')).toBe('e<sup>-x</sup> and (1 - q)<sup>W</sup>');
    expect(html('S_(n+1)^2')).toBe('S<sub>n+1</sub><sup>2</sup>');
  });

  it('keeps a lone marker and plain text as text', () => {
    expect(html('a ^ b _ c')).toBe('a ^ b _ c');
    expect(html('no markup')).toBe('no markup');
  });

  it('never creates elements from the text', () => {
    expect(html('<b>x</b>^2')).toBe('&lt;b&gt;x&lt;/b&gt;<sup>2</sup>');
  });
});
