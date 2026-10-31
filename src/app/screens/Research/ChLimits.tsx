// Chapter "limits": what breaks the ladders. A table of typical session and
// average per strategy under each change (American wheel, 250 and 1,000 spins, $10,000 bankroll),
// two small bars, and a second table for the cash-out versions. Every number comes from data.json.
import { Bars, type BarRow } from '@core/ui';
import type { Chapter } from './content';
import { row } from './data';
import { money, pct1, TableWrap } from './kit';
import './chapters-7-9.css';

export interface LimitStrategy {
  id: string;
  label: string;
  short: string;
}

export const STRATEGIES: readonly LimitStrategy[] = [
  { id: 'flat-red', label: 'Flat $25 on red', short: 'Flat red' },
  { id: 'b3-two-streets-l29', label: 'b3: two streets, stacked', short: 'b3' },
  { id: 'c9-streets-to12-stack', label: 'c9: streets to 12, stacked', short: 'c9' },
  { id: 'a1-streets-w27', label: 'a1: streets, widening', short: 'a1' },
];

export const COLUMNS: readonly { label: string; key: (sid: string) => string }[] = [
  { label: 'European, 500 spins', key: (s) => `e6-full:${s}@20261031` },
  { label: 'American wheel', key: (s) => `e8-american:e8-am-${s}` },
  { label: '250 spins', key: (s) => `e8-length:e8-S250-${s}` },
  { label: '1,000 spins', key: (s) => `e8-length:e8-S1000-${s}` },
  { label: '$10,000 bankroll', key: (s) => `e8-br10k:e8-br10k-${s}` },
];

/** Rows of the cash-out table: [label, row key]. */
export const CASHOUT_ROWS: readonly [string, string][] = [
  ['c9 + cash-out, European, 500 spins', 'e7-c9:e7-c9-W20-SLhalf'],
  ['c9 + cash-out, American wheel', 'x1-c9-cashout-axes:x1-c9-am'],
  ['c9 + cash-out, 250 spins', 'x1-c9-cashout-axes:x1-c9-S250'],
  ['c9 + cash-out, 1,000 spins', 'x1-c9-cashout-axes:x1-c9-S1000'],
  ['c9 + cash-out, American wheel, 1,000 spins', 'x1-c9-cashout-axes:x1-c9-am-S1000'],
  ['a1 + $226 cash-out, full ladder', 'x1-a1-trailing:x1-a1-W20-ctrl'],
  ['a1 without its last level + $226 cash-out', 'x1-a1-trailing:x1-a1-L8-W20'],
  ['a1 without its last level, no cash-out', 'x1-a1-trailing:x1-a1-L8-nostop'],
];

const barRows = (key: (sid: string) => string): BarRow[] =>
  STRATEGIES.map((s) => ({ id: s.id, label: s.short, value: row(key(s.id)).median }));

export function ChLimits(_props: { chapter: Chapter }) {
  return (
    <div class="research-limits">
      <p class="muted research-limits-note">
        Each cell shows the typical session, then the average (grey).
      </p>
      <TableWrap label="Typical session and average by strategy under each change">
        <table class="research-table">
          <thead>
            <tr>
              <th scope="col">Strategy</th>
              {COLUMNS.map((c) => (
                <th scope="col">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STRATEGIES.map((s) => (
              <tr>
                <th scope="row">{s.label}</th>
                {COLUMNS.map((c) => {
                  const r = row(c.key(s.id));
                  return (
                    <td>
                      {money(r.median)} <span class="muted">/ {money(r.mean)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <Bars
        title="Typical session, American wheel"
        rows={barRows(COLUMNS[1]!.key)}
        valueLabel="Typical session"
        signed
      />
      <Bars
        title="Typical session at 1,000 spins"
        rows={barRows(COLUMNS[3]!.key)}
        valueLabel="Typical session"
        signed
      />
      <p class="muted research-limits-note">With a cash-out, the same changes:</p>
      <TableWrap label="Cash-out versions of c9 and a1 under each change">
        <table class="research-table">
          <thead>
            <tr>
              <th scope="col">Strategy</th>
              <th scope="col">Typical session</th>
              <th scope="col">Chance of ending ahead</th>
              <th scope="col">Average</th>
              <th scope="col">Worst 5 %</th>
            </tr>
          </thead>
          <tbody>
            {CASHOUT_ROWS.map(([label, key]) => {
              const r = row(key);
              return (
                <tr>
                  <th scope="row">{label}</th>
                  <td>{money(r.median)}</td>
                  <td>{pct1(r.pWin)}</td>
                  <td class="muted">{money(r.mean)}</td>
                  <td>{money(r.cvar5)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}
