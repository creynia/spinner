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

/**
 * Secondary line: a win's cost, a long losing run, else the stake. `lossRun` (the session's exact
 * running total) wins over counting back through the log, which is capped at 500 spins.
 */
export function detailText(
  log: readonly SpinRecord[],
  lossRun?: { amount: number; spins: number },
): string {
  const last = log[log.length - 1]!;
  const head = `Spin ${last.n}`;
  const spins = (n: number): string => `${n} spin${n === 1 ? '' : 's'}`;
  if (last.net > 0 && last.cost)
    return `${head} · cost ${formatMoney(last.cost.amount)} over ${spins(last.cost.spins)}`;
  if (last.net < 0 && lossRun) {
    if (lossRun.spins >= 2)
      return `${head} · down ${formatMoney(lossRun.amount)} over ${spins(lossRun.spins)}`;
  } else if (last.net < 0) {
    let amount = 0;
    let n = 0;
    for (let i = log.length - 1; i >= 0 && log[i]!.net <= 0; i--) {
      if (log[i]!.net < 0) {
        amount -= log[i]!.net;
        n += 1;
      }
    }
    if (n >= 2) return `${head} · down ${formatMoney(amount)} over ${spins(n)}`;
  }
  return last.wagered > 0 ? `${head} · staked ${formatMoney(last.wagered)}` : head;
}

export function ResultPanel({
  log,
  lossRun,
}: {
  log: readonly SpinRecord[];
  lossRun?: { amount: number; spins: number };
}) {
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
        <div class="muted">{detailText(log, lossRun)}</div>
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
