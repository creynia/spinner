// Board glyph (docs/design/research.md §5.4): the roulette table laid out flat (the 0 cell on the
// left, 12 columns of 3 rows) with a tower lane above it. Each bet's chips stack over the columns it
// covers, so the height of a tower shows the stake. App tokens only, so it works in both themes.
import type { JSX } from 'preact';
import './chapters-4-6.css';

// BoardBet lives in survivors.ts (pure, also read by the static-page build); re-exported here.
import type { BoardBet } from './survivors';
export type { BoardBet } from './survivors';

export interface BoardGlyphProps {
  bets: BoardBet[];
  /** accessible name, e.g. "c9 after 3 losses: 4 streets, $3 each, $12 on the table" */
  label: string;
  /** px; default 260. Cell = width / 13. */
  width?: number;
  /** cents per first chip; each extra chip doubles the stake. Default 100. */
  chipUnit?: number;
  /** draws the board at 40 % opacity with the text "Ladder ran out" over it */
  capped?: boolean;
}

/** Drawing units: the glyph scales with `width` through its viewBox. */
const W = 260;
const CELL_W = W / 13;
const CELL_H = 14;
const BOARD_H = CELL_H * 3;
const DISC_H = 5;
const DISC_STEP = 6;
const MAX_CHIPS = 11;
const LANE_H = MAX_CHIPS * DISC_STEP;
const GAP = 4;
const H = LANE_H + GAP + BOARD_H;

/** Chips in a tower: 1 for the unit, one more for each doubling, between 1 and 11. */
export function chipCount(amount: number, chipUnit = 100): number {
  if (!(amount > 0) || !(chipUnit > 0)) return 1;
  const n = 1 + Math.round(Math.log2(amount / chipUnit));
  return Math.min(MAX_CHIPS, Math.max(1, n));
}

/** Board column of a number: 0 for the zero cell, 1 to 12 for 1-3 ... 34-36. */
export const columnOf = (n: number): number => (n === 0 ? 0 : Math.ceil(n / 3));

/** Row of a number inside its column: 0 = top (3k), 1 = middle (3k-1), 2 = bottom (3k-2). */
const rowOf = (n: number): number => 2 - ((n - 1) % 3);

export function BoardGlyph({
  bets,
  label,
  width = W,
  chipUnit = 100,
  capped = false,
}: BoardGlyphProps): JSX.Element {
  const covered = new Set<number>();
  for (const b of bets) for (const n of b.numbers) covered.add(n);
  const top = LANE_H + GAP;
  const cells: JSX.Element[] = [
    <rect
      key={0}
      class={covered.has(0) ? 'board-cell board-cell-on' : 'board-cell'}
      data-n={0}
      x={0}
      y={top}
      width={CELL_W}
      height={BOARD_H}
    />,
  ];
  for (let n = 1; n <= 36; n++) {
    cells.push(
      <rect
        key={n}
        class={covered.has(n) ? 'board-cell board-cell-on' : 'board-cell'}
        data-n={n}
        x={columnOf(n) * CELL_W}
        y={top + rowOf(n) * CELL_H}
        width={CELL_W}
        height={CELL_H}
      />,
    );
  }
  const towers = bets.map((b, i) => {
    const cols = b.numbers.map(columnOf);
    const mid = (Math.min(...cols) + Math.max(...cols)) / 2;
    const chips = chipCount(b.amount, chipUnit);
    const w = CELL_W * 0.8;
    const x = mid * CELL_W + (CELL_W - w) / 2;
    return (
      <g key={i} class="board-tower" data-chips={chips}>
        {Array.from({ length: chips }, (_, k) => (
          <rect
            key={k}
            class="board-disc"
            x={x}
            y={LANE_H - (k + 1) * DISC_STEP + (DISC_STEP - DISC_H)}
            width={w}
            height={DISC_H}
          />
        ))}
      </g>
    );
  });
  return (
    <svg
      class="board-glyph"
      viewBox={`0 0 ${W} ${H}`}
      width={width}
      height={Math.round((width * H) / W)}
      role="img"
      aria-label={label}
    >
      <g opacity={capped ? 0.4 : undefined}>
        {cells}
        {towers}
      </g>
      {capped ? (
        <text
          class="board-capped"
          x={W / 2}
          y={H / 2}
          text-anchor="middle"
          dominant-baseline="central"
        >
          Ladder ran out
        </text>
      ) : null}
    </svg>
  );
}
