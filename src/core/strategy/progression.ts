// Progression state machines (strategy.md §7). Pure functions over a Float64Array slot block,
// so the interpreter allocates nothing per round.

export const STRIDE = 12;
export const F_K = 0; // level k (oscar's grind: u)
export const F_CAPS = 1;
export const F_BASE = 2;
export const F_STEP = 3;
export const F_MAX = 4;
export const F_CYCLE = 5; // oscar's cycle (cents); labouchere: dirty flag
export const F_ARMED = 6;
export const F_FED = 7; // 0 none, 1 win, 2 loss, 3 push, 4 unarmed
export const F_EVCAP = 8;
export const F_EVDONE = 9;
/** Region size per labouchere progression: head, tail, then circular-free data (compacted). */
export const LINE_REGION = 2 + 1040;

export const FLAG_CAP = 1;
export const FLAG_DONE = 2;
export const FLAG_STOP_CAP = 4;
export const FLAG_STOP_DONE = 8;

export const MAX_AMOUNT = 2 ** 31 - 1;

export type Kind =
  | 'flat'
  | 'martingale'
  | 'grand-martingale'
  | 'fibonacci'
  | 'dalembert'
  | 'paroli'
  | '1-3-2-6'
  | 'oscars-grind'
  | 'labouchere'
  | 'sequence';
export type SeqStep = 'advance' | 'back' | 'reset' | 'stay';
export type OnCap = 'reset' | 'stay' | 'stop';

/** Compiled, immutable parameters of one progression. */
export interface ProgParams {
  kind: Kind;
  /** Number of levels L (level kinds), max units (oscar), max length (labouchere). */
  limit: number;
  mult: number;
  back: number;
  onCap: OnCap;
  onEmpty: 'reset' | 'stop';
  line0: readonly number[];
  /** Offset of the labouchere region in the shared lines array. */
  lineOff: number;
  /** `sequence`: amounts evaluated when read, and the steps. */
  seq: readonly (() => number)[];
  onWin: SeqStep;
  onLoss: SeqStep;
  onPush: SeqStep;
}

const FIB: number[] = [1, 1];
for (let i = 2; i < 64; i++) FIB.push((FIB[i - 1] as number) + (FIB[i - 2] as number));
const ONE_THREE_TWO_SIX = [1, 3, 2, 6];

export function isLevelKind(kind: Kind): boolean {
  return kind !== 'flat' && kind !== 'oscars-grind' && kind !== 'labouchere';
}

function levelCount(p: ProgParams): number {
  switch (p.kind) {
    case '1-3-2-6':
      return 4;
    case 'sequence':
      return p.seq.length;
    default:
      return p.limit;
  }
}

function levelAmount(p: ProgParams, f: Float64Array, o: number, k: number): number {
  const base = f[o + F_BASE] as number;
  switch (p.kind) {
    case 'martingale':
    case 'paroli':
      return p.mult ** k * base;
    case 'grand-martingale':
      return (2 ** (k + 1) - 1) * base;
    case 'fibonacci':
      return (FIB[k] as number) * base;
    case 'dalembert':
      return base + k * (f[o + F_STEP] as number);
    case '1-3-2-6':
      return (ONE_THREE_TWO_SIX[k] as number) * base;
    case 'sequence':
      return (p.seq[k] as () => number)();
    default:
      return base;
  }
}

/** Current amount in cents (NaN only for a `sequence` whose amount expression is null). */
export function amountOf(p: ProgParams, f: Float64Array, o: number, lines: Float64Array): number {
  const base = f[o + F_BASE] as number;
  switch (p.kind) {
    case 'flat':
      return base;
    case 'oscars-grind':
      return (f[o + F_K] as number) * base;
    case 'labouchere': {
      const lo = p.lineOff;
      const head = lines[lo] as number;
      const tail = lines[lo + 1] as number;
      if (tail <= head) return base;
      const first = lines[lo + 2 + head] as number;
      const last = lines[lo + 2 + tail - 1] as number;
      return (tail - head === 1 ? first : first + last) * base;
    }
    default:
      return levelAmount(p, f, o, f[o + F_K] as number);
  }
}

/** The value `{ progStep }` reads (§7.6). */
export function stepOf(p: ProgParams, f: Float64Array, o: number, lines: Float64Array): number {
  if (p.kind === 'flat') return 0;
  if (p.kind === 'labouchere')
    return (lines[p.lineOff + 1] as number) - (lines[p.lineOff] as number);
  return f[o + F_K] as number;
}

export function resetState(p: ProgParams, f: Float64Array, o: number, lines: Float64Array): void {
  f[o + F_K] = p.kind === 'oscars-grind' ? 1 : 0;
  f[o + F_CYCLE] = 0;
  if (p.kind === 'labouchere') {
    const lo = p.lineOff;
    lines[lo] = 0;
    lines[lo + 1] = p.line0.length;
    for (let i = 0; i < p.line0.length; i++) lines[lo + 2 + i] = p.line0[i] as number;
  }
}

export function isInitial(p: ProgParams, f: Float64Array, o: number): boolean {
  switch (p.kind) {
    case 'flat':
      return true;
    case 'oscars-grind':
      return f[o + F_K] === 1 && f[o + F_CYCLE] === 0;
    case 'labouchere':
      return f[o + F_CYCLE] === 0;
    default:
      return f[o + F_K] === 0;
  }
}

/** Applies a cap: increments `caps`, applies `onCap`. Returns the flags. */
function capped(p: ProgParams, f: Float64Array, o: number, lines: Float64Array): number {
  f[o + F_CAPS] = (f[o + F_CAPS] as number) + 1;
  if (p.onCap === 'reset') {
    resetState(p, f, o, lines);
    return FLAG_CAP;
  }
  return p.onCap === 'stop' ? FLAG_CAP | FLAG_STOP_CAP : FLAG_CAP;
}

function exceeds(f: Float64Array, o: number, amount: number): boolean {
  return amount > (f[o + F_MAX] as number) || amount > MAX_AMOUNT;
}

/** Moves to `target` (> current: cap rules apply; otherwise applied directly). */
function moveLevel(
  p: ProgParams,
  f: Float64Array,
  o: number,
  lines: Float64Array,
  target: number,
): number {
  const k = f[o + F_K] as number;
  if (target > k) {
    if (target > levelCount(p) - 1 || exceeds(f, o, levelAmount(p, f, o, target)))
      return capped(p, f, o, lines);
  }
  f[o + F_K] = target < 0 ? 0 : target;
  return 0;
}

function seqStep(
  p: ProgParams,
  f: Float64Array,
  o: number,
  lines: Float64Array,
  step: SeqStep,
): number {
  const k = f[o + F_K] as number;
  switch (step) {
    case 'advance':
      return moveLevel(p, f, o, lines, k + 1);
    case 'back':
      f[o + F_K] = Math.max(0, k - 1);
      return 0;
    case 'reset':
      f[o + F_K] = 0;
      return 0;
    default:
      return 0;
  }
}

/**
 * Feeds a result. `profit` and `stake` are the sums over the considered resolutions (cents).
 * `result`: 1 win, 2 loss, 3 push. Returns FLAG_* bits.
 */
export function feed(
  p: ProgParams,
  f: Float64Array,
  o: number,
  lines: Float64Array,
  result: number,
  profit: number,
  stake: number,
): number {
  const k = f[o + F_K] as number;
  switch (p.kind) {
    case 'flat':
      return 0;
    case 'martingale':
    case 'grand-martingale':
      if (result === 1) f[o + F_K] = 0;
      else if (result === 2) return moveLevel(p, f, o, lines, k + 1);
      return 0;
    case 'fibonacci':
      if (result === 1) f[o + F_K] = Math.max(0, k - p.back);
      else if (result === 2) return moveLevel(p, f, o, lines, k + 1);
      return 0;
    case 'dalembert':
      if (result === 1) f[o + F_K] = Math.max(0, k - 1);
      else if (result === 2) return moveLevel(p, f, o, lines, k + 1);
      return 0;
    case 'paroli':
    case '1-3-2-6':
      if (result === 1) return moveLevel(p, f, o, lines, k + 1);
      if (result === 2) f[o + F_K] = 0;
      return 0;
    case 'sequence':
      return seqStep(p, f, o, lines, result === 1 ? p.onWin : result === 2 ? p.onLoss : p.onPush);
    case 'oscars-grind':
      return oscar(p, f, o, lines, result, profit, stake);
    case 'labouchere':
      return labouchere(p, f, o, lines, result);
    default:
      return 0;
  }
}

function oscar(
  p: ProgParams,
  f: Float64Array,
  o: number,
  lines: Float64Array,
  result: number,
  profit: number,
  stake: number,
): number {
  if (result === 3) return 0;
  f[o + F_CYCLE] = (f[o + F_CYCLE] as number) + profit;
  if (result === 2) return 0;
  const base = f[o + F_BASE] as number;
  const cycle = f[o + F_CYCLE] as number;
  const u = f[o + F_K] as number;
  if (cycle >= base) {
    f[o + F_K] = 1;
    f[o + F_CYCLE] = 0;
    return FLAG_DONE;
  }
  const need = Math.ceil(((base - cycle) * stake) / (profit * base));
  const next = Math.max(1, Math.min(u + 1, need));
  if (next > u && (next > p.limit || exceeds(f, o, next * base))) {
    // Cap: the cycle keeps accumulating; `reset` restarts it.
    const cyc = f[o + F_CYCLE] as number;
    const flags = capped(p, f, o, lines);
    if (p.onCap === 'stay') f[o + F_CYCLE] = cyc;
    return flags;
  }
  f[o + F_K] = next;
  return 0;
}

function labouchere(
  p: ProgParams,
  f: Float64Array,
  o: number,
  lines: Float64Array,
  result: number,
): number {
  if (result === 3) return 0;
  const lo = p.lineOff;
  let head = lines[lo] as number;
  let tail = lines[lo + 1] as number;
  if (tail <= head) {
    resetState(p, f, o, lines);
    return 0;
  }
  const first = lines[lo + 2 + head] as number;
  const last = lines[lo + 2 + tail - 1] as number;
  const units = tail - head === 1 ? first : first + last;
  f[o + F_CYCLE] = 1; // dirty
  if (result === 1) {
    head += 1;
    if (tail - head > 0) tail -= 1;
    lines[lo] = head;
    lines[lo + 1] = tail;
    if (tail <= head) {
      resetState(p, f, o, lines);
      if (p.onEmpty === 'stop') return FLAG_DONE | FLAG_STOP_DONE;
      return FLAG_DONE;
    }
    return 0;
  }
  // loss: append the units staked
  const newLen = tail - head + 1;
  const base = f[o + F_BASE] as number;
  // amount of the line after the append
  const nf = newLen === 1 ? units : (lines[lo + 2 + head] as number) + units;
  if (newLen > p.limit || exceeds(f, o, nf * base)) return capped(p, f, o, lines);
  if (tail >= LINE_REGION - 2) {
    const n = tail - head;
    for (let i = 0; i < n; i++) lines[lo + 2 + i] = lines[lo + 2 + head + i] as number;
    tail = n;
    lines[lo] = 0;
  }
  lines[lo + 2 + tail] = units;
  lines[lo + 1] = tail + 1;
  return 0;
}

/** Manual `advance`: one level up with cap rules (level kinds only). */
export function advance(p: ProgParams, f: Float64Array, o: number, lines: Float64Array): number {
  return moveLevel(p, f, o, lines, (f[o + F_K] as number) + 1);
}

/** Manual `back`: one level down, floored at 0 (level kinds only). */
export function back(f: Float64Array, o: number): void {
  f[o + F_K] = Math.max(0, (f[o + F_K] as number) - 1);
}

/** Trace state (§7.6). Allocates; tracing only. */
export function traceState(
  p: ProgParams,
  f: Float64Array,
  o: number,
  lines: Float64Array,
): Record<string, number | number[]> {
  switch (p.kind) {
    case 'flat':
      return {};
    case 'oscars-grind':
      return { u: f[o + F_K] as number, cycle: f[o + F_CYCLE] as number };
    case 'labouchere': {
      const lo = p.lineOff;
      const line: number[] = [];
      for (let i = lines[lo] as number; i < (lines[lo + 1] as number); i++)
        line.push(lines[lo + 2 + i] as number);
      return { line };
    }
    default:
      return { k: f[o + F_K] as number };
  }
}
