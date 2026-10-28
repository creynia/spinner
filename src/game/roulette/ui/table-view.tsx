// TableView: read-only felt with the layout's chips, pending (imprisoned) bets, the last outcome
// and the highlighted bet (game.md §12.3).
import type { Layout } from '@core/contracts/game';
import type { TableViewProps } from '@core/ui';
import { useMemo } from 'preact/hooks';
import { betDef } from '../bets';
import { pocketLabels } from '../pockets';
import type { RouletteRules } from '../types';
import { Board } from './board';
import { chipsOf } from './chips';
import { OutcomeGlyph, pocketOf } from './glyph';
import { useOrientation } from './hooks';
import { betName, money } from './names';

const NONE: Layout = [];

export function TableView({
  rules,
  layout,
  pending = NONE,
  lastOutcome,
  highlight,
}: TableViewProps<RouletteRules>) {
  const orientation = useOrientation();
  const wheel = rules.wheel;
  const chips = useMemo(() => chipsOf(layout, pending, wheel), [layout, pending, wheel]);
  const covered = useMemo(() => {
    const def = highlight ? betDef(highlight, wheel) : null;
    const labels = pocketLabels(wheel);
    return new Set(def ? def.pockets.map((p) => labels[p]!) : []);
  }, [highlight, wheel]);
  const rows = [
    ...layout.map((e) => ({ ...e, pending: false })),
    ...pending.map((e) => ({ ...e, pending: true })),
  ];
  const last = lastOutcome ? pocketOf(lastOutcome) : null;
  return (
    <section class="rl-ui rl-table" aria-label="Roulette table" data-wheel={wheel}>
      <Board
        wheel={wheel}
        orientation={orientation}
        label={`Roulette table, ${wheel} wheel, ${rows.length} ${rows.length === 1 ? 'bet' : 'bets'}`}
        mode="view"
        covered={covered}
        marked={highlight}
        dolly={last}
        chips={chips}
      />
      <div class="rl-status">
        <span class="rl-status__label">Last outcome</span>
        {lastOutcome ? (
          <OutcomeGlyph outcome={lastOutcome} />
        ) : (
          <span class="rl-muted">none yet</span>
        )}
      </div>
      <ul class="rl-bets" aria-label="Bets on the table">
        {rows.length === 0 && <li class="rl-muted">No bets placed</li>}
        {rows.map((e, i) => (
          <li key={i} data-bet-entry={e.bet} data-pending={e.pending || undefined}>
            <span>{betName(e.bet, wheel)}</span>
            <strong>{money(e.amount)}</strong>
            {e.pending && <span class="rl-tag">prison</span>}
            {!betDef(e.bet.replace(/^prison:/, ''), wheel) && (
              <span class="rl-tag rl-tag--warn">not on this wheel</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
