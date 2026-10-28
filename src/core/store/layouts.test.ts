import { describe, expect, it } from 'vitest';
import type { ChipLayout } from '../contracts/layout';
import bond from './__fixtures__/layouts/james-bond.json';
import type { LayoutFileError } from './layouts';
import { allocLayoutId, decodeLayoutFile, encodeLayoutFile, layoutHash } from './layouts';

const jb = bond as ChipLayout;
const app = { id: 'spinner', version: '1.2.3' };
const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as LayoutFileError).code;
  }
  return undefined;
};

describe('layoutHash', () => {
  it('is pinned for James Bond', async () => {
    expect(await layoutHash(jb)).toBe(
      '71b96083c5c67d95b943f772ff99768a113e0e53a974262933760ac055dd1812',
    );
  });
  it('ignores placement order, name, id and notes; sees chips, variant and game', async () => {
    const h = await layoutHash(jb);
    expect(
      await layoutHash({ ...jb, name: 'x', id: 'y', notes: 'n', spots: [...jb.spots].reverse() }),
    ).toBe(h);
    expect(await layoutHash({ ...jb, variant: 'american' })).not.toBe(h);
    expect(await layoutHash({ ...jb, game: 'craps' })).not.toBe(h);
    expect(
      await layoutHash({ ...jb, spots: [{ ...jb.spots[0]!, chips: 15 }, ...jb.spots.slice(1)] }),
    ).not.toBe(h);
  });
});

describe('allocLayoutId', () => {
  it('slugs the name and numbers collisions', () => {
    expect(allocLayoutId('Corners and Red!', new Set())).toBe('corners-and-red');
    expect(allocLayoutId('Corners and Red', new Set(['corners-and-red']))).toBe(
      'corners-and-red-2',
    );
    expect(
      allocLayoutId('Corners and Red', new Set(['corners-and-red', 'corners-and-red-2'])),
    ).toBe('corners-and-red-3');
  });
  it('always yields a valid slug', () => {
    const re = /^[a-z][a-z0-9-]{0,39}$/;
    for (const n of ['', '   ', '123', 'Ünïcode Ñame', '日本語', 'x'.repeat(80), '-a-']) {
      expect(allocLayoutId(n, new Set())).toMatch(re);
    }
    const long = 'x'.repeat(80);
    const first = allocLayoutId(long, new Set());
    const second = allocLayoutId(long, new Set([first]));
    expect(second).toMatch(re);
    expect(second).not.toBe(first);
    expect(second.endsWith('-2')).toBe(true);
  });
});

describe('layout file codec', () => {
  it('encodes canonically and round-trips byte-identically', () => {
    const text = encodeLayoutFile([jb], app);
    expect(
      text.startsWith('{"app":{"id":"spinner","version":"1.2.3"},"format":"casino-lab-layout"'),
    ).toBe(true);
    const back = decodeLayoutFile(text);
    expect(back).toEqual({ format: 'casino-lab-layout', version: 1, app, layouts: [jb] });
    expect(encodeLayoutFile(back.layouts, back.app)).toBe(text);
  });
  it('refuses with stable codes', () => {
    const ok = JSON.parse(encodeLayoutFile([jb], app)) as Record<string, unknown>;
    const t = (o: unknown) => JSON.stringify(o);
    expect(code(() => decodeLayoutFile('nope'))).toBe('not-json');
    expect(code(() => decodeLayoutFile('null'))).toBe('wrong-format');
    expect(code(() => decodeLayoutFile('[]'))).toBe('wrong-format');
    expect(code(() => decodeLayoutFile(t({ ...ok, format: 'spinner-run' })))).toBe('wrong-format');
    expect(code(() => decodeLayoutFile(t({ ...ok, version: 2 })))).toBe('newer-version');
    expect(code(() => decodeLayoutFile(t({ ...ok, version: 0 })))).toBe('bad-version');
    expect(code(() => decodeLayoutFile(t({ ...ok, version: '1' })))).toBe('bad-version');
    expect(code(() => decodeLayoutFile(t({ ...ok, app: null })))).toBe('bad-shape');
    expect(code(() => decodeLayoutFile(t({ ...ok, layouts: [] })))).toBe('bad-shape');
    expect(code(() => decodeLayoutFile(t({ ...ok, layouts: 'x' })))).toBe('bad-shape');
    expect(code(() => decodeLayoutFile(t({ ...ok, layouts: [5] })))).toBe('bad-shape');
    expect(
      code(() => decodeLayoutFile(t({ ...ok, layouts: Array.from({ length: 501 }, () => jb) }))),
    ).toBe('bad-shape');
    expect(
      code(() => decodeLayoutFile(t({ ...ok, layouts: Array.from({ length: 500 }, () => jb) }))),
    ).toBeUndefined();
  });
});
