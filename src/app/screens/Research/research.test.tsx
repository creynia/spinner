// The Research screen skeleton: one h1, ten chapters in order, each with a math block, a chart slot
// and takeaways; chapter navigation; ?chapter=<id> scrolls to the section.
import { cleanup, render } from '@testing-library/preact';
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
      expect(s.querySelector('.chart-slot')).not.toBeNull();
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

  it('scrolls the chapter named by ?chapter= into view', () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    view('chapter=cashout');
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.contexts[0] as HTMLElement).id).toBe('chapter-cashout');
  });

  it('ignores an unknown chapter', () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    expect(() => view('chapter=nope')).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});
