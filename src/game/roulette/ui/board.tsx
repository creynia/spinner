// The felt as SVG (regions as data, game.md §12): shared by TableView (read-only) and BetPicker.
import type { ComponentChildren } from 'preact';
import { useMemo, useRef } from 'preact/hooks';
import {
  BADGE,
  CHIP_R,
  buildBoard,
  chipAt,
  hotZone,
  isRotated,
  toBoard,
  type Board as GeoBoard,
  type Orientation,
  type Point,
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
  /** Chip count shown on the face instead of money (layout editor and thumbnails). */
  count?: number;
  /** Dashed "ghost" chip: a call bet expanded onto its component spot. */
  ghost?: boolean;
  /** Ringed with a "!": the table check flagged the spot. */
  flagged?: boolean;
  /** Accessible name of the chip (place mode). */
  label?: string;
}

export interface BoardProps {
  wheel: WheelKind;
  orientation: Orientation;
  /** Accessible name of the whole table. */
  label: string;
  mode: 'view' | 'pick' | 'place';
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
  /** Place mode: the bet a point (board units) means, or null. Supplied by the ChipBoard. */
  hit?: (board: GeoBoard, point: Point) => string | null;
  /** Place mode: chips on a bet id, for accessible names. */
  counts?: ReadonlyMap<string, number>;
  /** Place mode: the current tool, for accessible names. */
  tool?: 'add' | 'remove';
  /** Place mode: a pointer tap resolved to a bet. */
  onTap?: (bet: string) => void;
  /** Place mode: remove one step (right-click, Delete on an outside box). */
  onRemove?: (bet: string) => void;
  /** Place mode: a long-press (500 ms) on a pocket. */
  onLongPress?: (label: string, opener: Element) => void;
}

export const LONG_PRESS_MS = 500;
const MOVE_SLOP = 8;

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
  onPick?: (opener: Element, e?: Event) => void;
  /** Place mode: accessible name override. */
  name?: string;
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
      aria-label={props.name ?? `${betName(id, wheel)} (${color}), ${paysText(id, wheel)}`}
      onClick={(e) => props.onPick?.(e.currentTarget, e)}
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

/** Ghost chips sit a little off the spot's centre so a plain chip on it stays visible. */
const GHOST_NUDGE = 6;

function ChipView(props: { chip: Chip; board: ReturnType<typeof buildBoard>; place: boolean }) {
  const { chip, board, place } = props;
  const counted = chip.count !== undefined;
  // Count chips (layout editor, thumbnails) sit on a straight's cell centre so they never read as a
  // split or corner; split, corner and street chips stay on their lines. TableView keeps `chipAt`.
  const cell =
    counted && chip.spot.startsWith('straight:')
      ? board.pockets.get(chip.spot.slice(9))
      : undefined;
  const at = cell
    ? { x: cell.x + cell.w / 2, y: cell.y + cell.h / 2 }
    : chipAt(board, chip.spot, chip.pending);
  if (!at) return null;
  const nudge = chip.ghost ? GHOST_NUDGE : 0;
  const face = counted ? String(chip.count) : chipText(chip.cents);
  const cls = [
    'rl-chip',
    chip.pending && 'rl-chip--pending',
    chip.ghost && 'rl-chip--ghost',
    chip.flagged && 'rl-chip--flag',
    counted && String(chip.count).length > 2 && 'rl-chip--long',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <g
      class={cls}
      transform={`translate(${at.x + nudge} ${at.y + nudge})`}
      data-spot={chip.spot}
      data-kind={chip.pending ? 'pending' : chip.ghost ? 'ghost' : 'bet'}
      data-cents={chip.cents}
      data-count={chip.count}
      role={place && chip.label ? 'img' : undefined}
      aria-label={place ? chip.label : undefined}
      style={place ? 'pointer-events:none' : undefined}
    >
      <circle r={CHIP_R} />
      <circle r={CHIP_R - 3} class="rl-chip__ring" />
      <text y="0.5" text-anchor="middle" dominant-baseline="central">
        {face}
      </text>
      {chip.flagged && (
        <g class="rl-flag" transform={`translate(${-BADGE.dx} ${BADGE.dy})`}>
          <circle r={BADGE.r} />
          <text text-anchor="middle" dominant-baseline="central">
            !
          </text>
        </g>
      )}
      {chip.pending && (
        <g class="rl-badge" transform={`translate(${BADGE.dx} ${BADGE.dy})`}>
          <title>prison</title>
          <circle r={BADGE.r} />
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
  const place = mode === 'place';
  const svgRef = useRef<SVGSVGElement>(null);
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  const swallow = useRef(false);
  const hovered = useRef<string | null>(null);
  const toBetAt = (e: MouseEvent): string | null => {
    const el = svgRef.current;
    if (!el || !props.hit) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return props.hit(board, toBoard(r, board.view, e.clientX, e.clientY));
  };
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    swallow.current = false;
    cancelPress();
    const label = (e.target as Element | null)
      ?.closest?.('[data-pocket]')
      ?.getAttribute('data-pocket');
    if (!label || !props.onLongPress) return;
    const opener = (e.target as Element).closest('[data-pocket]')!;
    const timer = window.setTimeout(() => {
      press.current = null;
      swallow.current = true;
      props.onLongPress?.(label, opener);
    }, LONG_PRESS_MS);
    press.current = { x: e.clientX, y: e.clientY, timer };
  };
  const onPointerMove = (e: PointerEvent) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_SLOP) cancelPress();
    if (e.pointerType === 'mouse' && props.onHover) {
      const bet = toBetAt(e);
      if (bet !== hovered.current) {
        hovered.current = bet;
        props.onHover(bet);
      }
    }
  };
  const onClick = (e: MouseEvent) => {
    if (swallow.current) {
      swallow.current = false;
      return;
    }
    // detail 0: a keyboard or assistive-technology activation, handled by the focused region.
    if (e.detail === 0) return;
    const bet = toBetAt(e);
    if (bet) props.onTap?.(bet);
  };
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (e.button !== 2) return; // a touch long-press also fires contextmenu: ignore it
    const bet = toBetAt(e);
    if (bet) props.onRemove?.(bet);
  };
  const countOf = (id: string): number => props.counts?.get(id) ?? 0;
  const chipsText = (id: string): string => {
    const n = countOf(id);
    return n === 0 ? 'no chips' : `${n} ${n === 1 ? 'chip' : 'chips'}`;
  };
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
    if (!pick && !place)
      return (
        <g key={o.id} data-bet={o.id}>
          {body}
        </g>
      );
    if (place)
      return (
        <g
          key={o.id}
          data-bet={o.id}
          role="button"
          tabindex={0}
          class="rl-hit"
          aria-label={`${named(o.text, betName(o.id, wheel))}, ${chipsText(o.id)}, ${paysText(o.id, wheel)}. ${props.tool === 'remove' ? 'Removes a chip.' : 'Adds a chip.'}`}
          onClick={(e) => e.detail === 0 && props.onOutside?.(o.id)}
          onKeyDown={(e) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
              e.preventDefault();
              props.onRemove?.(o.id);
            } else activate(() => props.onOutside?.(o.id))(e);
          }}
        >
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
      ref={svgRef}
      class={`rl-board rl-board--${orientation}${place ? ' rl-board--place' : ''}`}
      viewBox={`${board.view.x} ${board.view.y} ${board.view.w} ${board.view.h}`}
      style={place ? { aspectRatio: `${board.view.w} / ${board.view.h}` } : undefined}
      role={pick || place ? 'group' : 'img'}
      aria-label={props.label}
      data-orientation={orientation}
      data-wheel={wheel}
      onClick={place ? onClick : undefined}
      onPointerDown={place ? onPointerDown : undefined}
      onPointerMove={place ? onPointerMove : undefined}
      onPointerUp={place ? cancelPress : undefined}
      onPointerCancel={place ? cancelPress : undefined}
      onPointerLeave={
        place
          ? () => {
              cancelPress();
              if (hovered.current !== null) {
                hovered.current = null;
                props.onHover?.(null);
              }
            }
          : undefined
      }
      onContextMenu={place ? onContextMenu : undefined}
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
          interactive={pick || place}
          wheel={wheel}
          name={
            place
              ? `${betName(`straight:${label}`, wheel)} (${colorOfLabel(label)}), ${chipsText(`straight:${label}`)}, ${paysText(`straight:${label}`, wheel)}. Opens the bets on ${label}.`
              : undefined
          }
          onPick={(el, e) => {
            // Place mode: a pointer click is resolved at the board; only keyboard and
            // assistive-technology activations (no event, or detail 0) open the sheet here.
            if (place && e && (e as MouseEvent).detail !== 0) return;
            props.onCell?.(label, el);
          }}
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
        <ChipView key={chip.key} chip={chip} board={board} place={place} />
      ))}
    </svg>
  );
}
