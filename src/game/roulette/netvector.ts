// Settlement (game.md §6.5, §7.3): ONE function decides what an entry earns on a pocket. The spin
// settles with it, `netVector` previews with it, and `ev` takes its moments from it, so preview and
// play cannot disagree. Payouts are integer multiples of the stake; the only division is la
// partage's half refund, which floors in the house's favour (`partageLoss`).
import type { Cents } from '@core/contracts/game';
import { partageLoss } from '@core/money';
import { betDef } from './bets';
import type { PlacedBet, RouletteRules, WheelKind } from './types';

export type SettleKind =
  'win' | 'lose' | 'push' | 'partage' | 'imprison' | 'release' | 'prison-lost' | 'reimprison';

export interface Settlement {
  profit: Cents;
  kind: SettleKind;
}

/** Plain play: every chip wins `amount x pays` when it covers the pocket, else loses its stake. */
function chipsProfit(wheel: WheelKind, bet: PlacedBet, pocket: number): Cents {
  let profit = 0;
  for (const chip of bet.chips) {
    const def = betDef(chip.spot, wheel)!;
    profit += def.pockets.includes(pocket) ? chip.amount * def.pays : -chip.amount;
  }
  return profit;
}

/** What `bet` earns when `pocket` comes up under `rules` (zero rules included). */
export function settle(rules: RouletteRules, bet: PlacedBet, pocket: number): Settlement {
  const wheel = rules.wheel;
  const zero = wheel === 'european' && pocket === 0;
  if (bet.bet.startsWith('prison:')) {
    // An imprisoned even-money bet (game.md §1.2): wins return the stake only.
    const base = betDef(bet.bet.slice(7), wheel)!;
    if (base.pockets.includes(pocket)) return { profit: 0, kind: 'release' };
    if (zero && rules.enPrisonSecondZero === 'reimprison') return { profit: 0, kind: 'reimprison' };
    return { profit: -bet.amount, kind: 'prison-lost' };
  }
  if (zero && (rules.laPartage || rules.enPrison) && betDef(bet.bet, wheel)!.evenMoney) {
    return rules.laPartage
      ? { profit: -partageLoss(bet.amount), kind: 'partage' }
      : { profit: 0, kind: 'imprison' };
  }
  const profit = chipsProfit(wheel, bet, pocket);
  return { profit, kind: profit > 0 ? 'win' : profit < 0 ? 'lose' : 'push' };
}

/**
 * Fills `out[0..N)` with the round's net in cents for each pocket, over the layout on the table
 * (imprisoned bets first, then new bets). Integers stored in a float64 array.
 */
export function netVectorOf(
  rules: RouletteRules,
  prison: readonly PlacedBet[],
  layout: readonly PlacedBet[],
  out: Float64Array,
): void {
  const n = rules.wheel === 'european' ? 37 : rules.wheel === 'american' ? 38 : 39;
  for (let p = 0; p < n; p++) {
    let net = 0;
    for (const b of prison) net += settle(rules, b, p).profit;
    for (const b of layout) net += settle(rules, b, p).profit;
    out[p] = net;
  }
}
