import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '@app/App';
import { resolveRoute, routes } from '@app/routes';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

/** Every concrete address of architecture.md §6.2 (plus the benchmark route) with its pattern. */
const addresses: [hash: string, pattern: string][] = [
  ['#/', '/'],
  ['#/define', '/define'],
  ['#/define/abc123', '/define/:definitionId'],
  ['#/define?d=xyz', '/define'],
  ['#/run/r1', '/run/:runId'],
  ['#/analyze/r1?tab=risk', '/analyze/:runId'],
  ['#/watch/r1/4?round=2', '/watch/:runId/:index'],
  ['#/compare?runs=a,b', '/compare'],
  ['#/sweep/g1', '/sweep/:groupId'],
  ['#/library?tab=runs', '/library'],
  ['#/gallery', '/gallery'],
  ['#/gallery/b1', '/gallery/:bundleId'],
  ['#/import', '/import'],
  ['#/settings', '/settings'],
  ['#/settings/benchmark', '/settings/benchmark'],
  ['#/more', '/more'],
];

describe('routes', () => {
  it('has a route for every pattern of the table', () => {
    expect(routes.map((r) => r.pattern).sort()).toEqual(
      [...new Set(addresses.map(([, p]) => p))].sort(),
    );
  });
  it('sends unknown addresses to NotFound', () => {
    expect(resolveRoute('/nope').found).toBe(false);
    expect(resolveRoute('/run').found).toBe(false);
    expect(resolveRoute('/run/a/b').found).toBe(false);
  });
  it('extracts params', () => {
    expect(resolveRoute('/watch/r1/4').params).toEqual({ runId: 'r1', index: '4' });
  });
});

describe('the app shell', () => {
  it.each(addresses.map(([hash]) => [hash] as const))('%s renders exactly one h1', (hash) => {
    window.location.hash = hash;
    const { container } = render(<App />);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('main')).not.toBeNull();
    expect(container.querySelectorAll('.card').length).toBeGreaterThan(0);
  });
  it('renders a NotFound screen with a link home', () => {
    window.location.hash = '#/nope';
    const { container } = render(<App />);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('main a[href="#/"]')).not.toBeNull();
  });
  it('has both navigations with the four primary destinations', () => {
    const { container } = render(<App />);
    for (const nav of container.querySelectorAll('nav')) {
      expect([...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
        '#/',
        '#/define',
        '#/library',
        '#/more',
      ]);
    }
    expect(container.querySelectorAll('nav')).toHaveLength(2);
  });
});
