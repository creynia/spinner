// Chapter "hits": toggling a count adds or removes a line, tapping the plot reads a spin.
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { ChHits } from './ChHits';
import { CHAPTERS } from './content';
import { hitChance, pct2 } from './hitChance';

afterEach(cleanup);
const chapter = CHAPTERS.find((c) => c.id === 'hits')!;

const lineKs = (c: Element) =>
  [...c.querySelectorAll('path.hits-line')].map((p) => p.getAttribute('data-k'));

/** jsdom has no layout: the svg is 640 wide (the fallback) starting at x = 0. */
function mockRect(c: Element): SVGSVGElement {
  const svg = c.querySelector('svg.hits-svg') as SVGSVGElement;
  svg.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 640, height: 333, right: 640, bottom: 333 }) as DOMRect;
  return svg;
}

describe('ChHits', () => {
  it('renders the default lines, the chips, a legend and the data table', () => {
    const { container } = render(<ChHits chapter={chapter} />);
    expect(lineKs(container)).toEqual(['1', '6', '12', '18']);
    const pressed = [...container.querySelectorAll('.chip[aria-pressed="true"]')].map(
      (b) => b.textContent,
    );
    expect(pressed).toEqual(['European (37)', '1', '6', '12', '18', '150']);
    expect(container.querySelectorAll('ul.sp-chart__legend li')).toHaveLength(4);
    expect(container.querySelectorAll('details.sp-chart__table tbody tr').length).toBeGreaterThan(
      5,
    );
    expect(container.querySelector('figcaption.sp-chart__title')?.textContent).toBeTruthy();
    expect(container.querySelector('.hits-readout')?.getAttribute('aria-live')).toBe('polite');
  });

  it('toggling a count adds and removes its line', () => {
    const { container, getByRole } = render(<ChHits chapter={chapter} />);
    fireEvent.click(getByRole('button', { name: '3 numbers' }));
    expect(lineKs(container)).toEqual(['1', '3', '6', '12', '18']);
    fireEvent.click(getByRole('button', { name: '1 number' }));
    expect(lineKs(container)).toEqual(['3', '6', '12', '18']);
    expect(container.querySelectorAll('ul.sp-chart__legend li')).toHaveLength(4);
  });

  it('adds a custom count and rejects a bad one', () => {
    const { container, getByLabelText, getByRole } = render(<ChHits chapter={chapter} />);
    const input = getByLabelText('Another count') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '37' } });
    fireEvent.click(getByRole('button', { name: 'Add' }));
    expect(container.querySelector('#hits-custom-note')?.textContent).toContain('1 to 36');
    expect(lineKs(container)).toEqual(['1', '6', '12', '18']);
    fireEvent.input(input, { target: { value: '7' } });
    fireEvent.click(getByRole('button', { name: 'Add' }));
    expect(lineKs(container)).toEqual(['1', '6', '7', '12', '18']);
    expect(getByRole('button', { name: '7 numbers' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking the plot snaps to the nearest spin and reads the exact chance of every line', () => {
    const { container } = render(<ChHits chapter={chapter} />);
    const svg = mockRect(container);
    // plot spans x = 44 .. 626 for spins 1 .. 150: x = 335 is spin 1 + (291/582) * 149 = 75.5 -> 76
    fireEvent.click(svg, { clientX: 335 });
    const readout = container.querySelector('.hits-readout') as HTMLElement;
    const spin = Number(readout.dataset.spin);
    expect(spin).toBeGreaterThanOrEqual(75);
    expect(spin).toBeLessThanOrEqual(76);
    const values = [...readout.querySelectorAll('li strong')].map((e) => e.textContent);
    expect(values).toEqual([1, 6, 12, 18].map((k) => pct2(hitChance(k, 37, spin))));
    expect(readout.textContent).toContain(`After ${spin} spins`);
    // one dot per line sits on the guide
    expect(container.querySelectorAll('circle.hits-dot')).toHaveLength(4);
  });

  it('clamps the clicked spin to 1 and to the last spin', () => {
    const { container } = render(<ChHits chapter={chapter} />);
    const svg = mockRect(container);
    fireEvent.click(svg, { clientX: 0 });
    expect((container.querySelector('.hits-readout') as HTMLElement).dataset.spin).toBe('1');
    expect(container.querySelector('.hits-readout li strong')?.textContent).toBe(pct2(1 / 37));
    fireEvent.click(svg, { clientX: 639 });
    expect((container.querySelector('.hits-readout') as HTMLElement).dataset.spin).toBe('150');
  });

  it('moves the spin with the arrow keys', () => {
    const { container } = render(<ChHits chapter={chapter} />);
    const svg = container.querySelector('svg.hits-svg') as SVGSVGElement;
    const spin = () =>
      Number((container.querySelector('.hits-readout') as HTMLElement).dataset.spin);
    const start = spin();
    fireEvent.keyDown(svg, { key: 'ArrowRight' });
    expect(spin()).toBe(start + 1);
    fireEvent.keyDown(svg, { key: 'ArrowLeft', shiftKey: true });
    expect(spin()).toBe(start - 9);
    fireEvent.keyDown(svg, { key: 'Home' });
    expect(spin()).toBe(1);
    fireEvent.keyDown(svg, { key: 'End' });
    expect(spin()).toBe(150);
  });

  it('changing the wheel changes the chances and the spin range clamps the selection', () => {
    const { container, getByRole } = render(<ChHits chapter={chapter} />);
    const svg = mockRect(container);
    fireEvent.keyDown(svg, { key: 'End' });
    fireEvent.click(getByRole('button', { name: '50' }));
    expect((container.querySelector('.hits-readout') as HTMLElement).dataset.spin).toBe('50');
    fireEvent.click(getByRole('button', { name: 'American (38)' }));
    const first = container.querySelector('.hits-readout li strong')?.textContent;
    expect(first).toBe(pct2(hitChance(1, 38, 50)));
  });

  it('says so when no count is selected', () => {
    const { container, getByRole } = render(<ChHits chapter={chapter} />);
    for (const k of [1, 6, 12, 18]) {
      fireEvent.click(getByRole('button', { name: k === 1 ? '1 number' : `${k} numbers` }));
    }
    expect(lineKs(container)).toEqual([]);
    expect(container.querySelector('.hits-readout')?.textContent).toContain('Pick at least one');
  });
});
