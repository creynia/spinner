import type { ComponentType } from 'preact';
import type { OutcomeGlyphProps } from '../game-ui';
import type { TraceWindow } from '../../contracts/strategy-trace';
import { formatMoney } from '../../money';
import { counts, desiredRows, toRoundOutcome, type DesiredRow } from './outcome';

export interface WindowDetailProps {
  w: TraceWindow;
  OutcomeGlyph: ComponentType<OutcomeGlyphProps>;
  betLabel: (id: string) => string;
  ruleLabel?: (id: string) => string | undefined;
  onHighlight: (bet: string | null) => void;
  highlighted: string | null;
}

const money = (c: number) => formatMoney(c);
const signed = (c: number) => (c > 0 ? '+' : '') + formatMoney(c);

function statusText(r: DesiredRow): string {
  switch (r.status.kind) {
    case 'rejected':
      return `Rejected: ${r.status.reason}`;
    case 'deferred':
      return `Deferred: ${r.status.reason}`;
    case 'adjusted':
      return `Adjusted to ${money(r.status.to)}: ${r.status.reason}`;
    default:
      return 'Placed';
  }
}

function detailText(d: Record<string, number | string>): string {
  return Object.entries(d)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
}

/** Everything the interpreter and the harness recorded for one round. */
export function WindowDetail(props: WindowDetailProps) {
  const { w, betLabel, ruleLabel } = props;
  const Glyph = props.OutcomeGlyph;
  const rows = desiredRows(w);
  const c = counts(w);
  const outcome = toRoundOutcome(w);
  const progs = Object.entries(w.prog);
  const obs = Object.entries(w.obs);
  return (
    <div class="tr-detail" data-window={w.w}>
      <div class="tr-head">
        <h3>Round {w.w + 1}</h3>
        <span class="tr-chip tr-stage" data-stage>
          Stage {w.stage}
          {w.stageAfter ? ` → ${w.stageAfter}` : ''}
        </span>
        {w.skip ? <span class="tr-chip">Sat out</span> : null}
        {w.stop ? <span class="tr-chip tr-stop">Stopped: {w.stop}</span> : null}
        {w.bust ? <span class="tr-chip tr-bad">Bust</span> : null}
      </div>
      {w.error ? (
        <p class="tr-bad" role="alert">
          <span aria-hidden="true">⚠ </span>Strategy error {w.error.code}: {w.error.message}
        </p>
      ) : null}

      <section aria-labelledby={`tr-fired-${w.w}`}>
        <h4 id={`tr-fired-${w.w}`}>Rules that fired</h4>
        {w.fired.length === 0 ? (
          <p class="muted">No rules fired.</p>
        ) : (
          <ul class="tr-fired">
            {w.fired.map((id, i) => (
              <li key={`${id}-${i}`} class="tr-rule" data-rule={id}>
                <span class="tr-rule-id">{id}</span>
                {ruleLabel?.(id) ? <span class="muted"> {ruleLabel(id)}</span> : null}
                <ul class="tr-effects">
                  {w.effects
                    .filter((e) => e.rule === id)
                    .map((e, j) => (
                      <li key={j} data-op={e.op}>
                        {e.op} {detailText(e.detail)}
                        {e.note ? <span class="muted"> ({e.note})</span> : null}
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`tr-lay-${w.w}`}>
        <h4 id={`tr-lay-${w.w}`}>Desired layout and what the table accepted</h4>
        <p class="tr-summary" data-reconcile>
          {c.rejected} rejected · {c.deferred} deferred · {c.adjusted} adjusted
          {w.reconcile ? ` · ${w.reconcile.actions} actions` : ''}
        </p>
        {rows.length === 0 ? (
          <p class="muted">Nothing wanted on the table.</p>
        ) : (
          <ul class="tr-bets">
            {rows.map((r, i) => (
              <li key={`${r.bet}-${i}`} data-bet={r.bet} data-status={r.status.kind}>
                <button
                  type="button"
                  class="tr-bet"
                  aria-pressed={props.highlighted === r.bet}
                  onMouseEnter={() => props.onHighlight(r.bet)}
                  onMouseLeave={() => props.onHighlight(null)}
                  onFocus={() => props.onHighlight(r.bet)}
                  onBlur={() => props.onHighlight(null)}
                  onClick={() => props.onHighlight(props.highlighted === r.bet ? null : r.bet)}
                >
                  <span class="tr-bet-name">{betLabel(r.bet)}</span>
                  <span class="tr-bet-amt">{money(r.amount)}</span>
                  <span class={`tr-status tr-${r.status.kind}`}>
                    {r.status.kind === 'rejected' ? <span aria-hidden="true">⛔ </span> : null}
                    {statusText(r)}
                  </span>
                  <span class="muted tr-src">{r.source}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {w.dropped && w.dropped.length > 0 ? (
          <p class="muted">
            Dropped before reconcile:{' '}
            {w.dropped.map((d) => `${betLabel(d.bet)} (${d.reason})`).join(', ')}
          </p>
        ) : null}
        {w.reconcile && w.reconcile.rejected.length > 0 ? (
          <ul class="tr-rejlist" aria-label="Rejected this round">
            {w.reconcile.rejected.map((r, i) => (
              <li key={i} class="tr-bad">
                <span aria-hidden="true">⛔ </span>Rejected {betLabel(r.bet)}: {r.reason}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby={`tr-out-${w.w}`}>
        <h4 id={`tr-out-${w.w}`}>Outcome</h4>
        {outcome && w.outcome ? (
          <>
            <p class="tr-outline">
              <Glyph outcome={outcome} />{' '}
              <strong class={w.outcome.net < 0 ? 'tr-bad' : undefined}>
                Net {signed(w.outcome.net)}
              </strong>{' '}
              · Equity {money(w.equity)}
            </p>
            <ul class="tr-res">
              {w.outcome.resolutions.map((r, i) => (
                <li key={i}>
                  {betLabel(r.bet)}: {r.result} {signed(r.profit)}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p class="muted">No spin this round. Equity {money(w.equity)}.</p>
        )}
      </section>

      {progs.length > 0 ? (
        <section aria-labelledby={`tr-prog-${w.w}`}>
          <h4 id={`tr-prog-${w.w}`}>Progression steps</h4>
          <ul class="tr-progs">
            {progs.map(([name, p]) => (
              <li key={name} data-prog={name}>
                <strong>{name}</strong>: next stake {money(p.amount)}; fed{' '}
                {typeof p.fed === 'string' ? p.fed : JSON.stringify(p.fed)}; state{' '}
                {Object.entries(p.state)
                  .map(([k, v]) => `${k} ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`)
                  .join(', ')}
                {p.events?.length ? ` (${p.events.join(', ')})` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {obs.length > 0 ? (
        <details class="tr-obs">
          <summary>Facts the rules looked at</summary>
          <dl class="facts">
            {obs.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
}
