import { describe, expect, it } from 'vitest';
import { coin, COIN_BET, type CoinRules, type CoinState } from '../testing';
import type { Rng } from '../contracts/game';
import {
  CryptoRng,
  addChipEach,
  setRulesOverrides,
  betsTotal,
  checkBets,
  clearBets,
  createSession,
  doubleBets,
  equityOf,
  luckOf,
  placeBet,
  placeSpots,
  rebet,
  removeBet,
  spin,
  spotsFromBets,
  topUp,
  undoBets,
  type PlayEnv,
  type PlayResult,
  type PlaySession,
  type SpinResult,
} from '.';

const rules: CoinRules = coin.rules.resolve();
const env: PlayEnv<CoinState, CoinRules> = {
  plugin: coin,
  rules,
  restore: (snap, rng: Rng) => ({ ...coin.deserialize(snap), rng }),
  now: () => '2026-11-03T00:00:00.000Z',
};

const ok = (r: PlayResult): PlaySession => {
  if (!r.ok) throw new Error(`refused: ${r.code} ${r.message}`);
  return r.session;
};
const spun = (r: SpinResult) => {
  if (!r.ok) throw new Error(`refused: ${r.code} ${r.message}`);
  return r;
};
const seeded = (bankroll = 10_000) =>
  createSession(env, { variant: 'standard', bankroll, rng: { kind: 'seeded', seed: 42 } });

describe('play session: bets', () => {
  it('places, merges, removes and undoes bets without touching the bankroll', () => {
    let s = seeded();
    s = ok(placeBet(env, s, COIN_BET, 500));
    s = ok(placeBet(env, s, COIN_BET, 500));
    expect(s.bets).toEqual([{ bet: COIN_BET, amount: 1000 }]);
    expect(s.bankroll).toBe(10_000);
    s = ok(removeBet(env, s, COIN_BET, 300));
    expect(betsTotal(s.bets)).toBe(700);
    s = ok(undoBets(s));
    expect(betsTotal(s.bets)).toBe(1000);
    s = ok(clearBets(s));
    expect(s.bets).toEqual([]);
    s = ok(undoBets(s));
    expect(betsTotal(s.bets)).toBe(1000);
  });

  it('refuses unaffordable, over-max and unknown bets', () => {
    const s = seeded(1000);
    const r1 = placeBet(env, s, COIN_BET, 1100);
    expect(r1.ok === false && r1.code).toBe('unaffordable');
    const big = seeded(1_000_000);
    const r2 = placeBet(env, big, COIN_BET, rules.max + 100);
    expect(r2.ok === false && r2.code).toBe('over-max');
    const r3 = placeBet(env, s, 'tails', 100);
    expect(r3.ok).toBe(false);
  });

  it('places a chip layout at a chip value, adding or replacing', () => {
    let s = seeded();
    s = ok(placeBet(env, s, COIN_BET, 100));
    s = ok(placeSpots(env, s, [{ bet: COIN_BET, chips: 3 }], 200, 'add'));
    expect(betsTotal(s.bets)).toBe(700);
    s = ok(placeSpots(env, s, [{ bet: COIN_BET, chips: 3 }], 200, 'replace'));
    expect(betsTotal(s.bets)).toBe(600);
  });

  it('flags below-minimum bets before the spin and refuses to spin them', () => {
    const tight = { ...env, rules: { ...rules, min: 500 } };
    let s = createSession(tight, {
      variant: 'standard',
      bankroll: 10_000,
      rng: { kind: 'seeded', seed: 1 },
    });
    s = ok(placeBet(tight, s, COIN_BET, 100));
    expect(checkBets(tight, s).length).toBe(1);
    const r = spin(tight, s);
    expect(r.ok === false && r.code).toBe('table');
  });
});

describe('play session: spins', () => {
  it('settles a spin, records stats and enables rebet and double', () => {
    let s = seeded();
    s = ok(placeBet(env, s, COIN_BET, 1000));
    const r = spun(spin(env, s));
    s = r.session;
    expect(r.spin.wagered).toBe(1000);
    expect(Math.abs(r.spin.net)).toBe(1000);
    expect(s.bankroll).toBe(10_000 + r.spin.net);
    expect(s.bets).toEqual([]);
    expect(s.lastBets).toEqual([{ bet: COIN_BET, amount: 1000 }]);
    expect(s.stats.spins).toBe(1);
    expect(s.stats.wagered).toBe(1000);
    expect(s.stats.expectedLoss).toBeCloseTo(1000 / 37, 6);
    expect(s.curve).toEqual([10_000, 10_000 + r.spin.net]);

    s = ok(rebet(env, s));
    expect(s.bets).toEqual([{ bet: COIN_BET, amount: 1000 }]);
    s = ok(doubleBets(env, s));
    expect(s.bets).toEqual([{ bet: COIN_BET, amount: 2000 }]);
    s = ok(clearBets(s));
    // Double with nothing placed doubles the last spin's bets.
    s = ok(doubleBets(env, s));
    expect(s.bets).toEqual([{ bet: COIN_BET, amount: 2000 }]);
  });

  it('a seeded session replays exactly and survives a JSON round trip', () => {
    const play = (s0: PlaySession, n: number, viaJson: boolean) => {
      let s = s0;
      const nets: number[] = [];
      for (let i = 0; i < n; i++) {
        s = ok(placeBet(env, s, COIN_BET, 100));
        const r = spun(spin(env, s));
        nets.push(r.spin.net);
        s = viaJson ? (JSON.parse(JSON.stringify(r.session)) as PlaySession) : r.session;
      }
      return { nets, s };
    };
    const a = play(seeded(), 40, false);
    const b = play(seeded(), 40, true);
    expect(b.nets).toEqual(a.nets);
    expect(a.nets.some((x) => x > 0) && a.nets.some((x) => x < 0)).toBe(true);
    const st = a.s.stats;
    expect(st.wins + st.losses + st.pushes).toBe(40);
    expect(st.net).toBe(a.s.bankroll - 10_000);
    expect(st.peak).toBeGreaterThanOrEqual(10_000);
    expect(st.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(Math.max(st.longestWinStreak, st.longestLossStreak)).toBeGreaterThan(0);
    expect(luckOf(st).luck).toBeCloseTo(st.net + st.expectedLoss, 6);
  });

  it('a crypto session spins with no stored RNG state', () => {
    let s = createSession(env, { variant: 'standard', bankroll: 5000 });
    s = ok(placeBet(env, s, COIN_BET, 100));
    const r = spun(spin(env, s));
    expect(r.session.rngState).toBeUndefined();
    expect(equityOf(r.session)).toBe(r.session.bankroll);
  });

  it('a spin without bets is allowed and changes nothing but the count', () => {
    const s = seeded();
    const r = spun(spin(env, s));
    expect(r.session.bankroll).toBe(10_000);
    expect(r.session.stats.spins).toBe(1);
    expect(r.session.stats.betSpins).toBe(0);
  });

  it('top-ups add cash without counting as a win', () => {
    let s = seeded(1000);
    s = topUp(s, 2000);
    expect(s.bankroll).toBe(3000);
    expect(s.bankIn).toBe(3000);
    s = ok(placeBet(env, s, COIN_BET, 100));
    const r = spun(spin(env, s));
    expect(r.session.stats.peak).toBeLessThanOrEqual(1100);
  });
});

describe('CryptoRng', () => {
  it('draws unbiased values in range from the fill source', () => {
    let k = 0;
    const rng = new CryptoRng((a) => {
      for (let i = 0; i < a.length; i++) a[i] = (k++ * 2654435761) >>> 0;
    });
    const counts = new Array<number>(37).fill(0);
    for (let i = 0; i < 37_000; i++) counts[rng.below(37)]! += 1;
    for (const c of counts) expect(c).toBeGreaterThan(700);
    const f = rng.float53();
    expect(f >= 0 && f < 1).toBe(true);
  });

  it('rejects the biased top of the range', () => {
    // 2^32 mod 37 = 4 values at the top must be redrawn.
    const vals = [0xffffffff, 0xfffffffe, 5];
    const rng = new CryptoRng((a) => {
      for (let i = 0; i < a.length; i++) a[i] = vals[Math.min(i, 2)]!;
    });
    expect(rng.below(37)).toBe(5);
  });

  it('uses the platform CSPRNG by default', () => {
    const rng = new CryptoRng();
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) seen.add(rng.below(1000));
    expect(seen.size).toBeGreaterThan(50);
  });
});

describe('spotsFromBets', () => {
  it('finds the largest common chip value', () => {
    expect(
      spotsFromBets([
        { bet: 'a', amount: 1500 },
        { bet: 'b', amount: 500 },
      ]),
    ).toEqual({
      spots: [
        { bet: 'a', chips: 3 },
        { bet: 'b', chips: 1 },
      ],
      chipValue: 500,
    });
    // A 9-piece call bet at $5 a piece stays a multiple of its 9 pieces.
    const r = spotsFromBets(
      [
        { bet: 'voisins', amount: 4500 },
        { bet: 'red', amount: 1000 },
      ],
      (b) => (b === 'voisins' ? 9 : 1),
    );
    expect(r.chipValue).toBe(500);
    expect(r.spots).toEqual([
      { bet: 'voisins', chips: 9 },
      { bet: 'red', chips: 2 },
    ]);
  });
});

describe('addChipEach and rules overrides', () => {
  it('adds one chip (times the step) to every bet, or to the last bets when none are placed', () => {
    let s = seeded();
    s = ok(placeBet(env, s, COIN_BET, 300));
    s = ok(addChipEach(env, s, 100));
    expect(s.bets).toEqual([{ bet: COIN_BET, amount: 400 }]);
    s = ok(addChipEach(env, s, 100, () => 3));
    expect(s.bets).toEqual([{ bet: COIN_BET, amount: 700 }]);
    s = ok(undoBets(s));
    expect(betsTotal(s.bets)).toBe(400);
    const r = spun(spin(env, s));
    s = ok(addChipEach(env, r.session, 100));
    expect(s.bets).toEqual([{ bet: COIN_BET, amount: 500 }]);
    const empty = addChipEach(env, seeded(), 100);
    expect(empty.ok === false && empty.code).toBe('no-bets');
  });

  it('stores and clears rules overrides', () => {
    let s = createSession(env, {
      variant: 'standard',
      bankroll: 1000,
      rulesOverrides: { min: 200 },
    });
    expect(s.rulesOverrides).toEqual({ min: 200 });
    s = setRulesOverrides(s, { max: 500 });
    expect(s.rulesOverrides).toEqual({ max: 500 });
    s = setRulesOverrides(s, {});
    expect(s.rulesOverrides).toBeUndefined();
  });
});
