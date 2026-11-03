// The last pocket, big and in its colour, the spin's result and the recent-numbers strip.
import { formatMoney } from '@core/money';
import type { SpinRecord } from '@core/play';

const RECENT = 20;

export function pocketOf(r: SpinRecord): { label: string; color: string } {
  const p = r.summary['pocket'];
  const c = r.summary['color'];
  return {
    label: typeof p === 'string' || typeof p === 'number' ? String(p) : '?',
    color: c === 'red' || c === 'black' || c === 'green' ? c : 'green',
  };
}

/** "Won $35", "Lost $25", "Push", "No bets". */
export function resultText(r: SpinRecord): string {
  if (r.wagered === 0 && r.net === 0 && r.resolutions.length === 0) return 'No bets';
  if (r.net > 0) return `Won ${formatMoney(r.net)}`;
  if (r.net < 0) return `Lost ${formatMoney(-r.net)}`;
  return 'Push';
}

export function ResultPanel({ log }: { log: readonly SpinRecord[] }) {
  const last = log[log.length - 1];
  const recent = log.slice(-RECENT).reverse();
  if (!last) {
    return (
      <section class="play-result play-result--empty" aria-label="Last spin">
        <div class="play-pocket play-pocket--none" aria-hidden="true">
          –
        </div>
        <p class="muted">Place chips on the table, then spin.</p>
      </section>
    );
  }
  const p = pocketOf(last);
  const tone = last.net > 0 ? 'good' : last.net < 0 ? 'bad' : 'neutral';
  return (
    <section class="play-result" aria-label="Last spin">
      <div
        key={last.n}
        class={`play-pocket play-pocket--${p.color}`}
        role="img"
        aria-label={`${p.label} ${p.color}`}
      >
        <span class="play-pocket-n">{p.label}</span>
        <span class="play-pocket-c">{p.color}</span>
      </div>
      <div class="play-result-text">
        <div class={`play-result-net play-tone-${tone}`}>{resultText(last)}</div>
        <div class="muted">
          Spin {last.n}
          {last.wagered > 0 ? ` · staked ${formatMoney(last.wagered)}` : ''}
        </div>
      </div>
      <ol class="play-recent" aria-label="Recent numbers, newest first">
        {recent.map((r) => {
          const q = pocketOf(r);
          return (
            <li
              class={`play-dot play-dot--${q.color}`}
              title={`Spin ${r.n}: ${q.label} ${q.color}`}
            >
              <span aria-hidden="true">{q.label}</span>
              <span class="visually-hidden">
                {q.label} {q.color}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
