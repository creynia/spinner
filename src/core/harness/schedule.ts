// Checkpoint schedule, chunk size and sample indices (harness-data-analysis.md §4, §5.3, §5.6).
// Only correctly rounded float operations (+ - * / floor): no Math.pow, so every engine agrees.
import { CHECKPOINT_BUDGET_VALUES, CHUNK_ROUNDS } from '../contracts/run';

/** A validation failure with a stable code (`checkpoints-too-many`, ...). */
export class HarnessConfigError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HarnessConfigError';
  }
}

/** x * x * ... * x (m multiplications, left to right). */
function powInt(x: number, m: number): number {
  let p = x;
  for (let i = 1; i < m; i++) p = p * x;
  return p;
}

/** Number of checkpoints `K` of an 'auto' schedule. */
export function autoCheckpointCount(sessions: number): number {
  const k = Math.floor(CHECKPOINT_BUDGET_VALUES / Math.max(1, sessions));
  return Math.min(128, Math.max(16, k));
}

/**
 * Strictly increasing round indices at which equity is sampled; round r means "equity after r
 * rounds", 0 is the bankroll (harness-data-analysis.md §4).
 */
export function checkpointSchedule(
  maxRounds: number,
  sessions: number,
  spec: 'auto' | number[],
): Int32Array {
  if (!Number.isInteger(maxRounds) || maxRounds < 1) {
    throw new HarnessConfigError('max-rounds', `maxRounds must be a positive integer`);
  }
  if (spec !== 'auto') return customSchedule(maxRounds, sessions, spec);
  const K = autoCheckpointCount(sessions);
  if (maxRounds + 1 <= K) {
    const all = new Int32Array(maxRounds + 1);
    for (let i = 0; i <= maxRounds; i++) all[i] = i;
    return all;
  }
  const D = Math.min(33, Math.floor(K / 4) + 1); // dense head: rounds 0..D-1
  const a = D - 1;
  const M = K - D;
  const ratio = maxRounds / a;
  // g = ratio^(1/M) by bisection on powInt(x, M).
  let lo = 1;
  let hi = 2;
  while (powInt(hi, M) < ratio) hi = hi * 2;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (powInt(mid, M) < ratio) lo = mid;
    else hi = mid;
  }
  const g = hi;
  const geo = new Array<number>(M + 1).fill(0);
  let p = a;
  for (let k = 1; k <= M; k++) {
    p = p * g;
    geo[k] = Math.floor(p + 0.5);
  }
  geo[M] = maxRounds;
  let prev = a;
  for (let k = 1; k <= M; k++) {
    if (geo[k]! <= prev) geo[k] = prev + 1;
    prev = geo[k]!;
  }
  geo[M] = maxRounds;
  for (let k = M - 1; k >= 1; k--) {
    if (geo[k]! >= geo[k + 1]!) geo[k] = geo[k + 1]! - 1;
  }
  const out = new Int32Array(D + M);
  for (let i = 0; i <= a; i++) out[i] = i;
  for (let k = 1; k <= M; k++) out[a + k] = geo[k]!;
  return out;
}

function customSchedule(maxRounds: number, sessions: number, spec: number[]): Int32Array {
  const set = new Set<number>([0, maxRounds]);
  for (const v of spec) {
    if (!Number.isInteger(v)) throw new HarnessConfigError('checkpoints-invalid', 'not an integer');
    if (v >= 0 && v <= maxRounds) set.add(v);
  }
  const sorted = [...set].sort((x, y) => x - y);
  if (sorted.length > 512 || sessions * sorted.length * 4 > 32 * 1024 * 1024) {
    throw new HarnessConfigError(
      'checkpoints-too-many',
      `${sorted.length} checkpoints x ${sessions} sessions is too large`,
    );
  }
  return Int32Array.from(sorted);
}

/** Sessions per chunk: the largest power of two c in [1, 64] with c * maxRounds <= 16384. */
export function chunkSizeFor(maxRounds: number): number {
  let c = 64;
  while (c > 1 && c * maxRounds > CHUNK_ROUNDS) c /= 2;
  return c;
}

/** Deterministic sample session indices, ascending (harness-data-analysis.md §5.6). */
export function sampleIndices(sessions: number, samples: number): number[] {
  const want = Math.min(Math.max(0, Math.floor(samples)), sessions);
  if (want === 0) return [];
  const f = Math.min(8, Math.ceil(samples / 3));
  const m = samples - f;
  const set = new Set<number>();
  for (let i = 0; i < f && i < sessions; i++) set.add(i);
  if (m > 0) {
    for (let j = 0; j < m; j++) {
      const idx = Math.floor(((j + 0.5) * sessions) / m);
      if (idx >= 0 && idx < sessions) set.add(idx);
    }
  }
  for (let i = 0; set.size < want && i < sessions; i++) set.add(i);
  return [...set].sort((x, y) => x - y);
}
