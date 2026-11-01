// Chapter 10, "Play c9 at the table": the c9 cash-out candidate as a player takes it to a real
// table. What to bring, the rules, the level table, board glyphs of the key levels, what a session
// feels like (ledger rows from data.json), one-tap Open in Define, and a pocket card that prints on
// its own. Ladder numbers come from playC9.ts (derived from the candidate document), session numbers
// from data.json; nothing is typed by hand.
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { formatMoney } from '@core';
import { Button, Stat } from '@core/ui';
import { BoardGlyph } from './Board';
import { levelWords } from './ChShapes';
import type { Chapter } from './content';
import { candidate, data, row } from './data';
import { money, pct1, TableWrap } from './kit';
import {
  C9_AMERICAN_ROW,
  C9_CANDIDATE,
  C9_ROW,
  C9_SEED_ROWS,
  DEFAULT_TABLE_ROWS,
  LEVEL_HEAD,
  levelRows,
  PLAY_C9,
  streetsLabel,
  type PlayPlan,
} from './playC9';
import { betsAtLevel } from './survivors';
import { TryIt } from './TryIt';
import './chapters-10.css';

const dollars = (c: number): string => formatMoney(c);

/** The table minimum the research's $25 tables use, for the "does not work there" line (cents). */
const BIG_TABLE_MIN = 2500;

/** Levels drawn as board glyphs: the first four (the shape builds up) and the deepest one played. */
export const glyphLevels = (plan: PlayPlan): number[] => [0, 1, 2, 3, plan.tripLevel];

/** Class on <html> while the pocket card prints: the print rules in chapters-10.css key on it. */
export const PRINT_CLASS = 'research-print-card';

/** Prints the pocket card alone: marks the document, opens the print dialog, unmarks after. */
export function printCard(win: Window = window): void {
  const root = win.document.documentElement;
  root.classList.add(PRINT_CLASS);
  win.addEventListener('afterprint', () => root.classList.remove(PRINT_CLASS), { once: true });
  win.print();
}

const range = (values: number[], fmt: (v: number) => string): string =>
  `${fmt(Math.min(...values))} to ${fmt(Math.max(...values))}`;

function Checklist({ plan }: { plan: PlayPlan }): JSX.Element {
  const main = row(C9_ROW);
  const am = row(C9_AMERICAN_ROW);
  const first = plan.levels[0]!.onTable;
  const scale = BIG_TABLE_MIN / first;
  return (
    <ul class="play-list">
      <li>
        <strong>A single-zero wheel.</strong> On a double-zero wheel it still ends ahead{' '}
        {pct1(am.pWin)} of the time, but the average session falls to {money(am.mean)}.
      </li>
      <li>
        <strong>A table that takes {dollars(first)} on the inside</strong> (the inside minimum
        counts all your inside bets together), {dollars(plan.chip)} chips, and a maximum of at least{' '}
        {dollars(plan.maxBet)} on a street, the biggest bet you will place.
      </li>
      <li>
        <strong>Not a {dollars(BIG_TABLE_MIN)}-minimum table.</strong> It does not work there: the
        ladder starts with {dollars(first)} on one street, scaled up {scale} times it costs{' '}
        {dollars(plan.capLoss * scale)}, and the ladders chapter 8 ran at {dollars(BIG_TABLE_MIN)}{' '}
        minimums ran out in{' '}
        {range(
          DEFAULT_TABLE_ROWS.map((k) => row(k).capRate),
          pct1,
        )}{' '}
        of sessions. Find a {dollars(first)} table or skip it.
      </li>
      <li>
        <strong>A {dollars(main.bankroll)} bankroll.</strong> The whole ladder costs{' '}
        {dollars(plan.capLoss)}; with the loss limit no session loses more than{' '}
        {dollars(plan.stopLoss.most)}, but every number here was simulated from{' '}
        {dollars(main.bankroll)}.
      </li>
      <li>
        <strong>
          A target of {money(plan.target)} and a loss limit of {money(-plan.lossLimit)}
        </strong>
        , and the decision, made before the first spin, to stop at either. Your net is the chips in
        front of you minus what you sat down with.
      </li>
    </ul>
  );
}

function Rules({ plan }: { plan: PlayPlan }): JSX.Element {
  const last = plan.levels.length - 1;
  return (
    <>
      <ol class="play-list play-rules">
        <li>
          <strong>Hit</strong> (the ball lands on one of your streets) → back to level 0.
        </li>
        <li>
          <strong>Miss</strong> → next level.
        </li>
        <li>
          <strong>Up {dollars(plan.target)} or more</strong> → leave.
        </li>
        <li>
          <strong>Down {dollars(plan.lossLimit)} or more</strong>, or level {last} lost → leave.
        </li>
      </ol>
      <p class="research-note">
        You start every run of misses between $0 and {money(plan.target - plan.chip)}, so a miss at
        level {plan.tripLevel} always takes you past the loss limit ({dollars(plan.stopLoss.least)}{' '}
        to {dollars(plan.stopLoss.most)} down) and level {last} never comes up.
      </p>
    </>
  );
}

function Glyphs({ plan }: { plan: PlayPlan }): JSX.Element {
  return (
    <div class="play-glyphs">
      {glyphLevels(plan).map((level) => {
        const bets = betsAtLevel(plan.ladder, level);
        const words = levelWords(plan.ladder, level);
        return (
          <figure key={level} class="play-glyph">
            <BoardGlyph
              bets={bets === 'capped' ? [] : bets}
              capped={bets === 'capped'}
              label={`Level ${level}: ${words}`}
            />
            <figcaption>
              <strong>Level {level}</strong>
              <span class="muted">{words}</span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

function LevelTable({ plan }: { plan: PlayPlan }): JSX.Element {
  const rows = levelRows(plan, { money, dollars });
  const last = plan.levels.length - 1;
  return (
    <TableWrap label="The c9 ladder, level by level">
      <table class="research-table play-levels">
        <caption class="research-caption">
          {dollars(plan.chip)} chips. “Down if it misses” and “A hit nets” count from your last hit.
        </caption>
        <thead>
          <tr>
            {LEVEL_HEAD.map((h) => (
              <th scope="col">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([level, ...cells], k) => (
            <tr key={k} class={k === plan.tripLevel ? 'play-level-trip' : undefined}>
              <th scope="row">{level}</th>
              {cells.map((c, i) => (
                <td>
                  {c}
                  {i === 3 && k === plan.tripLevel ? (
                    <span class="research-range">loss limit: leave</span>
                  ) : null}
                  {i === 3 && k === last ? <span class="research-range">not reached</span> : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function Session({ plan }: { plan: PlayPlan }): JSX.Element {
  const main = row(C9_ROW);
  const seeds = C9_SEED_ROWS.map(row);
  const am = row(C9_AMERICAN_ROW);
  const trip = plan.levels[plan.tripLevel]!;
  return (
    <>
      <div class="play-stats" role="group" aria-label="A c9 session in numbers">
        <Stat label="Typical session" value={money(main.median)} tone="neutral" />
        <Stat
          label="Chance of ending ahead"
          value={pct1(main.pWin)}
          hint={`all of them at the ${money(plan.target)} target`}
          tone="neutral"
        />
        <Stat
          label="Leave at the loss limit"
          value={pct1(1 - main.pWin)}
          hint={`${dollars(plan.stopLoss.least)} to ${dollars(plan.stopLoss.most)} down`}
          tone="neutral"
        />
        <Stat
          label="Spins in a session"
          value={main.roundsMean.toFixed(1)}
          hint="average"
          tone="neutral"
        />
        <Stat label="Average" value={money(main.mean)} tone="neutral" />
        <Stat label="Worst 5 % of sessions" value={money(main.cvar5)} tone="neutral" />
      </div>
      <p>
        Most sessions are a string of small wins: a hit every few spins, each worth{' '}
        {money(plan.minHit)} to {money(Math.max(...plan.levels.map((l) => l.hitNets)))}, until you
        are {money(plan.target)} up. The bad tenth are the ones where the ball misses your streets{' '}
        {plan.tripLevel + 1} times in a row: you watch the stake climb to {dollars(trip.perStreet)}{' '}
        a street and leave {dollars(plan.stopLoss.least)} to {dollars(plan.stopLoss.most)} down.
      </p>
      <p>
        On four seeds{' '}
        {range(
          seeds.map((r) => r.pWin),
          pct1,
        )}{' '}
        of sessions end ahead and the average is{' '}
        {range(
          seeds.map((r) => r.mean),
          money,
        )}
        ; on a double-zero wheel {pct1(am.pWin)} and {money(am.mean)}. The average is negative
        because every dollar you bet costs 2.7 cents, and a session bets {dollars(main.wagerMean)}{' '}
        on average.
      </p>
    </>
  );
}

function PocketCard({ plan }: { plan: PlayPlan }): JSX.Element {
  const main = row(C9_ROW);
  const last = plan.levels.length - 1;
  return (
    <section class="play-card" aria-labelledby="play-card-h">
      <h3 id="play-card-h" class="research-sub">
        c9 pocket card
      </h3>
      <p class="play-card-line">
        Single-zero wheel · {dollars(plan.chip)} chips · {dollars(plan.levels[0]!.onTable)} inside
        minimum · {dollars(main.bankroll)} bankroll
      </p>
      <p class="play-card-line">
        <strong>Hit</strong> → level 0 · <strong>Miss</strong> → next level ·{' '}
        <strong>Up {dollars(plan.target)}</strong> → leave ·{' '}
        <strong>Down {dollars(plan.lossLimit)}</strong> or level {last} lost → leave
      </p>
      <TableWrap label="Pocket card: the c9 ladder">
        <table class="research-table play-card-table">
          <thead>
            <tr>
              <th scope="col">Level</th>
              <th scope="col">Streets</th>
              <th scope="col">Each street</th>
              <th scope="col">If it misses</th>
            </tr>
          </thead>
          <tbody>
            {plan.levels.map((l) => (
              <tr key={l.level}>
                <th scope="row">{l.level}</th>
                <td>{streetsLabel(l)}</td>
                <td>{dollars(l.perStreet)}</td>
                <td>{money(-l.downIfMiss)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <Button class="play-card-print" onClick={() => printCard()}>
        Print this card
      </Button>
    </section>
  );
}

export function ChPlayC9(_props: { chapter: Chapter }): JSX.Element {
  const plan = PLAY_C9;
  // Never leave the print mark behind (a print dialog closed by a route change).
  useEffect(() => () => document.documentElement.classList.remove(PRINT_CLASS), []);
  return (
    <div class="play-c9">
      <h3 class="research-sub">Before you sit down</h3>
      <Checklist plan={plan} />
      <h3 class="research-sub">The rules</h3>
      <Rules plan={plan} />
      <h3 class="research-sub">The ladder, level by level</h3>
      <Glyphs plan={plan} />
      <LevelTable plan={plan} />
      <h3 class="research-sub">What a session feels like</h3>
      <Session plan={plan} />
      <h3 class="research-sub">Take it to the table</h3>
      <TryIt candidates={[candidate(C9_CANDIDATE)]} rows={data.rows} />
      <PocketCard plan={plan} />
    </div>
  );
}
