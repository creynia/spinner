import type { ComponentType } from 'preact';
import type { OutcomeGlyphProps } from '../game-ui';
import type { TraceWindow } from '../../contracts/strategy-trace';
import { formatMoney } from '../../money';
import { counts, toRoundOutcome } from './outcome';

export interface TraceListProps {
  trace: readonly TraceWindow[];
  round: number;
  OutcomeGlyph: ComponentType<OutcomeGlyphProps>;
  onSelect: (round: number) => void;
  /** Rows rendered each side of the current round (long sessions are windowed). */
  span?: number;
}

/** One row per round around the current one; rejected entries carry an icon and a text label. */
export function TraceList({ trace, round, OutcomeGlyph, onSelect, span = 12 }: TraceListProps) {
  const from = Math.max(0, round - span);
  const to = Math.min(trace.length, round + span + 1);
  const rows = trace.slice(from, to);
  return (
    <div class="tr-list-wrap">
      <p class="muted tr-range" data-range>
        Rounds {trace.length ? from + 1 : 0} to {to} of {trace.length}
      </p>
      <ol class="tr-list" aria-label="Rounds" start={from + 1}>
        {rows.map((w, k) => {
          const i = from + k;
          const c = counts(w);
          const o = toRoundOutcome(w);
          return (
            <li key={w.w} data-round={i} class={i === round ? 'is-current' : undefined}>
              <button
                type="button"
                class="tr-row"
                aria-current={i === round ? 'step' : undefined}
                onClick={() => onSelect(i)}
              >
                <span class="tr-row-n">#{w.w + 1}</span>
                <span class="tr-row-stage">{w.stage}</span>
                <span class="tr-row-glyph">
                  {o ? <OutcomeGlyph outcome={o} /> : <span class="muted">no spin</span>}
                </span>
                <span class={`tr-row-net${w.outcome && w.outcome.net < 0 ? ' tr-bad' : ''}`}>
                  {w.outcome ? (w.outcome.net > 0 ? '+' : '') + formatMoney(w.outcome.net) : ''}
                </span>
                <span class="tr-row-eq muted">{formatMoney(w.equity)}</span>
                <span class="tr-row-tags">
                  {w.fired.length > 0 ? (
                    <span class="tr-tag tr-tag-fired">
                      {w.fired.length} {w.fired.length === 1 ? 'rule' : 'rules'}
                    </span>
                  ) : null}
                  {c.rejected > 0 ? (
                    <span class="tr-tag tr-tag-rejected">
                      <span aria-hidden="true">⛔ </span>
                      {c.rejected} rejected
                    </span>
                  ) : null}
                  {c.deferred > 0 ? <span class="tr-tag">{c.deferred} deferred</span> : null}
                  {c.adjusted > 0 ? <span class="tr-tag">{c.adjusted} adjusted</span> : null}
                  {w.stop ? <span class="tr-tag">stop</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
