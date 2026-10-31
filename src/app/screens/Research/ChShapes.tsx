// Chapter 6: the three survivors (c9 hybrid, b3 stack, a1 widen) as board glyphs at three levels, the
// median path of each on seed 20261031, and the four-seed table.
import type { JSX } from 'preact';
import { LineBand } from '@core/ui';
import { formatMoney } from '@core';
import { BoardGlyph } from './Board';
import type { Chapter } from './content';
import { path, row } from './data';
import type { RowStats } from './data';
import { axisMoney, money, pct1, TableWrap } from './kit';
import { betsAtLevel, capLoss, SURVIVORS, type SurvivorLadder } from './survivors';
import './chapters-4-6.css';

/** The levels (losses in a row) the glyphs show. */
export const GLYPH_LEVELS: readonly number[] = [0, 3, 8];
/** Seeds of the table, in order: the main run, two more full runs and the E8 seed-3 run. */
const SEED_KEYS = (rowId: string): string[] => [
  `e6-full:${rowId}@20261031`,
  `e6-full:${rowId}@1`,
  `e6-full:${rowId}@2`,
  `e8-seed3:${rowId}@3`,
];
const MAIN_SEED = '20261031';

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Words for a level: how many streets, what each costs and what sits on the table. */
export function levelWords(l: SurvivorLadder, level: number): string {
  const bets = betsAtLevel(l, level);
  if (bets === 'capped') return `Ladder ran out after ${level} losses`;
  const each = bets[0]!.amount;
  return `${plural(bets.length, 'street', 'streets')}, ${formatMoney(each)} each · ${formatMoney(each * bets.length)} on the table`;
}

const levelTitle = (level: number): string =>
  level === 0 ? 'First bet' : `After ${plural(level, 'loss', 'losses')} in a row`;

/** The seed-20261031 value, then "4 seeds: min to max" in muted text. */
function Cell({
  rows,
  pick,
  fmt,
}: {
  rows: RowStats[];
  pick: (r: RowStats) => number;
  fmt: (v: number) => string;
}): JSX.Element {
  const values = rows.map(pick);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return (
    <td>
      {fmt(pick(rows[0]!))}
      <span class="research-range">{`${rows.length} seeds: ${fmt(lo)} to ${fmt(hi)}`}</span>
    </td>
  );
}

export function ChShapes(_props: { chapter: Chapter }): JSX.Element {
  const main = SURVIVORS.map((s) => ({ s, stats: SEED_KEYS(s.rowId).map(row) }));
  const paths = SURVIVORS.map((s) => path(`e6-full:${s.rowId}@${MAIN_SEED}`));
  const rounds = paths[0]!.rounds;
  const medians = main.map((m) => `${m.s.id} ${money(m.stats[0]!.median)}`).join(', ');
  const summary =
    `Typical session after ${rounds[rounds.length - 1]} spins on seed ${MAIN_SEED}: ${medians}. ` +
    `Each line is the typical session at that spin, not the average.`;

  return (
    <div class="shapes">
      <section class="shapes-boards" aria-labelledby="shapes-boards-h">
        <h3 id="shapes-boards-h" class="research-sub">
          What is on the table as the losses pile up
        </h3>
        <ul class="board-legend" aria-label="Legend">
          <li>
            <svg width="28" height="12" aria-hidden="true" focusable="false">
              <rect class="board-cell board-cell-on" x="8" y="1" width="12" height="10" />
            </svg>
            <span>Numbers covered</span>
          </li>
          <li>
            <svg width="28" height="12" aria-hidden="true" focusable="false">
              <rect class="board-disc" x="6" y="1" width="16" height="4" />
              <rect class="board-disc" x="6" y="7" width="16" height="4" />
            </svg>
            <span>Chips on a bet: a taller tower is a bigger stake</span>
          </li>
        </ul>
        {SURVIVORS.map((s) => (
          <figure key={s.id} class="shapes-survivor" aria-labelledby={`shapes-${s.id}-h`}>
            <figcaption id={`shapes-${s.id}-h`} class="shapes-name">
              <strong>{s.label}</strong>
              <span class="muted">{`, the whole ladder costs ${formatMoney(capLoss(s))} if it runs out`}</span>
            </figcaption>
            <div class="shapes-row">
              {GLYPH_LEVELS.map((level) => {
                const bets = betsAtLevel(s, level);
                const words = levelWords(s, level);
                return (
                  <figure key={level} class="shapes-glyph">
                    <BoardGlyph
                      bets={bets === 'capped' ? [] : bets}
                      capped={bets === 'capped'}
                      label={`${s.label}, ${levelTitle(level).toLowerCase()}: ${words}`}
                    />
                    <figcaption>
                      <strong>{levelTitle(level)}</strong>
                      <span class="muted">{words}</span>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </figure>
        ))}
      </section>

      <LineBand
        title="Typical session of the three ladders, spin by spin"
        summary={summary}
        x={rounds}
        xKind="linear"
        xFmt={(v) => `spin ${Math.round(v)}`}
        xAxisLabel="Spin"
        yFmt={money}
        yAxisFmt={axisMoney}
        series={SURVIVORS.map((s, i) => ({
          id: s.id,
          label: `${s.label} (typical session)`,
          y: paths[i]!.p50,
        }))}
        refs={[{ y: 0, label: 'Break-even' }]}
      />

      <section aria-labelledby="shapes-seeds-h">
        <h3 id="shapes-seeds-h" class="research-sub">
          The same ladders on four seeds
        </h3>
        <TableWrap label="Typical session, chance of ending ahead, average, worst 5 % and ended broke, by ladder">
          <table class="research-table">
            <caption class="research-caption">
              Seed {MAIN_SEED}; the grey line is the lowest to highest of the four seeds.
            </caption>
            <thead>
              <tr>
                <th scope="col">Ladder</th>
                <th scope="col">Typical session</th>
                <th scope="col">Chance of ending ahead</th>
                <th scope="col">Average</th>
                <th scope="col">Worst 5 % of sessions</th>
                <th scope="col">Lost the ladder</th>
                <th scope="col">Ended broke</th>
              </tr>
            </thead>
            <tbody>
              {main.map(({ s, stats }) => (
                <tr key={s.id}>
                  <th scope="row">{s.label}</th>
                  <Cell rows={stats} pick={(r) => r.median} fmt={money} />
                  <Cell rows={stats} pick={(r) => r.pWin} fmt={pct1} />
                  <Cell rows={stats} pick={(r) => r.mean} fmt={money} />
                  <Cell rows={stats} pick={(r) => r.cvar5} fmt={money} />
                  <Cell rows={stats} pick={(r) => r.capRate} fmt={pct1} />
                  <Cell rows={stats} pick={(r) => r.pBust} fmt={pct1} />
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </section>
    </div>
  );
}
