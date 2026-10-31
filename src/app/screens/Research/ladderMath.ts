// Cycle-model calculator for a progression ladder (docs/research/plan.md section 2). Pure maths,
// no imports: a cycle starts at level 0, a win ends it with a profit, a loss climbs one level, and
// the cycle caps (a loss it cannot recover) when the ladder runs out of levels. With coverage c
// numbers out of 37, p = c/37 per spin, L fitting levels, q = (1 - p)^L is the per-cycle cap
// probability and caps arrive at rate q*p per spin. Used by the Research screen and, through
// `scripts/research/ladder.ts`, by the `research:ladder` command.

export interface LadderInput {
  /** Numbers covered per bet (1..35). */
  c: number;
  /** Growth factor between levels; default 36 / (36 - c). */
  g?: number;
  /** Level-0 stake, cents. */
  base: number;
  /** Chip unit, cents: amounts round UP to a multiple of it. */
  unit: number;
  /** Per-bet maximum, cents. */
  betMax: number;
  /** Bankroll, cents (default unlimited). */
  bankroll?: number;
  /** Session spins (default 500). */
  spins?: number;
  /** Cap on the number of levels considered. */
  maxLevels?: number;
  /** Explicit stake per level, cents; replaces the g-based amounts. */
  amounts?: number[];
}

export interface LadderResult {
  c: number;
  g: number;
  amounts: number[];
  /** Levels that fit. */
  L: number;
  p: number;
  q: number;
  /** Sum of amounts, in base stakes. */
  B: number;
  /** Total cents at risk (sum of amounts). */
  totalStake: number;
  /** Spins until half of the sessions have capped. */
  nHalf: number;
  /** p*S/B, expected cycle wins per ladder cost. */
  x: number;
  pNoCap: number;
  pAhead: number;
  /** Net win of a cycle ending at level 0, cents. */
  profitPerCycle: number;
  /** p*S*profitPerCycle (cents) when P(no cap) > 0.5, else "negative". */
  predictedMedian: number | 'negative';
  /** Net win if the cycle ends at each level, cents. */
  levelNet: number[];
  /** First level whose win does not net a profit, or null. */
  firstDeficitLevel: number | null;
}

const MAX_LEVELS = 64;

export function ladder(input: LadderInput): LadderResult {
  const { c, base, unit, betMax } = input;
  if (!(c >= 1 && c < 36)) throw new Error('c must be in [1, 36)');
  if (!(base > 0) || !(unit > 0)) throw new Error('base and unit must be positive');
  const g = input.g ?? 36 / (36 - c);
  const bankroll = input.bankroll ?? Infinity;
  const spins = input.spins ?? 500;
  const limit = Math.min(input.maxLevels ?? MAX_LEVELS, MAX_LEVELS);
  const candidates: number[] = [];
  if (input.amounts) candidates.push(...input.amounts);
  else {
    for (let k = 0; k < limit; k++) {
      candidates.push(Math.ceil((g ** k * base) / unit - 1e-9) * unit);
    }
  }

  const amounts: number[] = [];
  let sum = 0;
  for (const a of candidates.slice(0, limit)) {
    if (a > betMax || sum + a > bankroll) break;
    amounts.push(a);
    sum += a;
  }
  const L = amounts.length;
  const p = c / 37;
  const q = (1 - p) ** L;
  const B = sum / base;
  const odds = (36 - c) / c;
  let paid = 0;
  const levelNet = amounts.map((a) => {
    const net = a * odds - paid;
    paid += a;
    return net;
  });
  const first = levelNet.findIndex((n) => !(n > 1e-9));
  const pNoCap = Math.exp(-q * p * spins);
  const profitPerCycle = levelNet[0] ?? 0;
  return {
    c,
    g,
    amounts,
    L,
    p,
    q,
    B,
    totalStake: sum,
    nHalf: Math.LN2 / (q * p),
    x: (p * spins) / B,
    pNoCap,
    pAhead: pNoCap,
    profitPerCycle,
    predictedMedian: pNoCap > 0.5 ? p * spins * profitPerCycle : 'negative',
    levelNet,
    firstDeficitLevel: first < 0 ? null : first,
  };
}
