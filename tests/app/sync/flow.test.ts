/* eslint-disable @typescript-eslint/require-await -- async stubs and fake method tables */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthFlow, getAuth, setAuthForTest } from '../../../src/app/services/sync/flow';
import { createGisTokenSource, type GisConfig } from '../../../src/app/services/sync/gis';
import { freshGis } from './helpers';

beforeEach(() => localStorage.clear());
afterEach(() => setAuthForTest(null));

function mk(over: Partial<GisConfig> = {}) {
  const gis = freshGis();
  const source = createGisTokenSource({
    clientId: 'cid',
    load: async () => gis.api,
    whoAmI: async () => 'o@x',
    platform: () => ({ standalone: false, android: false }),
    timeoutMs: 20,
    ...over,
  });
  return { gis, flow: createAuthFlow(source) };
}

describe('auth flow (offer the redirect)', () => {
  it('offers the redirect after a blocked popup', async () => {
    const { gis, flow } = mk();
    gis.ctl.mode = 'blocked';
    expect(flow.offerRedirect.get()).toBe(false);
    await expect(flow.acquire(false)).rejects.toMatchObject({ code: 'popup-blocked' });
    expect(flow.offerRedirect.get()).toBe(true);
  });
  it('offers the redirect after the 120 s timeout', async () => {
    const { gis, flow } = mk();
    gis.ctl.mode = 'hang';
    await expect(flow.acquire(false)).rejects.toMatchObject({ code: 'timeout' });
    expect(flow.offerRedirect.get()).toBe(true);
  });
  it('offers the redirect only on the second closed popup', async () => {
    const { gis, flow } = mk();
    gis.ctl.mode = 'closed';
    await expect(flow.acquire(false)).rejects.toMatchObject({ code: 'popup-closed' });
    expect(flow.offerRedirect.get()).toBe(false);
    await expect(flow.acquire(false)).rejects.toMatchObject({ code: 'popup-closed' });
    expect(flow.offerRedirect.get()).toBe(true);
  });
  it('a success in between resets the count, and clears the offer', async () => {
    const { gis, flow } = mk();
    gis.ctl.mode = 'closed';
    await expect(flow.acquire(false)).rejects.toBeTruthy();
    gis.ctl.mode = 'grant';
    await flow.acquire(false);
    gis.ctl.mode = 'closed';
    await expect(flow.acquire(false)).rejects.toBeTruthy();
    expect(flow.offerRedirect.get()).toBe(false);
    gis.ctl.mode = 'blocked';
    await expect(flow.acquire(false)).rejects.toBeTruthy();
    expect(flow.offerRedirect.get()).toBe(true);
    gis.ctl.mode = 'grant';
    await flow.acquire(false);
    expect(flow.offerRedirect.get()).toBe(false);
  });
  it('denied and scope errors do not offer the redirect', async () => {
    const { gis, flow } = mk();
    gis.ctl.mode = 'denied';
    await expect(flow.acquire(false)).rejects.toMatchObject({ code: 'denied' });
    gis.ctl.mode = 'noscope';
    await expect(flow.acquire(false)).rejects.toMatchObject({ code: 'scope' });
    expect(flow.offerRedirect.get()).toBe(false);
  });
  it('acquireVia picks the flow explicitly ("Sign in in this window" / "Try popup instead")', async () => {
    const nav: unknown[] = [];
    const { gis, flow } = mk({
      platform: () => ({ standalone: true, android: true }),
      navigate: (o) => void nav.push(o),
    });
    await flow.acquireVia('popup', false);
    expect(gis.ctl.calls.length).toBe(1);
    void flow.acquireVia('redirect', false);
    await Promise.resolve();
    expect(nav.length).toBe(1);
  });
  it('getAuth is one shared flow built from the build client id', () => {
    const a = getAuth();
    expect(getAuth()).toBe(a);
    expect(a.source.state.state).not.toBe('unconfigured'); // the committed client id
  });
});
