// Chapter 3, Levels, not luck: how long the typical session stays ahead against the number of levels
// in a doubling ladder (E3 L5 to L10), next to the prediction n_half = ln 2 / (q p), plus the same
// 8 levels with a $10,000 bankroll as two stats. Measured values: `medianAheadUntil` (null = never
// ahead, drawn as 0; the session length = still ahead at the end). The prediction comes from
// `ladder()` with the experiment's own stake: base = bankroll / (2^L - 1) cents, doubling on red.
import { LineBand, Stat } from '@core/ui';
import { formatMoney } from '@core';
import './chapters-0-3.css';
import type { Chapter } from './content';
import { row, type RowStats } from './data';
import { ladder } from './ladderMath';
import { money, spins } from './kit';

const LEVELS = [5, 6, 7, 8, 9, 10] as const;
const RED_COVERS = 18;
const BASE_BANKROLL = 'observations:martingale-red';
const BIG_BANKROLL = 'observations:martingale-red-br10k';

/** Spins until half the sessions have lost the ladder, for a red doubling ladder of `L` levels. */
export function predictedHalfLife(r: RowStats, L: number): number {
  const base = r.bankroll / (2 ** L - 1);
  return ladder({
    c: RED_COVERS,
    g: 2,
    base,
    unit: base,
    betMax: r.bankroll,
    maxLevels: L,
  }).nHalf;
}

/** "Spin 290", "Still ahead at spin 500" or "Never ahead". */
function aheadText(r: RowStats): string {
  if (r.medianAheadUntil === null) return 'Never ahead';
  if (r.medianAheadUntil >= r.maxRounds) return `Still ahead at spin ${spins(r.maxRounds)}`;
  return `Spin ${spins(r.medianAheadUntil)}`;
}

export function ChLevels(_props: { chapter: Chapter }) {
  const rows = LEVELS.map((L) => row(`e3a-levels:e3a-L${L}`));
  const end = rows[0]!.maxRounds;
  const measured = rows.map((r) => r.medianAheadUntil ?? 0);
  const predicted = rows.map((r, i) => predictedHalfLife(r, LEVELS[i]!));
  const ceiling = Math.ceil((Math.max(...predicted, end) * 1.05) / 200) * 200;
  const small = row(BASE_BANKROLL);
  const big = row(BIG_BANKROLL);
  const firstL = LEVELS[0];
  const lastL = LEVELS[LEVELS.length - 1];
  const yFmt = (v: number): string =>
    v === end ? `${spins(end)}+ spins` : `${spins(Math.round(v))} spins`;
  const summary =
    `With ${firstL} levels the typical session stays ahead until spin ${spins(measured[0]!)}, ` +
    `with ${lastL} levels ${measured[measured.length - 1]! >= end ? `to the end of the session (spin ${spins(end)})` : `until spin ${spins(measured[measured.length - 1]!)}`}; ` +
    `the prediction runs from ${spins(Math.round(predicted[0]!))} to ${spins(Math.round(predicted[predicted.length - 1]!))} spins. ` +
    `The same 8 levels with a ${formatMoney(big.bankroll)} bankroll stay ahead until spin ${spins(big.medianAheadUntil ?? 0)}, ` +
    `against spin ${spins(small.medianAheadUntil ?? 0)} with ${formatMoney(small.bankroll)}.`;

  return (
    <>
      <LineBand
        title="How long the typical session stays ahead, by levels"
        summary={summary}
        x={LEVELS.map((_, i) => i)}
        xKind="categorical"
        xLabels={LEVELS.map(String)}
        xFmt={(v) => String(LEVELS[Math.round(v)] ?? '')}
        xAxisLabel="Levels in the ladder"
        yFmt={yFmt}
        yAxisFmt={(v) => spins(v)}
        yDomain={[0, ceiling]}
        series={[
          { id: 'measured', label: 'Typical session ahead until (measured)', y: measured },
          { id: 'predicted', label: 'Predicted half-life of the ladder', y: predicted },
        ]}
        refs={[{ y: end, label: `Session ends (${spins(end)} spins)`, dash: '4 4' }]}
      />
      <div class="research-levels-stats">
        <Stat
          label={`Ahead until, ${formatMoney(small.bankroll)} bankroll`}
          value={aheadText(small)}
          hint={`Worst 5 % of sessions: ${money(small.cvar5)}`}
          tone="neutral"
        />
        <Stat
          label={`Ahead until, ${formatMoney(big.bankroll)} bankroll`}
          value={aheadText(big)}
          hint={`Worst 5 % of sessions: ${money(big.cvar5)}`}
          tone="neutral"
        />
      </div>
    </>
  );
}
