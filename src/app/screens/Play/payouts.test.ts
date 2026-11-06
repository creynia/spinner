import { describe, expect, it } from 'vitest';
import { ROULETTE_PRESETS } from '@game/roulette';
import { compactNet, payoutsByPocket } from './payouts';

const eu = ROULETTE_PRESETS.european;
const us = ROULETTE_PRESETS.american;

describe('payoutsByPocket', () => {
  it('is empty with no bets or only outside bets', () => {
    expect(payoutsByPocket(eu, []).size).toBe(0);
    expect(payoutsByPocket(eu, [{ bet: 'red', amount: 500 }]).size).toBe(0);
  });

  it('straight: 35 to 1 on the number, others not listed', () => {
    const m = payoutsByPocket(eu, [{ bet: 'straight:17', amount: 500 }]);
    expect([...m.keys()]).toEqual(['17']);
    expect(m.get('17')).toBe(17500);
  });

  it('split labels both numbers', () => {
    const m = payoutsByPocket(eu, [{ bet: 'split:1-2', amount: 100 }]);
    expect([...m.keys()].sort()).toEqual(['1', '2']);
    expect(m.get('1')).toBe(1700);
  });

  it('corner plus an outside bet adds the outside result', () => {
    const m = payoutsByPocket(eu, [
      { bet: 'corner:1-2-4-5', amount: 100 },
      { bet: 'black', amount: 2500 },
    ]);
    expect([...m.keys()].sort()).toEqual(['1', '2', '4', '5']);
    // 2 is black: corner 8:1 (+800) and black (+2500); 1 is red: +800 and black loses 2500.
    expect(m.get('2')).toBe(800 + 2500);
    expect(m.get('1')).toBe(800 - 2500);
  });

  it('straight plus an outside bet on the same number adds both wins', () => {
    const m = payoutsByPocket(eu, [
      { bet: 'straight:17', amount: 500 },
      { bet: 'black', amount: 2500 },
    ]);
    expect(m.get('17')).toBe(17500 + 2500);
  });

  it('a covered number can be negative overall', () => {
    const m = payoutsByPocket(eu, [
      { bet: 'straight:1', amount: 100 },
      { bet: 'black', amount: 10000 },
    ]);
    expect(m.get('1')).toBe(3500 - 10000);
  });

  it('call bet voisins labels its numbers only', () => {
    const m = payoutsByPocket(eu, [{ bet: 'voisins', amount: 900 }]);
    expect(m.has('0')).toBe(true);
    expect(m.has('25')).toBe(true);
    expect(m.has('1')).toBe(false);
  });

  it('american 00', () => {
    const m = payoutsByPocket(us, [{ bet: 'straight:00', amount: 100 }]);
    expect(m.get('00')).toBe(3500);
    expect([...m.keys()]).toEqual(['00']);
  });
});

describe('compactNet', () => {
  it('formats', () => {
    expect(compactNet(17500)).toBe('+$175');
    expect(compactNet(-2000)).toBe('−$20');
    expect(compactNet(120000)).toBe('+$1.2k');
    expect(compactNet(-1550000)).toBe('−$15.5k');
    expect(compactNet(250)).toBe('+$2.50');
  });
});
