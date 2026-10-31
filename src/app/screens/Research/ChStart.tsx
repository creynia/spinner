// Chapter 0, Start here: flat $25 on red beside the c9 ladder with a cash-out, as stat tiles.
// Every number comes from data.json rows; the tiles carry the 95 % interval where one exists.
import { Stat } from '@core/ui';
import './chapters-0-3.css';
import type { Chapter } from './content';
import { row, type RowStats } from './data';
import { money, pct1 } from './kit';

const FLAT = 'observations:flat-red';
const CASHOUT = 'e7-c9:e7-c9-W20-SLhalf';

function Column({ title, r }: { title: string; r: RowStats }) {
  return (
    <div class="research-versus-col">
      <h3>{title}</h3>
      <div class="research-versus-stats">
        <Stat
          label="Typical session"
          value={money(r.median)}
          interval={{ lo: money(r.medianCI[0]), hi: money(r.medianCI[1]) }}
          tone="neutral"
        />
        <Stat label="Chance of ending ahead" value={pct1(r.pWin)} tone="neutral" />
        <Stat
          label="Average"
          value={money(r.mean)}
          interval={{ lo: money(r.meanCI[0]), hi: money(r.meanCI[1]) }}
          tone="neutral"
        />
        <Stat label="Worst 5 % of sessions" value={money(r.cvar5)} tone="neutral" />
        <Stat label="Ended broke" value={pct1(r.pBust)} tone="neutral" />
      </div>
    </div>
  );
}

export function ChStart(_props: { chapter: Chapter }) {
  const flat = row(FLAT);
  const cash = row(CASHOUT);
  const summary =
    `Flat $25 on red: typical session ${money(flat.median)}, ${pct1(flat.pWin)} end ahead, average ${money(flat.mean)}. ` +
    `Streets with a cash-out: typical session ${money(cash.median)}, ${pct1(cash.pWin)} end ahead, average ${money(cash.mean)}, ` +
    `worst 5 % of sessions ${money(cash.cvar5)} against ${money(flat.cvar5)}.`;
  return (
    <>
      <div class="research-versus" role="group" aria-label="Flat red against a cash-out ladder">
        <Column title="Flat $25 on red" r={flat} />
        <Column title="Streets with a cash-out" r={cash} />
      </div>
      <p class="research-note">{summary}</p>
    </>
  );
}
