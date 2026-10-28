// Tap-to-place hit testing (layouts.md §4.4, WP-L3a): exhaustive over 3 wheels x 2 orientations.
import { describe, expect, it } from 'vitest';
import { OUTSIDE_BET_IDS, fixedBetIds } from '../bets';
import type { WheelKind } from '../types';
import {
  EDGE_BAND,
  LOCK_FAMILIES,
  buildBoard,
  betAt,
  betNearest,
  idPockets,
  toBoard,
  zoneSizes,
  type Board,
  type LockFamily,
  type Orientation,
  type Point,
} from './geometry';

const WHEELS: WheelKind[] = ['european', 'american', 'triple-zero'];
const ORIENTATIONS: Orientation[] = ['portrait', 'landscape'];
const CASES = WHEELS.flatMap((w) => ORIENTATIONS.map((o) => [w, o] as const));
const OUTSIDE = new Set<string>(OUTSIDE_BET_IDS);
const STEP = 2;

function famOf(id: string): LockFamily | null {
  const head = id.split(':')[0];
  if (id === 'basket' || head === 'trio' || head === 'corner') return 'corner';
  if (head === 'straight' || head === 'split' || head === 'street') return head;
  if (head === 'sixline') return 'line';
  return null;
}
const insideIds = (w: WheelKind): string[] => fixedBetIds(w).filter((id) => famOf(id) !== null);

function* grid(b: Board): Generator<Point> {
  for (let y = b.view.y + 0.5; y < b.view.y + b.view.h; y += STEP)
    for (let x = b.view.x + 0.5; x < b.view.x + b.view.w; x += STEP) yield { x, y };
}
const onTable = (b: Board, p: Point): boolean =>
  [...b.pockets.values()].some(
    (r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h,
  );
const centre = (r: { x: number; y: number; w: number; h: number }): Point => ({
  x: r.x + r.w / 2,
  y: r.y + r.h / 2,
});

describe.each(CASES)('%s %s', (wheel, orientation) => {
  const b = buildBoard(wheel, orientation);
  const inside = insideIds(wheel);

  it('maps pocket sets to bets uniquely', () => {
    const sets = new Map<string, string>();
    for (const id of inside) {
      const key = idPockets(id, wheel).join('|');
      expect(sets.get(key), `${id} shares its pockets with ${sets.get(key)}`).toBeUndefined();
      sets.set(key, id);
    }
  });

  it('every inside bet is reachable by betAt from some point', () => {
    const seen = new Set<string>();
    for (const p of grid(b)) {
      const id = betAt(b, p);
      if (id) seen.add(id);
    }
    expect(inside.filter((id) => !seen.has(id))).toEqual([]);
  });

  it('every inside bet is reachable by betNearest in its family', () => {
    for (const family of LOCK_FAMILIES) {
      const want = inside.filter((id) => famOf(id) === family);
      const seen = new Set<string>();
      for (const p of grid(b)) {
        const id = betNearest(b, p, family);
        if (id) seen.add(id);
      }
      expect(
        want.filter((id) => !seen.has(id)),
        family,
      ).toEqual([]);
    }
  });

  it('every point resolves to one legal bet whose pockets include the tapped cell', () => {
    const legal = new Set([...fixedBetIds(wheel)]);
    for (const p of grid(b)) {
      const id = betAt(b, p);
      if (id === null) continue;
      expect(legal.has(id), `${id} at ${p.x},${p.y}`).toBe(true);
      expect(betAt(b, p)).toBe(id);
      const cell = [...b.pockets].find(
        ([, r]) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h,
      );
      if (cell && !OUTSIDE.has(id)) {
        const covered = idPockets(id, wheel);
        expect(covered, `${id} at ${p.x},${p.y}`).toContain(cell[0]);
      }
    }
  });

  it('never returns an inside bet whose pockets are not all adjacent to the tap', () => {
    // Every pocket of the answer is within one edge band of the point (the basket aside).
    for (const p of grid(b)) {
      const id = betAt(b, p);
      if (
        !id ||
        !onTable(b, p) ||
        OUTSIDE.has(id) ||
        id === 'basket' ||
        id.startsWith('street') ||
        id.startsWith('sixline')
      )
        continue;
      if (id === 'trio:0-00-000') continue;
      for (const label of idPockets(id, wheel)) {
        const r = b.pockets.get(label)!;
        const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
        const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
        expect(Math.max(dx, dy), `${id} at ${p.x},${p.y}`).toBeLessThanOrEqual(EDGE_BAND + 1e-9);
      }
    }
  });

  it('cell centres are straights and outside boxes are direct', () => {
    for (const [label, r] of b.pockets) {
      expect(betAt(b, centre(r))).toBe(`straight:${label}`);
      expect(betNearest(b, centre(r), 'straight')).toBe(`straight:${label}`);
    }
    for (const o of b.outside) expect(betAt(b, centre(o.rect))).toBe(o.id);
  });

  it('is null off the table', () => {
    expect(betAt(b, { x: b.view.x - 5, y: b.view.y - 5 })).toBeNull();
    expect(betAt(b, { x: b.view.x + b.view.w + 5, y: 100 })).toBeNull();
    expect(betNearest(b, { x: b.view.x - 5, y: b.view.y - 5 }, 'split')).toBeNull();
  });

  it('streets and six lines come from the outer edge band', () => {
    // Row 2's cell on the street edge.
    const outer = b.pockets.get(orientation === 'portrait' ? '6' : '4')!;
    const q: Point =
      orientation === 'portrait'
        ? { x: b.edge - 3, y: outer.y + outer.h / 2 }
        : { x: outer.x + outer.w / 2, y: b.edge - 3 };
    expect(betAt(b, q)).toBe('street:4-5-6');
    const six: Point =
      orientation === 'portrait'
        ? { x: b.edge - 3, y: outer.y + outer.h - 3 }
        : { x: outer.x + outer.w - 3, y: b.edge - 3 };
    expect(betAt(b, six)).toBe('sixline:4-5-6-7-8-9');
    expect(betNearest(b, centre(b.pockets.get('5')!), 'street')).toBe('street:4-5-6');
  });

  it('lock mode picks the nearest anchor within the tapped cell', () => {
    // Number 5 is interior: four splits, four corners, two six lines.
    const r = b.pockets.get('5')!;
    const near = (dx: number, dy: number): Point => ({
      x: r.x + r.w / 2 + dx * r.w * 0.4,
      y: r.y + r.h / 2 + dy * r.h * 0.4,
    });
    const splits = new Set<string>();
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const)
      splits.add(betNearest(b, near(dx, dy), 'split')!);
    expect(splits.size).toBe(4);
    const corners = new Set<string>();
    for (const dx of [-1, 1])
      for (const dy of [-1, 1]) corners.add(betNearest(b, near(dx, dy), 'corner')!);
    expect(corners.size).toBe(4);
    const lines = new Set<string>();
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const)
      lines.add(betNearest(b, near(dx, dy), 'line')!);
    expect(lines.size).toBe(2);
    expect(betNearest(b, centre(b.pockets.get('0')!), 'street')).toBeNull();
  });

  it('pins the basket versus split 0-1 special case', () => {
    const a = b.basket;
    const one = b.pockets.get('1')!;
    const portrait = orientation === 'portrait';
    // The corner: inside number 1's cell, and on the zero side of the corner.
    const inOne: Point = portrait ? { x: a.x + 4, y: a.y + 4 } : { x: a.x + 4, y: a.y - 4 };
    const inZero: Point = portrait ? { x: a.x + 4, y: a.y - 4 } : { x: a.x - 4, y: a.y - 4 };
    expect(betAt(b, inOne)).toBe('basket');
    expect(betAt(b, inZero)).toBe('basket');
    if (portrait) expect(betAt(b, a)).toBe('basket');
    // Along the zero-side edge but away from the corner (and from the 1|2 line): split 0-1.
    const along: Point = portrait
      ? { x: one.x + one.w / 2, y: one.y + 3 }
      : { x: one.x + 3, y: one.y + one.h / 2 };
    expect(betAt(b, along)).toBe('split:0-1');
    const alongZero: Point = portrait
      ? { x: one.x + one.w / 2, y: one.y - 3 }
      : { x: one.x - 3, y: one.y + one.h / 2 };
    expect(betAt(b, alongZero)).toBe('split:0-1');
    // Away from the corner the dozen-side edge of number 1 has nothing across it (portrait: a
    // straight) or is the street edge (landscape: the street).
    if (portrait) expect(betAt(b, { x: one.x + 3, y: one.y + one.h / 2 })).toBe('straight:1');
    else expect(betAt(b, { x: one.x + one.w / 2, y: one.y + one.h - 3 })).toBe('street:1-2-3');
    // Only that corner is the basket.
    for (const p of grid(b))
      if (betAt(b, p) === 'basket') {
        expect(Math.abs(p.x - a.x)).toBeLessThanOrEqual(EDGE_BAND);
        expect(Math.abs(p.y - a.y)).toBeLessThanOrEqual(EDGE_BAND);
      }
    // Lock mode: Corner picks the basket from 1's zero-side, dozen-side quadrant, Split picks
    // split 0-1 from the zero-side triangle.
    const quadrant: Point = portrait
      ? { x: one.x + one.w * 0.25, y: one.y + one.h * 0.25 }
      : { x: one.x + one.w * 0.25, y: one.y + one.h * 0.75 };
    expect(betNearest(b, quadrant, 'corner')).toBe('basket');
    const triangle: Point = portrait
      ? { x: one.x + one.w / 2, y: one.y + 4 }
      : { x: one.x + 4, y: one.y + one.h / 2 };
    expect(betNearest(b, triangle, 'split')).toBe('split:0-1');
  });
});

describe('zero rows', () => {
  it('splits and trios along the zero row (european, portrait)', () => {
    const b = buildBoard('european', 'portrait');
    expect(betAt(b, { x: 150, y: 40 })).toBe('split:0-1');
    expect(betAt(b, { x: 234, y: 40 })).toBe('split:0-2');
    expect(betAt(b, { x: 318, y: 54 })).toBe('split:0-3');
    expect(betAt(b, { x: 192, y: 48 })).toBe('trio:0-1-2');
    expect(betAt(b, { x: 276, y: 44 })).toBe('trio:0-2-3');
    expect(betNearest(b, { x: 300, y: 10 }, 'split')).toBe('split:0-3');
    expect(betNearest(b, { x: 250, y: 10 }, 'corner')).toBe('trio:0-2-3');
  });
  it('american zero row', () => {
    const b = buildBoard('american', 'portrait');
    expect(betAt(b, { x: 234, y: 24 })).toBe('split:0-00');
    expect(betAt(b, { x: 234, y: 46 })).toBe('trio:0-00-2');
    expect(betAt(b, { x: 192, y: 46 })).toBe('trio:0-1-2');
    expect(betAt(b, { x: 276, y: 46 })).toBe('trio:00-2-3');
  });
  it('triple zero: the 0-00-000 trio sits in the margin, the 000 corners fall back to straights', () => {
    const b = buildBoard('triple-zero', 'portrait');
    expect(betAt(b, { x: 234, y: -6 })).toBe('trio:0-00-000');
    expect(betAt(b, { x: 191, y: 44 })).toBe('straight:0');
    expect(betAt(b, { x: 192, y: 20 })).toBe('split:0-000');
    const l = buildBoard('triple-zero', 'landscape');
    expect(betAt(l, { x: -6, y: 84 })).toBe('trio:0-00-000');
  });
});

describe('toBoard', () => {
  it('honours the viewBox offset', () => {
    const view = { x: -12, y: 0, w: 712, h: 280 };
    const rect = { left: 10, top: 20, width: 356, height: 140 };
    expect(toBoard(rect, view, 10, 20)).toEqual({ x: -12, y: 0 });
    expect(toBoard(rect, view, 366, 160)).toEqual({ x: 700, y: 280 });
    expect(toBoard(rect, view, 188, 90)).toEqual({ x: 344, y: 140 });
    const v2 = { x: 0, y: -12, w: 374, h: 684 };
    expect(toBoard({ left: 0, top: 0, width: 187, height: 342 }, v2, 0, 0)).toEqual({
      x: 0,
      y: -12,
    });
  });
  it('round-trips through the board for the real views', () => {
    for (const o of ORIENTATIONS) {
      const b = buildBoard('european', o);
      const rect = { left: 16, top: 100, width: 328, height: (328 * b.view.h) / b.view.w };
      const pt = toBoard(rect, b.view, rect.left, rect.top);
      expect(pt).toEqual({ x: b.view.x, y: b.view.y });
    }
  });
});

describe('zoneSizes', () => {
  // A 360 px phone leaves a 328 px board (16 px gutters).
  it('pins the portrait zone sizes at a 328 px board (360 px phone)', () => {
    const z = zoneSizes(buildBoard('european', 'portrait'), 328);
    const r = (n: number): number => Math.round(n * 10) / 10;
    expect([r(z.auto.straight.w), r(z.auto.straight.h)]).toEqual([56.1, 24.6]);
    expect([r(z.auto.splitOnVerticalLine.w), r(z.auto.splitOnVerticalLine.h)]).toEqual([
      17.5, 24.6,
    ]);
    expect([r(z.auto.corner.w), r(z.auto.corner.h)]).toEqual([17.5, 17.5]);
    expect(z.auto.straight.h).toBeGreaterThanOrEqual(24);
    expect([r(z.lock.splitTriangleBase.w), r(z.lock.splitTriangleBase.h)]).toEqual([73.7, 21]);
    expect([r(z.lock.cornerQuadrant.w), r(z.lock.cornerQuadrant.h)]).toEqual([36.8, 21]);
    expect(z.auto.street.w).toBeCloseTo(24 * (328 / 374), 5);
  });
  it('landscape straights stay at least 24 px at 844x390', () => {
    const b = buildBoard('european', 'landscape');
    const z = zoneSizes(b, 700);
    expect(z.auto.straight.w).toBeGreaterThanOrEqual(24);
    expect(z.auto.straight.h).toBeGreaterThanOrEqual(24);
  });
});
