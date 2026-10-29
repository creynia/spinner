import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as GisModule from '../../../src/app/services/sync/gis';

const loadGis = vi.fn(() => Promise.resolve({}));
vi.mock('../../../src/app/services/sync/gis', async (orig) => ({
  ...(await orig<typeof GisModule>()),
  loadGis,
}));

const { setAuthForTest } = await import('../../../src/app/services/sync/flow');
const { preloadSignIn } = await import('../../../src/app/services/sync/test-signin');

function withState(state: string) {
  setAuthForTest({ source: { state: { state }, dispose: () => undefined } } as never);
}

beforeEach(() => {
  loadGis.mockClear();
  localStorage.clear();
});
afterEach(() => {
  setAuthForTest(null);
  vi.unstubAllGlobals();
});

describe('preloadSignIn (no Google request for people who never use sync)', () => {
  it('does not load GIS when signed out and nothing is in flight', () => {
    withState('signed-out');
    preloadSignIn();
    expect(loadGis).not.toHaveBeenCalled();
  });

  it('loads when a token or email hint exists', () => {
    withState('expired');
    preloadSignIn();
    withState('signed-in');
    preloadSignIn();
    expect(loadGis).toHaveBeenCalledTimes(2);
  });

  it('loads on eager (pointer or focus reached the test block)', () => {
    withState('signed-out');
    preloadSignIn({ eager: true });
    expect(loadGis).toHaveBeenCalledTimes(1);
  });

  it('never loads while offline', () => {
    vi.stubGlobal('navigator', { onLine: false });
    withState('signed-in');
    preloadSignIn({ eager: true });
    expect(loadGis).not.toHaveBeenCalled();
  });
});
