// The felt as SVG (regions as data, game.md §12): shared by TableView (read-only) and BetPicker.
import type { ComponentChildren } from 'preact';
import { useMemo } from 'preact/hooks';
import {
  CHIP_R,
  buildBoard,
  chipAt,
  hotZone,
  isRotated,
  type Orientation,
  type Rect,
} from './geometry';
import { betName, chipText, colorOfLabel, paysText } from './names';
import { familyOf, fixedBetIds } from '../bets';
import type { WheelKind } from '../types';

export interface Chip {
  key: string;
  /** A table spot: pocket straight id, a line bet id or an outside id. */
  spot: string;
  cents: number;
  /** Carried over and not changeable (an imprisoned bet). */
  pending: boolean;
}

export interface BoardProps {
  wheel: WheelKind;
  orientation: Orientation;
  /** Accessible name of the whole table. */
  label: string;
  mode: 'view' | 'pick';
  /** Pocket labels to highlight. */
  covered?: ReadonlySet<string>;
  /** Bet id whose box is marked (picked value or hovered bet). */
  marked?: string | null;
  dolly?: string | null;
  chips?: readonly Chip[];
  onCell?: (label: string, opener: Element) => void;
  onOutside?: (id: string) => void;
  onZone?: (id: string) => void;
  onHover?: (id: string | null) => void;
}

/** An accessible name must contain the visible text ("2:1" -> "2:1, Column 1"). */
const named = (visible: string, name: string): string =>
  name.toLowerCase().includes(visible.toLowerCase()) ? name : `${visible}, ${name}`;

const activate =
  (fn: () => void) =>
  (e: KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };

const LINE_FAMILIES = new Set(['split', 'street', 'trio', 'corner', 'sixline', 'basket']);
/** Draw order: bigger zones first so the small ones (corners) sit on top. */
const ZONE_RANK: Record<string, number> = {
  street: 0,
  split: 1,
  trio: 2,
  basket: 2,
  corner: 3,
  sixline: 3,
};

function Cell(props: {
  label: string;
  rect: Rect;
  covered: boolean;
  dolly: boolean;
  interactive: boolean;
  wheel: WheelKind;
  onPick?: (opener: Element) => void;
}) {
  const { label, rect, covered, dolly, interactive, wheel } = props;
  const color = colorOfLabel(label);
  const id = `straight:${label}`;
  const body = (
    <>
      <rect
        class={`rl-cell rl-cell--${color}${covered ? ' rl-hl' : ''}`}
        x={rect.x}
        y={rect.y}
        width={rect.w}
        height={rect.h}
      />
      <text
        class="rl-num"
        x={rect.x + rect.w / 2}
        y={rect.y + rect.h / 2}
        text-anchor="middle"
        dominant-baseline="central"
      >
        {label}
      </text>
      {dolly && (
        <g class="rl-dolly" data-pocket-dolly={label}>
          <rect x={rect.x + 2} y={rect.y + 2} width={rect.w - 4} height={rect.h - 4} rx="4" />
          <circle cx={rect.x + rect.w - 9} cy={rect.y + 9} r="5" />
        </g>
      )}
    </>
  );
  if (!interactive) return <g data-pocket={label}>{body}</g>;
  return (
    <g
      data-pocket={label}
      role="button"
      tabindex={0}
      aria-label={`${betName(id, wheel)} (${color}), ${paysText(id, wheel)}`}
      onClick={(e) => props.onPick?.(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onPick?.(e.currentTarget);
        }
      }}
      class="rl-hit"
    >
      {body}
    </g>
  );
}

function ChipView(props: { chip: Chip; board: ReturnType<typeof buildBoard> }) {
  const { chip, board } = props;
  const at = chipAt(board, chip.spot, chip.pending);
  if (!at) return null;
  return (
    <g
      class={`rl-chip${chip.pending ? ' rl-chip--pending' : ''}`}
      transform={`translate(${at.x} ${at.y})`}
      data-spot={chip.spot}
      data-kind={chip.pending ? 'pending' : 'bet'}
      data-cents={chip.cents}
    >
      <circle r={CHIP_R} />
      <circle r={CHIP_R - 3} class="rl-chip__ring" />
      <text y="0.5" text-anchor="middle" dominant-baseline="central">
        {chipText(chip.cents)}
      </text>
      {chip.pending && (
        <g class="rl-badge" transform={`translate(${CHIP_R - 2} ${-CHIP_R + 2})`}>
          <title>prison</title>
          <circle r="5.5" />
          <text text-anchor="middle" dominant-baseline="central">
            P
          </text>
        </g>
      )}
    </g>
  );
}

export function Board(props: BoardProps) {
  const { wheel, orientation, mode } = props;
  const board = useMemo(() => buildBoard(wheel, orientation), [wheel, orientation]);
  const pick = mode === 'pick';
  const zones = useMemo(
    () =>
      fixedBetIds(wheel)
        .filter((id) => LINE_FAMILIES.has(familyOf(id) ?? ''))
        .sort((a, b) => ZONE_RANK[familyOf(a)!]! - ZONE_RANK[familyOf(b)!]!)
        .map((id) => ({ id, rect: hotZone(board, id) }))
        .filter((z): z is { id: string; rect: Rect } => z.rect !== null),
    [wheel, board],
  );
  const covered = props.covered ?? new Set<string>();
  const outsideFill: ComponentChildren = board.outside.map((o) => {
    const cls = `rl-box rl-box--${o.id.replace(':', '-')}${props.marked === o.id ? ' rl-sel' : ''}`;
    const turn = isRotated(board, o.rect);
    const cx = o.rect.x + o.rect.w / 2;
    const cy = o.rect.y + o.rect.h / 2;
    const body = (
      <>
        <rect class={cls} x={o.rect.x} y={o.rect.y} width={o.rect.w} height={o.rect.h} />
        <text
          class="rl-outside-text"
          x={cx}
          y={cy}
          text-anchor="middle"
          dominant-baseline="central"
          transform={turn ? `rotate(-90 ${cx} ${cy})` : undefined}
        >
          {o.text}
        </text>
      </>
    );
    if (!pick)
      return (
        <g key={o.id} data-bet={o.id}>
          {body}
        </g>
      );
    return (
      <g
        key={o.id}
        data-bet={o.id}
        role="button"
        tabindex={0}
        class="rl-hit"
        aria-label={`${named(o.text, betName(o.id, wheel))}, ${paysText(o.id, wheel)}`}
        aria-pressed={props.marked === o.id}
        onClick={() => props.onOutside?.(o.id)}
        onKeyDown={activate(() => props.onOutside?.(o.id))}
      >
        {body}
      </g>
    );
  });
  return (
    <svg
      class={`rl-board rl-board--${orientation}`}
      viewBox={`${board.view.x} ${board.view.y} ${board.view.w} ${board.view.h}`}
      role={pick ? 'group' : 'img'}
      aria-label={props.label}
      data-orientation={orientation}
      data-wheel={wheel}
    >
      <rect
        class="rl-felt"
        x={board.view.x}
        y={board.view.y}
        width={board.view.w}
        height={board.view.h}
        rx="6"
      />
      {[...board.pockets.entries()].map(([label, rect]) => (
        <Cell
          key={label}
          label={label}
          rect={rect}
          covered={covered.has(label)}
          dolly={props.dolly === label}
          interactive={pick}
          wheel={wheel}
          onPick={(el) => props.onCell?.(label, el)}
        />
      ))}
      {outsideFill}
      {/* Hot zones are aria-hidden by design: they duplicate the sheet rows for fine pointers, and
          12-unit targets would fail the target-size rule. Keyboard and touch use the sheet. */}
      {pick &&
        zones.map(({ id, rect }) => (
          <rect
            key={id}
            class="rl-zone"
            data-zone={id}
            x={rect.x}
            y={rect.y}
            width={rect.w}
            height={rect.h}
            aria-hidden="true"
            onClick={() => props.onZone?.(id)}
            onPointerEnter={(e) => e.pointerType === 'mouse' && props.onHover?.(id)}
            onPointerLeave={() => props.onHover?.(null)}
          />
        ))}
      {(props.chips ?? []).map((chip) => (
        <ChipView key={chip.key} chip={chip} board={board} />
      ))}
    </svg>
  );
}
