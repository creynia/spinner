// The List tab (layouts.md §4.5): one row per spot in funding order. It is also the
// screen-reader-first editor: the whole layout can be built here without the board.
import { useEffect, useRef, useState } from 'preact/hooks';
import { MAX_CHIPS_PER_SPOT, MAX_LAYOUT_SPOTS } from '../../contracts/layout';
import { Sheet } from '../kit';
import { betLabel, money, plural } from './adjust';
import type { SpotListProps } from './types';

export function SpotList<R>(props: SpotListProps<R>) {
  const { rules, catalog, spots, BetPicker, chipValue, check, maxSpots = MAX_LAYOUT_SPOTS } = props;
  const step = (b: string) => props.step(b);
  const onAdjust = (b: string, d: number) => props.onAdjust(b, d);
  const onRemove = (b: string) => props.onRemove(b);
  const onMove = (b: string, d: -1 | 1) => props.onMove(b, d);
  const [adding, setAdding] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // Where focus goes once the list has re-rendered after a move or a removal.
  const pending = useRef<
    { kind: 'move'; bet: string; dir: -1 | 1 } | { kind: 'gone'; index: number } | null
  >(null);
  useEffect(() => {
    const p = pending.current;
    pending.current = null;
    const el = root.current;
    if (!p || !el) return;
    const rows = [...el.querySelectorAll<HTMLElement>('.spot-row')];
    const pick = (row: HTMLElement | undefined, acts: string[]) => {
      for (const a of acts) {
        const b = row?.querySelector<HTMLButtonElement>(`[data-act="${a}"]`);
        if (b && !b.disabled) return b;
      }
      return null;
    };
    let target: HTMLElement | null;
    if (p.kind === 'move') {
      const row = rows.find((r) => r.dataset.bet === p.bet);
      target = pick(row, p.dir < 0 ? ['up', 'down'] : ['down', 'up']) ?? pick(row, ['remove']);
    } else {
      const row = rows[Math.min(p.index, rows.length - 1)];
      target = pick(row, ['remove']) ?? el.querySelector<HTMLElement>('[data-act="add"]');
    }
    target?.focus();
  }, [spots]);
  const full = spots.length >= maxSpots;
  return (
    <div class="spot-list" ref={root}>
      {spots.length === 0 ? (
        <p class="hint">No chips yet. Tap the table, or add a bet below.</p>
      ) : (
        <ol class="spot-rows" aria-label="Spots, in the order they are funded">
          {spots.map((s, i) => {
            const name = betLabel(catalog, s.bet);
            const st = step(s.bet);
            const problem = check?.perSpot.find((p) => p.bet === s.bet);
            const bad = problem && problem.status !== 'ok';
            return (
              <li class={`spot-row${bad ? ' is-flagged' : ''}`} data-bet={s.bet}>
                <div class="spot-main">
                  <span class="spot-name">{name}</span>
                  <span class="spot-count">
                    {plural(s.chips, 'chip')}
                    {chipValue !== null ? `, ${money(s.chips * chipValue)}` : ''}
                  </span>
                </div>
                {bad ? (
                  <p class="spot-problem">
                    <span aria-hidden="true">! </span>
                    {problem.status === 'rejected'
                      ? `Dropped: ${problem.reason ?? problem.code}`
                      : `${money(problem.asked)} becomes ${money(problem.placed)}: ${problem.reason ?? problem.code}`}
                  </p>
                ) : null}
                <div class="spot-actions">
                  <button
                    type="button"
                    class="le-btn"
                    aria-label={`Remove ${plural(st, 'chip')} from ${name}`}
                    title={`Remove ${plural(st, 'chip')}`}
                    onClick={() => {
                      if (s.chips - st <= 0) pending.current = { kind: 'gone', index: i };
                      onAdjust(s.bet, -st);
                    }}
                  >
                    <span aria-hidden="true">−</span>
                  </button>
                  <button
                    type="button"
                    class="le-btn"
                    aria-label={`Add ${plural(st, 'chip')} to ${name}`}
                    title={`Add ${plural(st, 'chip')}`}
                    disabled={s.chips + st > MAX_CHIPS_PER_SPOT}
                    onClick={() => onAdjust(s.bet, st)}
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                  <button
                    type="button"
                    class="le-btn"
                    aria-label={`Move ${name} up`}
                    title="Move up"
                    disabled={i === 0}
                    data-act="up"
                    onClick={() => {
                      pending.current = { kind: 'move', bet: s.bet, dir: -1 };
                      onMove(s.bet, -1);
                    }}
                  >
                    <span aria-hidden="true">↑</span>
                  </button>
                  <button
                    type="button"
                    class="le-btn"
                    aria-label={`Move ${name} down`}
                    title="Move down"
                    disabled={i === spots.length - 1}
                    data-act="down"
                    onClick={() => {
                      pending.current = { kind: 'move', bet: s.bet, dir: 1 };
                      onMove(s.bet, 1);
                    }}
                  >
                    <span aria-hidden="true">↓</span>
                  </button>
                  <button
                    type="button"
                    class="le-btn"
                    aria-label={`Remove ${name}`}
                    title="Remove bet"
                    data-act="remove"
                    onClick={() => {
                      pending.current = { kind: 'gone', index: i };
                      onRemove(s.bet);
                    }}
                  >
                    <span aria-hidden="true">✕</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <button
        type="button"
        class="le-btn le-btn-wide"
        disabled={full}
        data-act="add"
        onClick={() => setAdding(true)}
      >
        Add a bet
      </button>
      {full ? <p class="hint">A layout holds at most {maxSpots} spots.</p> : null}
      <Sheet open={adding} title="Add a bet" onClose={() => setAdding(false)}>
        <BetPicker
          rules={rules}
          onPick={(bet) => {
            setAdding(false);
            onAdjust(bet, step(bet));
          }}
        />
      </Sheet>
    </div>
  );
}
