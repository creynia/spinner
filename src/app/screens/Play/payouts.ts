// What each covered number would net if it hit, for the Play board's number notes.
import type { BetId, Cents } from '@core/contracts/game';
import { Xoshiro128ss } from '@core/rng';
import { betDef, familyOf, netVector, pocketLabels, roulette } from '@game/roulette';
import type { RouletteRules } from '@game/roulette';

const BANK = Number.MAX_SAFE_INTEGER / 4;

/** Chips that make a pocket "labelled": anything but the outside bets. */
const isInside = (spot: BetId): boolean => {
  const f = familyOf(spot);
  return f !== null && f !== 'even-money' && f !== 'dozen' && f !== 'column';
};

/**
 * Net result (cents) of the whole layout if each pocket hits, restricted to pockets touched by an
 * inside chip (straights, lines, call-bet components). Outside bets count in the net but never make
 * a pocket appear. Imprisoned (`prison:*`) bets are not placeable and are ignored.
 */
export function payoutsByPocket(
  rules: RouletteRules,
  bets: readonly { bet: BetId; amount: Cents }[],
): Map<string, Cents> {
  const out = new Map<string, Cents>();
  if (bets.length === 0) return out;
  const wheel = rules.wheel;
  let state = roulette.createState({ rules, rng: new Xoshiro128ss([1, 2, 3, 4]), bankroll: BANK });
  const covered = new Set<number>();
  for (const b of bets) {
    const def = betDef(b.bet, wheel);
    if (!def || b.bet.startsWith('prison:')) continue;
    const r = roulette.apply(state, { type: 'place', bet: b.bet, amount: b.amount });
    if (!r.ok) continue;
    state = r.state;
    const spots = def.components ? def.components.map((c) => c.spot) : [b.bet];
    if (spots.some(isInside)) for (const p of def.pockets) covered.add(p);
  }
  if (covered.size === 0) return out;
  const labels = pocketLabels(wheel);
  const vec = new Float64Array(labels.length);
  netVector(state, vec);
  for (const p of covered) out.set(labels[p]!, vec[p]!);
  return out;
}

/** "+$175", "−$20" (true minus), "+$1.2k" from $1,000: short enough for a board cell. */
export function compactNet(cents: Cents): string {
  const c = Math.round(cents);
  const sign = c < 0 ? '−' : c > 0 ? '+' : '';
  const abs = Math.abs(c) / 100;
  if (abs >= 1000) return `${sign}$${Math.floor(abs / 100) / 10}k`;
  return `${sign}$${Number.isInteger(abs) ? abs : abs.toFixed(2)}`;
}
