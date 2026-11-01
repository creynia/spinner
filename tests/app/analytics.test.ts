import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COUNT_URL,
  analyticsEnabled,
  countUrl,
  pagePath,
  trackEvent,
  trackPage,
} from '@app/analytics';
import { resolveRoute } from '@app/routes';
import { parseHash } from '@app/router';

const env = (hostname: string, nav: Record<string, unknown> = {}, protocol = 'https:') => ({
  location: { hostname, protocol },
  navigator: nav,
});

describe('analyticsEnabled', () => {
  it('is on only for https creynia.com', () => {
    expect(analyticsEnabled(env('creynia.com'))).toBe(true);
    expect(analyticsEnabled(env('www.creynia.com'))).toBe(true);
    expect(analyticsEnabled(env('localhost'))).toBe(false);
    expect(analyticsEnabled(env('creynia.github.io'))).toBe(false);
    expect(analyticsEnabled(env('', {}, 'file:'))).toBe(false);
    expect(analyticsEnabled(env('creynia.com', {}, 'http:'))).toBe(false);
  });
  it('is off for automated browsers, Do Not Track and Global Privacy Control', () => {
    expect(analyticsEnabled(env('creynia.com', { webdriver: true }))).toBe(false);
    expect(analyticsEnabled(env('creynia.com', { doNotTrack: '1' }))).toBe(false);
    expect(analyticsEnabled(env('creynia.com', { globalPrivacyControl: true }))).toBe(false);
  });
  it('is off in the test DOM (localhost)', () => {
    expect(analyticsEnabled()).toBe(false);
  });
});

describe('countUrl', () => {
  it('builds a GoatCounter /count URL', () => {
    const u = new URL(countUrl({ path: '/spinner/#/run/:runId', title: 'T', event: true }, 390));
    expect(u.origin + u.pathname).toBe(COUNT_URL);
    expect(u.searchParams.get('p')).toBe('/spinner/#/run/:runId');
    expect(u.searchParams.get('t')).toBe('T');
    expect(u.searchParams.get('e')).toBe('true');
    expect(u.searchParams.get('s')).toBe('390');
    expect(u.searchParams.has('r')).toBe(false);
  });
});

describe('pagePath', () => {
  const counted = (hash: string) =>
    pagePath('/spinner/index.html', resolveRoute(parseHash(hash).path).pattern);
  it('maps hash routes onto the app path', () => {
    expect(pagePath('/spinner/', '/')).toBe('/spinner/');
    expect(counted('#/')).toBe('/spinner/');
    expect(counted('#/library')).toBe('/spinner/#/library');
  });
  it('sends the route pattern: ids, names and query strings never leave', () => {
    expect(counted('#/run/r-123')).toBe('/spinner/#/run/:runId');
    expect(counted('#/watch/r-123/4?speed=2')).toBe('/spinner/#/watch/:runId/:index');
    expect(counted('#/define/My%20secret%20system')).toBe('/spinner/#/define/:definitionId');
    expect(counted('#/analyze/abc?tab=risk')).toBe('/spinner/#/analyze/:runId');
    expect(counted('#/compare?runs=a,b')).toBe('/spinner/#/compare');
    expect(counted('#/anything/typed/here')).toBe('/spinner/#/404');
  });
});

describe('track*', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('sends nothing when disabled', () => {
    const img = vi.fn();
    vi.stubGlobal('Image', img);
    trackPage('/spinner/');
    trackEvent('run-start');
    trackEvent('gallery-open');
    expect(img).not.toHaveBeenCalled();
  });
});
