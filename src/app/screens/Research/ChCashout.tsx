// Chapter "cashout": the chance of ending ahead against the cash-out target for
// c9 with the (1 - q)^W prediction, the worst 5 % with and without the stops, and Martingale's
// 8 levels against the 7-loss trailing stop. Every number comes from data.json.
import { Bars, LineBand, Stat, type BarRow } from '@core/ui';
import type { Chapter } from './content';
import { row } from './data';
import { money, pct1 } from './kit';
import './chapters-7-9.css';

const TARGETS = [5, 10, 20, 50, 100] as const;
const C9 = (id: string): string => `e7-c9:e7-c9-${id}`;

export interface TargetPoint {
  w: number;
  measured: number;
  predicted: number | null;
}

/** Measured chance of ending ahead per target, and (1 - q)^W with q from the spec meta. */
export function targetPoints(): TargetPoint[] {
  const q = row(C9('W20')).meta?.q;
  return TARGETS.map((w) => ({
    w,
    measured: row(C9(`W${w}`)).pWin,
    predicted: typeof q === 'number' ? (1 - q) ** w : null,
  }));
}

export function ChCashout(_props: { chapter: Chapter }) {
  const pts = targetPoints();
  const hasPrediction = pts.every((p) => p.predicted !== null);
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const gap = hasPrediction
    ? Math.max(...pts.map((p) => Math.abs(p.measured - p.predicted!))) * 100
    : 0;
  const summary =
    `The chance of ending ahead falls from ${pct1(first.measured)} at a ${first.w}-win target to ` +
    `${pct1(last.measured)} at ${last.w} wins` +
    (hasPrediction
      ? `; the (1 − q)^W prediction is within ${gap.toFixed(1)} points of every target.`
      : '.');

  const bars: BarRow[] = [
    { id: 'nostop', label: 'No cash-out', value: row(C9('nostop')).cvar5 },
    { id: 'w20', label: 'Cash out at 20 wins', value: row(C9('W20')).cvar5 },
    { id: 'sl', label: '20 wins + stop-loss', value: row(C9('W20-SLhalf')).cvar5 },
  ];

  const m8 = row('e7-mart:e7m-stop-W20');
  const m7 = row('e7b-mart-L7stop:e7b-L7stop-W20');

  return (
    <div class="research-cashout">
      <LineBand
        title="Chance of ending ahead by cash-out target (c9)"
        summary={summary}
        x={pts.map((_, i) => i)}
        xKind="categorical"
        xLabels={pts.map((p) => String(p.w))}
        xFmt={(x) => String(pts[Math.round(x)]?.w ?? '')}
        xAxisLabel="Cash-out target (cycle wins)"
        yFmt={pct1}
        yDomain={[0, 1]}
        refs={[{ y: 0.5, label: 'Half of sessions' }]}
        series={[
          { id: 'measured', label: 'Measured', y: pts.map((p) => p.measured) },
          ...(hasPrediction
            ? [{ id: 'predicted', label: 'Predicted (1 − q)^W', y: pts.map((p) => p.predicted!) }]
            : []),
        ]}
      />
      <Bars
        title="Worst 5 % of sessions, c9 with and without the stops"
        rows={bars}
        valueLabel="Worst 5 %"
        signed
      />
      <div class="research-versus research-cashout-versus">
        <div>
          <h3>Martingale, 8 levels</h3>
          <div class="research-versus-stats">
            <Stat label="Chance of ending ahead" value={pct1(m8.pWin)} />
            <Stat label="Worst 5 % of sessions" value={money(m8.cvar5)} />
          </div>
        </div>
        <div>
          <h3>7 levels + stop</h3>
          <div class="research-versus-stats">
            <Stat label="Chance of ending ahead" value={pct1(m7.pWin)} />
            <Stat label="Worst 5 % of sessions" value={money(m7.cvar5)} />
          </div>
        </div>
      </div>
    </div>
  );
}
