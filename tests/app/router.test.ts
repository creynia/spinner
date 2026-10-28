import { describe, expect, it } from 'vitest';
import { matchPath, parseHash } from '@app/router';

describe('parseHash', () => {
  it('splits path and query, decoding segments', () => {
    const { path, query } = parseHash('#/analyze/r%201?tab=risk');
    expect(path).toBe('/analyze/r 1');
    expect(query.get('tab')).toBe('risk');
  });
  it('never throws and normalizes', () => {
    expect(parseHash('').path).toBe('/');
    expect(parseHash('#').path).toBe('/');
    expect(parseHash('#//a///b/').path).toBe('/a/b');
    expect(parseHash('#/a/%E0%A4%A').path).toBe('/a/%E0%A4%A');
  });
});

describe('matchPath', () => {
  it('matches params by segment count', () => {
    expect(matchPath('/run/:runId', '/run/abc')).toEqual({ runId: 'abc' });
    expect(matchPath('/run/:runId', '/run')).toBeNull();
    expect(matchPath('/run/:runId', '/run/a/b')).toBeNull();
    expect(matchPath('/', '/')).toEqual({});
  });
});
