// The Research screen skeleton: one h1, ten chapters in order, each with a math block, a chart slot
// and takeaways; chapter navigation; ?chapter=<id> scrolls to the section.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAPTER_CHARTS } from './chapters';
import { CHAPTERS } from './content';
import { Research } from './index';

afterEach(cleanup);

const ORDER = [
  'start',
  'edge',
  'martingale',
  'levels',
  'placement',
  'curve',
  'shapes',
  'cashout',
  'limits',
  'try',
];

const view = (qs = '') => render(<Research params={{}} query={new URLSearchParams(qs)} />);

describe('Research', () => {
  it('has the ten chapters of app-plan section 3 in order', () => {
    expect(CHAPTERS.map((c) => c.id)).toEqual(ORDER);
    expect(Object.keys(CHAPTER_CHARTS).sort()).toEqual([...ORDER].sort());
  });

  it('renders one h1 and the chapters as labelled sections with a details block each', () => {
    const { container } = view();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    const sections = [...container.querySelectorAll('section.research-chapter')];
    expect(sections.map((s) => s.id)).toEqual(ORDER.map((id) => `chapter-${id}`));
    for (const s of sections) {
      const label = s.getAttribute('aria-labelledby') ?? '';
      expect(s.querySelector(`h2#${label}`)).not.toBeNull();
      expect(s.querySelector('p.lead')).not.toBeNull();
      // A chart, stat tiles, a table or (until a chapter lands) the placeholder slot.
      expect(
        s.querySelector(
          '.chart-slot, figure.sp-chart, .research-versus, .research-tablewrap, form',
        ),
      ).not.toBeNull();
      expect(s.querySelector('ul.takeaways li')).not.toBeNull();
      expect(s.querySelector('details.math > summary')?.textContent).toBe('The math');
    }
  });

  it('links every chapter from both chapter lists', () => {
    const { container } = view();
    const lists = container.querySelectorAll('nav.research-nav');
    expect(lists).toHaveLength(2);
    for (const nav of lists) {
      expect([...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(
        ORDER.map((id) => `#/research?chapter=${id}`),
      );
    }
  });

  it('does not scroll without a chapter query', () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    view();
    expect(spy).not.toHaveBeenCalled();
  });

  it('scrolls the chapter named by ?chapter= into view without moving focus', async () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    view('chapter=cashout');
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect((spy.mock.contexts[0] as HTMLElement).id).toBe('chapter-cashout');
    expect(document.activeElement).toBe(document.body);
  });

  it('ignores an unknown chapter', async () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    expect(() => view('chapter=nope')).not.toThrow();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Research chapter links', () => {
  const spyReplace = () => vi.spyOn(history, 'replaceState');

  it('a chip rewrites the hash in place, scrolls and focuses the h2, without remounting', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const replace = spyReplace();
    const { container } = view();
    const section = container.querySelector('#chapter-cashout') as HTMLElement;
    const details = section.querySelector('details.math') as HTMLDetailsElement;
    details.open = true; // DOM state a remount would reset
    const chip = container.querySelector('nav.research-nav-chips a[href$="chapter=cashout"]')!;
    expect(fireEvent.click(chip)).toBe(false); // default prevented: no hash navigation
    expect(replace).toHaveBeenCalledWith(null, '', '#/research?chapter=cashout');
    expect(scroll).toHaveBeenCalledTimes(1);
    expect((scroll.mock.contexts[0] as HTMLElement).id).toBe('chapter-cashout');
    const h2 = section.querySelector('h2')!;
    expect(h2.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(h2);
    expect(container.querySelector('#chapter-cashout')).toBe(section);
    expect(
      (container.querySelector('#chapter-cashout details.math') as HTMLDetailsElement).open,
    ).toBe(true);
    replace.mockRestore();
  });

  it('the sticky list does the same and marks the chapter as current', () => {
    Element.prototype.scrollIntoView = vi.fn();
    const replace = spyReplace();
    const { container } = view();
    const link = container.querySelector('nav.research-nav-column a[href$="chapter=levels"]')!;
    fireEvent.click(link);
    expect(replace).toHaveBeenCalledWith(null, '', '#/research?chapter=levels');
    expect(link.getAttribute('aria-current')).toBe('location');
    replace.mockRestore();
  });

  it('leaves modified clicks to the browser', () => {
    const replace = spyReplace();
    const { container } = view();
    const link = container.querySelector('nav.research-nav-column a')!;
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    expect(replace).not.toHaveBeenCalled();
    replace.mockRestore();
  });

  it('ends every chapter with a next link, the last with a way back to the top', () => {
    Element.prototype.scrollIntoView = vi.fn();
    const { container } = view();
    const nexts = [...container.querySelectorAll('a.research-next')];
    expect(nexts.map((a) => a.getAttribute('href'))).toEqual([
      ...ORDER.slice(1).map((id) => `#/research?chapter=${id}`),
      '#/research',
    ]);
    expect(nexts[9]!.textContent).toBe('Back to the top');
    expect(nexts[0]!.textContent).toBe(`Next: ${CHAPTERS[1]!.title}`);
    fireEvent.click(nexts[9]!);
    expect(document.activeElement).toBe(container.querySelector('h1'));
  });

  it('labels each chapter with an eyebrow', () => {
    const { container } = view();
    expect(container.querySelector('#chapter-start .research-eyebrow')?.textContent).toBe(
      'Chapter 1',
    );
  });
});
