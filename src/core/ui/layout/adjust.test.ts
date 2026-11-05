import { describe, expect, it } from 'vitest';
import { addOneEach, doubleSpots, halveSpots } from './adjust';

const step = (bet: string) => (bet === 'voisins' ? 9 : 1);

describe('doubleSpots', () => {
  it('doubles every spot in order without touching the input', () => {
    const spots = [
      { bet: 'b', chips: 3 },
      { bet: 'a', chips: 1 },
    ];
    expect(doubleSpots(spots)).toEqual({
      ok: true,
      spots: [
        { bet: 'b', chips: 6 },
        { bet: 'a', chips: 2 },
      ],
    });
    expect(spots[0]!.chips).toBe(3);
  });

  it('refuses an empty layout and a spot that would pass the cap', () => {
    expect(doubleSpots([])).toEqual({ ok: false, reason: 'empty' });
    expect(doubleSpots([{ bet: 'a', chips: 501 }])).toEqual({
      ok: false,
      reason: 'max-chips',
      bet: 'a',
    });
    expect(doubleSpots([{ bet: 'a', chips: 500 }]).ok).toBe(true);
    expect(doubleSpots([{ bet: 'a', chips: 3 }], 5)).toMatchObject({ ok: false, bet: 'a' });
    expect(doubleSpots([{ bet: 'a', chips: 5000 }], Infinity).ok).toBe(true);
  });
});

describe('halveSpots', () => {
  it('halves when every spot divides evenly into whole steps', () => {
    expect(
      halveSpots(
        [
          { bet: 'a', chips: 4 },
          { bet: 'voisins', chips: 18 },
        ],
        step,
      ),
    ).toEqual({
      ok: true,
      spots: [
        { bet: 'a', chips: 2 },
        { bet: 'voisins', chips: 9 },
      ],
    });
  });

  it('refuses odd counts, call bets below two pieces, and empty layouts', () => {
    expect(halveSpots([], step)).toEqual({ ok: false, reason: 'empty' });
    expect(
      halveSpots(
        [
          { bet: 'a', chips: 2 },
          { bet: 'b', chips: 3 },
        ],
        step,
      ),
    ).toEqual({ ok: false, reason: 'uneven', bet: 'b' });
    expect(halveSpots([{ bet: 'voisins', chips: 9 }], step)).toMatchObject({ ok: false });
    expect(halveSpots([{ bet: 'voisins', chips: 27 }], step)).toMatchObject({ ok: false });
    // 36 → 18 is two pieces of 9: fine.
    expect(halveSpots([{ bet: 'voisins', chips: 36 }], step).ok).toBe(true);
    expect(halveSpots([{ bet: 'a', chips: 1 }], step)).toMatchObject({ ok: false });
  });
});

describe('addOneEach', () => {
  it('adds one chip (a call bet: its pieces) to every spot', () => {
    expect(
      addOneEach(
        [
          { bet: 'red', chips: 2 },
          { bet: 'voisins', chips: 9 },
        ],
        step,
      ),
    ).toEqual({
      ok: true,
      spots: [
        { bet: 'red', chips: 3 },
        { bet: 'voisins', chips: 18 },
      ],
    });
  });

  it('refuses an empty layout and a spot that would pass the cap', () => {
    expect(addOneEach([], step)).toEqual({ ok: false, reason: 'empty' });
    expect(addOneEach([{ bet: 'red', chips: 5 }], step, 5)).toEqual({
      ok: false,
      reason: 'max-chips',
      bet: 'red',
    });
  });
});
