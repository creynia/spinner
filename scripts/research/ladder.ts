// Cycle-model calculator for a progression ladder (docs/research/plan.md section 2). Pure maths,
// no imports: a cycle starts at level 0, a win ends it with a profit, a loss climbs one level, and
// the cycle caps (a loss it cannot recover) when the ladder runs out of levels. With coverage c
// numbers out of 37, p = c/37 per spin, L fitting levels, q = (1 - p)^L is the per-cycle cap
// probability and caps arrive at rate q*p per spin. Launched by `ladder.mjs`.

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

const usd = (cents: number): string =>
  `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export function format(r: LadderResult, spins: number): string {
  const f = (n: number, d = 4): string => n.toFixed(d);
  const median = r.predictedMedian === 'negative' ? 'negative' : usd(r.predictedMedian);
  return [
    `c ${r.c}  g ${f(r.g)}  L ${r.L}  amounts ${r.amounts.map(usd).join(' ')}`,
    `p ${f(r.p)}  q ${f(r.q, 5)}  B ${f(r.B, 2)} base stakes (${usd(r.totalStake)})`,
    `n_half ${f(r.nHalf, 1)} spins  x = pS/B ${f(r.x, 3)}  (S ${spins})`,
    `P(no cap by S) = P(ahead) ${f(r.pNoCap)}  predicted median ${median}  profit/cycle ${usd(r.profitPerCycle)}`,
    r.firstDeficitLevel === null
      ? 'deficit check: every level nets a profit'
      : `deficit check: FAILS at level ${r.firstDeficitLevel} (net ${usd(r.levelNet[r.firstDeficitLevel] ?? 0)})`,
  ].join('\n');
}

const FLAGS: Record<
  string,
  'c' | 'g' | 'base' | 'unit' | 'betMax' | 'bankroll' | 'spins' | 'maxLevels'
> = {
  c: 'c',
  g: 'g',
  base: 'base',
  unit: 'unit',
  max: 'betMax',
  bankroll: 'bankroll',
  spins: 'spins',
  levels: 'maxLevels',
};

export function parseArgs(argv: string[]): { input: LadderInput; json: boolean } {
  const num: Partial<
    Record<'c' | 'g' | 'base' | 'unit' | 'betMax' | 'bankroll' | 'spins' | 'maxLevels', number>
  > = {};
  let amounts: number[] | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    const key = a.startsWith('--') ? FLAGS[a.slice(2)] : undefined;
    if (a === '--json') json = true;
    else if (a === '--amounts') amounts = (argv[++i] ?? '').split(',').map(Number);
    else if (key) {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v)) throw new Error(`${a} needs a number`);
      num[key] = v;
    } else throw new Error(`unknown argument ${a}`);
  }
  if (num.c === undefined || num.base === undefined) throw new Error('--c and --base are required');
  const input: LadderInput = {
    ...num,
    c: num.c,
    base: num.base,
    unit: num.unit ?? num.base,
    betMax: num.betMax ?? Infinity,
    ...(amounts ? { amounts } : {}),
  };
  return { input, json };
}

export function main(argv: string[]): void {
  const { input, json } = parseArgs(argv);
  const r = ladder(input);
  console.log(json ? JSON.stringify(r, null, 2) : format(r, input.spins ?? 500));
}
