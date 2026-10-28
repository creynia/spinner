// Exact EV and variance (game.md §6). Sign convention: expected LOSS is positive, in cents;
// `edge` and layout `ev` are negative for a house-edge bet.
import type { BetId, Fraction, Layout } from '@core/contracts/game';
import { add, frac, mul, sub, sum } from '@core/money';
import { betDef, parseBet } from './bets';
import { zeroPockets } from './pockets';
import { netVectorOf } from './netvector';
import type { PlacedBet, RouletteRules, RouletteView } from './types';

const pocketCount = (r: RouletteRules): number =>
  r.wheel === 'european' ? 37 : r.wheel === 'american' ? 38 : 39;

/** Builds the placed form of a layout entry (call bets expanded into component chips). */
export function placedOf(
  rules: RouletteRules,
  bet: BetId,
  amount: number,
  piece?: number,
): PlacedBet | null {
  const isPrison = bet.startsWith('prison:');
  const id = isPrison ? bet : parseBet(bet);
  if (id === null) return null;
  const def = betDef(isPrison ? id.slice(7) : id, rules.wheel);
  if (!def) return null;
  if (!def.components || isPrison)
    return { bet: id, amount, chips: [{ spot: id.replace('prison:', ''), amount }] };
  const per = piece ?? amount / def.pieces;
  const chips = new Map<string, number>();
  for (const c of def.components) chips.set(c.spot, (chips.get(c.spot) ?? 0) + c.weight * per);
  return { bet: id, amount, chips: [...chips].map(([spot, a]) => ({ spot, amount: a })) };
}

/** Exact (sum, sum of squares) of a net vector as BigInt, and the float fast path when safe. */
export function vectorMoments(
  v: Float64Array,
  n: number,
): { loss: number; variance: number; sum: bigint; sumSq: bigint } {
  let s = 0;
  let q = 0;
  for (let p = 0; p < n; p++) {
    s += v[p]!;
    q += v[p]! * v[p]!;
  }
  if (Number.isSafeInteger(q) && Number.isSafeInteger(s)) {
    const num = n * q - s * s;
    if (Number.isSafeInteger(num))
      return { loss: -s / n, variance: num / (n * n), sum: BigInt(s), sumSq: BigInt(q) };
  }
  let bs = 0n;
  let bq = 0n;
  for (let p = 0; p < n; p++) {
    const x = BigInt(v[p]!);
    bs += x;
    bq += x * x;
  }
  const bn = BigInt(n);
  return {
    loss: Number(-bs) / n,
    variance: Number(bn * bq - bs * bs) / (n * n),
    sum: bs,
    sumSq: bq,
  };
}

const scratch = new Float64Array(39);
const cache = new Map<string, { loss: number; variance: number }>();

function layoutKey(r: RouletteRules, v: RouletteView): string {
  let k = `${r.wheel}${r.laPartage ? 'p' : ''}${r.enPrison ? (r.enPrisonSecondZero === 'lose' ? 'l' : 'r') : ''}`;
  for (const b of v.prison) k += `|${b.bet}:${b.amount}`;
  for (const b of v.layout) k += `|${b.bet}:${b.amount}`;
  return k;
}

function momentsOfView(view: RouletteView): { loss: number; variance: number } {
  const key = layoutKey(view.rules, view);
  let m = cache.get(key);
  if (!m) {
    netVectorOf(view.rules, view.prison, view.layout, scratch);
    const { loss, variance } = vectorMoments(scratch, pocketCount(view.rules));
    m = { loss, variance };
    if (cache.size >= 4096) cache.clear();
    cache.set(key, m);
  }
  return m;
}

/** Expected loss (positive) of the layout on the table, cents. Imprisoned bets count. */
export function expectedLossPerRound(view: RouletteView): number {
  return momentsOfView(view).loss;
}

/** Joint variance of the round's net, cents^2. */
export function variancePerRound(view: RouletteView): number {
  return momentsOfView(view).variance;
}

/** Exact mean (negative when losing) and joint variance of a layout's net, brute force over pockets. */
export function layoutMoments(
  layout: Layout,
  rules: RouletteRules,
): { ev: Fraction; variance: Fraction } {
  const n = pocketCount(rules);
  const placed: PlacedBet[] = [];
  for (const e of layout) {
    const p = placedOf(rules, e.bet, e.amount);
    if (p) placed.push(p);
  }
  const prison = placed.filter((b) => b.bet.startsWith('prison:'));
  const fresh = placed.filter((b) => !b.bet.startsWith('prison:'));
  const v = new Float64Array(39);
  netVectorOf(rules, prison, fresh, v);
  const { sum: s, sumSq: q } = vectorMoments(v, n);
  const bn = BigInt(n);
  return { ev: frac(s, bn), variance: frac(bn * q - s * s, bn * bn) };
}

export interface Outcome {
  net: Fraction;
  p: Fraction;
}

/**
 * Lifetime distribution of one unit staked on `bet` (game.md §6): the net over the bet's whole
 * resolution, so an imprisoned bet is followed until it leaves prison. `null` when the wheel does
 * not have the bet. Units are the call bet's total stake.
 */
export function betOutcomes(bet: BetId, rules: RouletteRules): Outcome[] | null {
  const id = parseBet(bet);
  const def = id === null || id.startsWith('prison:') ? null : betDef(id, rules.wheel);
  if (!id || !def) return null;
  const unit = def.pieces * 100;
  const placed = placedOf(rules, id, unit)!;
  const n = pocketCount(rules);
  const out = new Float64Array(39);
  netVectorOf(rules, [], [placed], out);
  const tally = new Map<number, bigint>();
  const zero = zeroPockets(rules.wheel)[0]!;
  const prisoned = rules.enPrison && def.evenMoney;
  for (let p = 0; p < n; p++) {
    if (prisoned && p === zero) continue;
    tally.set(out[p]!, (tally.get(out[p]!) ?? 0n) + 1n);
  }
  const res: Outcome[] = [...tally].map(([net, c]) => ({
    net: frac(net, unit),
    p: frac(c, n),
  }));
  if (prisoned) {
    // The bet sits in prison for the next spin: a win returns the stake (net 0), a loss costs 1.
    // A zero loses it (default: 19/37 loss) or re-imprisons it (then 1/2 and 1/2 in the end).
    const toPrison = frac(1, n);
    const wins = rules.enPrisonSecondZero === 'reimprison' ? frac(1, 2) : frac(18, 37);
    res.push({ net: frac(0), p: mul(toPrison, wins) });
    res.push({ net: frac(-1), p: mul(toPrison, sub(frac(1), wins)) });
  }
  // merge equal nets
  const merged = new Map<string, Outcome>();
  for (const o of res) {
    const k = `${o.net.num}/${o.net.den}`;
    const e = merged.get(k);
    merged.set(k, e ? { net: o.net, p: add(e.p, o.p) } : o);
  }
  return [...merged.values()];
}

const meanOf = (o: readonly Outcome[]): Fraction => sum(o.map((x) => mul(x.net, x.p)));

/** Lifetime mean and variance per unit staked (game.md §6.1-§6.3). */
export function betMoments(
  bet: BetId,
  rules: RouletteRules,
): { mean: Fraction; variance: Fraction } | null {
  const o = betOutcomes(bet, rules);
  if (!o) return null;
  const mean = meanOf(o);
  const ex2 = sum(o.map((x) => mul(mul(x.net, x.net), x.p)));
  return { mean, variance: sub(ex2, mul(mean, mean)) };
}

/**
 * `edge`: lifetime EV per unit staked (negative). `perRound`: EV of the bet's own round at face
 * value (equal to `edge` except en prison, where the cost falls on the following round: a fresh
 * even-money bet is worth 0 in its own round).
 */
export function betEdge(
  bet: BetId,
  rules: RouletteRules,
): { edge: Fraction; perRound: Fraction } | null {
  const o = betOutcomes(bet, rules);
  if (!o) return null;
  const edge = meanOf(o);
  const id = parseBet(bet)!;
  const def = betDef(id, rules.wheel)!;
  if (rules.enPrison && def.evenMoney) {
    const m = layoutMoments([{ bet: id, amount: 100 }], rules);
    return { edge, perRound: mul(m.ev, frac(1, 100)) };
  }
  return { edge, perRound: edge };
}
