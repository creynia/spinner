// Command-line front end for the ladder calculator (docs/research/plan.md section 3). The maths
// lives in the app (src/app/screens/Research/ladderMath.ts) and is re-exported here. Launched by
// `ladder.mjs`.
import {
  ladder,
  type LadderInput,
  type LadderResult,
} from '../../src/app/screens/Research/ladderMath';

export * from '../../src/app/screens/Research/ladderMath';

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
