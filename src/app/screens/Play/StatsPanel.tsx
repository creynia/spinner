// Session statistics, the equity line and the last spins log.
import { formatMoney } from '@core/money';
import { luckOf, type PlaySession } from '@core/play';
import { Sparkline } from '@core/ui';
import { pocketOf } from './ResultPanel';
import { netOf } from './store';

const LOG_ROWS = 50;

const signed = (c: number): string => formatMoney(Math.round(c), { sign: true });
const toneOf = (c: number): string | undefined =>
  c > 0 ? 'play-tone-good' : c < 0 ? 'play-tone-bad' : undefined;

const spinsText = (n: number): string => `${n} losing spin${n === 1 ? '' : 's'}`;

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div class="play-stat">
      <dt>{label}</dt>
      <dd class={tone}>{value}</dd>
    </div>
  );
}

export function StatsPanel({ session }: { session: PlaySession }) {
  const st = session.stats;
  const net = netOf(session);
  const { luck, z } = luckOf(st);
  const streak =
    st.streak > 0
      ? `${st.streak} win${st.streak === 1 ? '' : 's'}`
      : st.streak < 0
        ? `${-st.streak} loss${st.streak === -1 ? '' : 'es'}`
        : '–';
  const run = st.lossRun ?? { amount: 0, spins: 0 };
  const cost = st.lastWinCost ?? null;
  const rows = session.log.slice(-LOG_ROWS).reverse();
  return (
    <div class="play-stats">
      <dl class="play-stat-grid">
        <Row label="Spins" value={st.spins.toLocaleString('en-US')} />
        <Row label="Wagered" value={formatMoney(st.wagered)} />
        <Row label="Net" value={signed(net)} tone={toneOf(net)} />
        <Row label="Expected" value={signed(-st.expectedLoss)} />
        <Row
          label="Luck"
          value={`${signed(luck)}${z === null ? '' : ` (z ${z >= 0 ? '+' : ''}${z.toFixed(2)})`}`}
          tone={toneOf(luck)}
        />
        <Row label="Won / lost / push" value={`${st.wins} / ${st.losses} / ${st.pushes}`} />
        <Row label="Biggest win" value={formatMoney(st.biggestWin)} />
        <Row label="Biggest loss" value={formatMoney(-st.biggestLoss)} />
        <Row label="Peak" value={formatMoney(st.peak)} />
        <Row label="Trough" value={formatMoney(st.trough)} />
        <Row label="Max drawdown" value={formatMoney(st.maxDrawdown)} />
        <Row label="Streak" value={streak} />
        <Row
          label="Since last win"
          value={run.spins > 0 ? `${formatMoney(run.amount)} over ${spinsText(run.spins)}` : '–'}
        />
        <Row
          label="Cost of last win"
          value={
            cost
              ? `${formatMoney(cost.amount)} over ${spinsText(cost.spins)} (won ${formatMoney(cost.win)})`
              : '–'
          }
        />
        <Row
          label="Longest streaks"
          value={`${st.longestWinStreak} won · ${st.longestLossStreak} lost`}
        />
        {session.rng.kind === 'seeded' ? (
          <Row label="Seed" value={String(session.rng.seed)} />
        ) : (
          <Row label="Random" value="crypto" />
        )}
      </dl>
      {session.curve.length > 1 ? (
        <div class="play-curve">
          <Sparkline
            values={session.curve}
            label="Bankroll this session"
            baseline={session.startBankroll}
            width={320}
            height={72}
          />
        </div>
      ) : null}
      <h3 class="play-sub">Last spins</h3>
      {rows.length === 0 ? (
        <p class="muted">No spins yet.</p>
      ) : (
        <table class="play-log">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Pocket</th>
              <th scope="col">Staked</th>
              <th scope="col">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const p = pocketOf(r);
              return (
                <tr>
                  <td>{r.n}</td>
                  <td>
                    <span class={`play-dot play-dot--${p.color}`}>{p.label}</span>
                    <span class="visually-hidden"> {p.color}</span>
                  </td>
                  <td>{formatMoney(r.wagered)}</td>
                  <td class={toneOf(r.net)}>{r.net === 0 ? '$0' : signed(r.net)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
