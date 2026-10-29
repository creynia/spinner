import { describe, expect, it } from 'vitest';
import { HLC_PATTERN } from '../contracts/sync';
import { cmpHlc, createClock, hlcDevice, hlcWall } from './hlc';

const A = '7k2m9qxd4a';
const B = 'bbbbbbbbbb';

describe('hlc', () => {
  it('encodes <wall>.<counter>.<device> and matches HLC_PATTERN', () => {
    const c = createClock(A, () => 0);
    const h = c.tickAt(1_700_000_000_000);
    expect(h).toMatch(HLC_PATTERN);
    expect(hlcWall(h)).toBe(1_700_000_000_000);
    expect(hlcDevice(h)).toBe(A);
    expect(h.split('.')[1]).toBe('0000');
  });

  it('tickAt: a later edit time resets the counter; the same or an earlier one bumps it', () => {
    const c = createClock(A, () => 0);
    const h1 = c.tickAt(1000);
    const h2 = c.tickAt(1000);
    const h3 = c.tickAt(900); // earlier edit time: wall does not go back
    const h4 = c.tickAt(2000);
    expect([h1, h2, h3, h4].map(hlcWall)).toEqual([1000, 1000, 1000, 2000]);
    expect([h1, h2, h3, h4].map((h) => h.split('.')[1])).toEqual(['0000', '0001', '0002', '0000']);
    expect([h1, h2, h3, h4]).toEqual([h1, h2, h3, h4].sort());
    expect(c.last).toBe(h4);
  });

  it('mints from the edit time, not the push time', () => {
    const c = createClock(A, () => 99_999);
    expect(hlcWall(c.tickAt(10_000))).toBe(10_000);
  });

  it('a non-finite edit time falls back to now()', () => {
    const c = createClock(A, () => 4242);
    expect(hlcWall(c.tickAt(Number.NaN))).toBe(4242);
  });

  it('recv keeps later local edits ahead of anything already seen', () => {
    const c = createClock(A, () => 0);
    c.tickAt(1000);
    const remote = createClock(B, () => 0).tickAt(5000);
    c.recv(remote);
    const h = c.tickAt(2000); // an edit made at 2000, after receiving a 5000 clock
    expect(cmpHlc(h, remote)).toBeGreaterThan(0);
    expect(hlcWall(h)).toBe(5000);
    expect(h.split('.')[1]).toBe('0001');
  });

  it('recv of an older HLC changes nothing', () => {
    const c = createClock(A, () => 0);
    const h = c.tickAt(5000);
    c.recv(createClock(B, () => 0).tickAt(10));
    expect(c.last).toBe(h);
  });

  it('resumes from a saved last', () => {
    const c1 = createClock(A, () => 0);
    c1.tickAt(5000);
    c1.tickAt(5000);
    const c2 = createClock(A, () => 0, c1.last);
    expect(c2.last).toBe(c1.last);
    expect(cmpHlc(c2.tickAt(1), c1.last)).toBeGreaterThan(0);
  });

  it('a counter overflow moves the wall on by one', () => {
    const c = createClock(A, () => 0, `000000064.zzzz.${A}`);
    const h = c.tickAt(100);
    expect(cmpHlc(h, `000000064.zzzz.${A}`)).toBeGreaterThan(0);
    expect(hlcWall(h)).toBe(hlcWall(`000000064.zzzz.${A}`) + 1);
  });

  it('never repeats or regresses at the top of the range: it throws instead', () => {
    const top = `${(36 ** 9 - 1).toString(36)}.zzzz.${A}`;
    const c = createClock(A, () => 0, top);
    expect(() => c.tickAt(1)).toThrow(/overflow/);
    expect(c.last).toBe(top);
  });

  it('recv refuses a forged far-future HLC and stays unpoisoned', () => {
    const c = createClock(A, () => 0);
    const before = c.tickAt(1000);
    expect(() => c.recv(`${(36 ** 9 - 1).toString(36)}.0000.${B}`)).toThrow(RangeError);
    expect(c.last).toBe(before);
  });

  it('cmpHlc is string order, ties impossible across devices', () => {
    const a = createClock(A, () => 0).tickAt(1000);
    const b = createClock(B, () => 0).tickAt(1000);
    expect(cmpHlc(a, a)).toBe(0);
    expect(Math.sign(cmpHlc(a, b))).toBe(-Math.sign(cmpHlc(b, a)));
    expect(cmpHlc(a, b)).not.toBe(0);
  });

  it('rejects malformed HLCs', () => {
    expect(() => hlcWall('nope')).toThrow(/malformed/);
  });
});
