// Table geometry as data (game.md §12.1): rectangles for every pocket and outside box, anchors for
// chips and hot zones for fine pointers. Pure: no DOM, no Preact.
import { pocketRank } from '../pockets';
import type { WheelKind } from '../types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Point {
  x: number;
  y: number;
}
export type Orientation = 'portrait' | 'landscape';

export interface OutsideBox {
  id: string;
  /** Text printed in the box. */
  text: string;
  rect: Rect;
}

export interface Board {
  orientation: Orientation;
  wheel: WheelKind;
  /** Board size; the felt is drawn in 0..width x 0..height. */
  width: number;
  height: number;
  /** viewBox: the board plus a margin on the zero side for the triple-zero 0-00-000 trio. */
  view: Rect;
  /** Pocket label -> rect. */
  pockets: Map<string, Rect>;
  outside: OutsideBox[];
  /** The line streets and six lines sit on: x (portrait) or y (landscape). */
  edge: number;
  /** Where the number block starts (top-left corner of the first row, zero side). */
  basket: Point;
}

/** Zero cells as [label, from, to) in column units (column 1 is 0..1). */
const ZERO_SPANS: Record<WheelKind, readonly [string, number, number][]> = {
  european: [['0', 0, 3]],
  american: [
    ['0', 0, 1.5],
    ['00', 1.5, 3],
  ],
  'triple-zero': [
    ['0', 0, 1],
    ['000', 1, 2],
    ['00', 2, 3],
  ],
};

const EVEN_ORDER = [
  ['low', '1–18'],
  ['even', 'Even'],
  ['red', 'Red'],
  ['black', 'Black'],
  ['odd', 'Odd'],
  ['high', '19–36'],
] as const;
const DOZEN_TEXT = ['1st 12', '2nd 12', '3rd 12'] as const;

/** Margin on the zero side so a chip centred on the zero row's outer edge is not clipped. */
const ZERO_PAD = 12;

/** Right padding of the portrait viewBox so chips on the outer edge are not clipped. */
export const PORTRAIT = { width: 374, height: 672 } as const;
export const LANDSCAPE = { width: 700, height: 280 } as const;

const num = (n: number): { row: number; col: number } => ({
  row: Math.ceil(n / 3),
  col: ((n - 1) % 3) + 1,
});

const boardCache = new Map<string, Board>();

export function buildBoard(wheel: WheelKind, orientation: Orientation): Board {
  const key = `${wheel}/${orientation}`;
  const hit = boardCache.get(key);
  if (hit) return hit;
  const pockets = new Map<string, Rect>();
  const outside: OutsideBox[] = [];
  let board: Board;
  if (orientation === 'portrait') {
    const X0 = 108;
    const CW = 84;
    const RH = 48;
    for (const [label, a0, a1] of ZERO_SPANS[wheel])
      pockets.set(label, { x: X0 + a0 * CW, y: 0, w: (a1 - a0) * CW, h: RH });
    for (let n = 1; n <= 36; n++) {
      const { row, col } = num(n);
      pockets.set(String(n), { x: X0 + (col - 1) * CW, y: RH + (row - 1) * RH, w: CW, h: RH });
    }
    EVEN_ORDER.forEach(([id, text], i) =>
      outside.push({ id, text, rect: { x: 0, y: RH + i * 96, w: 54, h: 96 } }),
    );
    DOZEN_TEXT.forEach((text, i) =>
      outside.push({ id: `dozen:${i + 1}`, text, rect: { x: 54, y: RH + i * 192, w: 54, h: 192 } }),
    );
    for (let c = 1; c <= 3; c++)
      outside.push({
        id: `column:${c}`,
        text: '2:1',
        rect: { x: X0 + (c - 1) * CW, y: RH + 12 * RH, w: CW, h: RH },
      });
    board = {
      orientation,
      wheel,
      ...PORTRAIT,
      view: { x: 0, y: -ZERO_PAD, w: PORTRAIT.width, h: PORTRAIT.height + ZERO_PAD },
      pockets,
      outside,
      edge: X0 + 3 * CW,
      basket: { x: X0, y: RH },
    };
  } else {
    const X0 = 50;
    const CW = 50;
    const RH = 56;
    for (const [label, a0, a1] of ZERO_SPANS[wheel])
      pockets.set(label, { x: 0, y: (3 - a1) * RH, w: X0, h: (a1 - a0) * RH });
    for (let n = 1; n <= 36; n++) {
      const { row, col } = num(n);
      pockets.set(String(n), { x: X0 + (row - 1) * CW, y: (3 - col) * RH, w: CW, h: RH });
    }
    for (let c = 1; c <= 3; c++)
      outside.push({
        id: `column:${c}`,
        text: '2:1',
        rect: { x: X0 + 12 * CW, y: (3 - c) * RH, w: CW, h: RH },
      });
    DOZEN_TEXT.forEach((text, i) =>
      outside.push({
        id: `dozen:${i + 1}`,
        text,
        rect: { x: X0 + i * 4 * CW, y: 3 * RH, w: 4 * CW, h: RH },
      }),
    );
    EVEN_ORDER.forEach(([id, text], i) =>
      outside.push({ id, text, rect: { x: X0 + i * 2 * CW, y: 4 * RH, w: 2 * CW, h: RH } }),
    );
    board = {
      orientation,
      wheel,
      ...LANDSCAPE,
      view: { x: -ZERO_PAD, y: 0, w: LANDSCAPE.width + ZERO_PAD, h: LANDSCAPE.height },
      pockets,
      outside,
      edge: 3 * RH,
      basket: { x: X0, y: 3 * RH },
    };
  }
  boardCache.set(key, board);
  return board;
}

const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const inflate = (r: Rect, e: number): Rect => ({
  x: r.x - e,
  y: r.y - e,
  w: r.w + 2 * e,
  h: r.h + 2 * e,
});
function intersect(rs: Rect[]): Rect | null {
  let x0 = -Infinity;
  let y0 = -Infinity;
  let x1 = Infinity;
  let y1 = Infinity;
  for (const r of rs) {
    x0 = Math.max(x0, r.x);
    y0 = Math.max(y0, r.y);
    x1 = Math.min(x1, r.x + r.w);
    y1 = Math.min(y1, r.y + r.h);
  }
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
function bbox(rs: Rect[]): Rect {
  const x0 = Math.min(...rs.map((r) => r.x));
  const y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w));
  const y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Pocket labels an inside bet id lists (basket expands per wheel). */
export function idPockets(id: string, wheel: WheelKind): string[] {
  const [head, rest = ''] = id.split(':');
  if (id === 'basket') return basketLabels(wheel);
  if (['straight', 'split', 'street', 'trio', 'corner', 'sixline'].includes(head ?? ''))
    return rest.split('-').sort((a, b) => pocketRank(a) - pocketRank(b));
  return [];
}
function basketLabels(wheel: WheelKind): string[] {
  return wheel === 'european'
    ? ['0', '1', '2', '3']
    : wheel === 'american'
      ? ['0', '00', '1', '2', '3']
      : ['0', '00', '000', '1', '2', '3'];
}

function rectsOf(b: Board, id: string): Rect[] {
  return idPockets(id, b.wheel)
    .map((p) => b.pockets.get(p))
    .filter((r): r is Rect => r !== undefined);
}

const HOT = 12;

/** Where a chip for this spot sits (a bet id of the table: a pocket, a line or an outside box). */
export function anchorOf(b: Board, id: string): Point | null {
  const box = b.outside.find((o) => o.id === id);
  if (box) return center(box.rect);
  const head = id.split(':')[0];
  if (id === 'basket') return b.basket;
  const rs = rectsOf(b, id);
  if (rs.length === 0) return null;
  switch (head) {
    case 'straight':
      return center(rs[0]!);
    case 'split':
    case 'trio':
    case 'corner': {
      const r = intersect(rs.map((q) => inflate(q, 1)));
      if (r) return center(r);
      // The triple-zero trio 0-00-000: three zeros in a row and no number touches all of them, so
      // it sits on the zero row's outer edge (the viewBox is padded there), clear of the 000 cell.
      const c = center(bbox(rs));
      return b.orientation === 'portrait' ? { x: c.x, y: 0 } : { x: 0, y: c.y };
    }
    case 'street':
    case 'sixline': {
      const c = center(bbox(rs));
      return b.orientation === 'portrait' ? { x: b.edge, y: c.y } : { x: c.x, y: b.edge };
    }
    default:
      return null;
  }
}

/** The fine-pointer hot zone of a line bet (12 units wide); null for bets without one. */
export function hotZone(b: Board, id: string): Rect | null {
  const head = id.split(':')[0];
  if (!['split', 'street', 'trio', 'corner', 'sixline', 'basket'].includes(head ?? '')) return null;
  const a = anchorOf(b, id);
  if (!a) return null;
  const square: Rect = { x: a.x - HOT / 2, y: a.y - HOT / 2, w: HOT, h: HOT };
  if (head === 'split') {
    const r = intersect(rectsOf(b, id).map((q) => inflate(q, HOT / 2)));
    if (!r) return null;
    return r.w > r.h
      ? { ...r, x: r.x + HOT, w: Math.max(HOT, r.w - 2 * HOT) }
      : { ...r, y: r.y + HOT, h: Math.max(HOT, r.h - 2 * HOT) };
  }
  if (head === 'street') {
    const bb = bbox(rectsOf(b, id));
    return b.orientation === 'portrait'
      ? { x: a.x - HOT / 2, y: bb.y + HOT / 2, w: HOT, h: bb.h - HOT }
      : { x: bb.x + HOT / 2, y: a.y - HOT / 2, w: bb.w - HOT, h: HOT };
  }
  return square;
}

/** Size in CSS px of the smallest tappable region when the SVG is `cssWidth` wide. */
export function minTapSize(b: Board, cssWidth: number): number {
  const scale = cssWidth / b.view.w;
  const rects = [...b.pockets.values(), ...b.outside.map((o) => o.rect)];
  return Math.min(...rects.map((r) => Math.min(r.w, r.h))) * scale;
}

export const CHIP_R = 11;
/** The pending marker: a disc on the chip's top-left, centre offset and radius. */
export const BADGE = { dx: -9, dy: -9, r: 7 } as const;
const FONT_NUM = 17;
const FONT_OUT = 13;

/**
 * Where a chip sits. Inside spots and lines use their anchor; a straight chip goes to the top-right
 * corner of its cell and an outside chip to a corner of its box, so the number or label stays
 * readable. A pending (imprisoned) chip takes the opposite end of the box so both can show.
 */
export function chipAt(b: Board, spot: string, pending: boolean): Point | null {
  const box = b.outside.find((o) => o.id === spot);
  if (box) {
    const { x, y, w, h } = box.rect;
    const cx = x + w / 2;
    if (isRotated(b, box.rect)) return { x: cx, y: pending ? y + h - 16 : y + 16 };
    if (w < 60) return { x: cx, y: pending ? y + 12 : y + h - 12 };
    return { x: x + w - 14, y: pending ? y + h - 12 : y + 12 };
  }
  if (spot.startsWith('straight:')) {
    const r = b.pockets.get(spot.slice(9));
    if (r) return { x: r.x + r.w - CHIP_R, y: r.y + CHIP_R };
  }
  return anchorOf(b, spot);
}

/** Tall outside boxes of the portrait table print their label rotated. */
export const isRotated = (b: Board, r: Rect): boolean =>
  b.orientation === 'portrait' && r.h > r.w * 1.5;

const glyphs = (t: string): number => [...t].length;
/** Approximate box of a printed label (cap height 0.7 em, 0.58 em per character). */
function textBox(c: Point, text: string, font: number, rotated: boolean): Rect {
  const w = glyphs(text) * font * 0.58;
  const h = font * 0.7;
  return rotated
    ? { x: c.x - h / 2, y: c.y - w / 2, w: h, h: w }
    : { x: c.x - w / 2, y: c.y - h / 2, w, h };
}
/** Approximate box of the text printed in an outside box or number cell, null if none. */
export function labelBox(b: Board, id: string): Rect | null {
  const box = b.outside.find((o) => o.id === id);
  if (box) return textBox(center(box.rect), box.text, FONT_OUT, isRotated(b, box.rect));
  const r = b.pockets.get(id.replace('straight:', ''));
  return r ? textBox(center(r), id.replace('straight:', ''), FONT_NUM, false) : null;
}
