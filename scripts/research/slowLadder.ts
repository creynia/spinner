// Cycle and session dynamic programmes for slow-recovery ladders (docs/research/plan.md §7.18,
// briefs/E9.md). Pure maths, no imports, so it runs under `node` directly.
//
// A level-indexed ladder bets `stake[k]` at level k (total on the table), wins with probability
// p[k] and then nets `win[k]`, loses the stake otherwise. A loss climbs one level; a loss on the
// last level is a cap. A win moves to max(0, k - back): back = 1 is d'Alembert and a `sequence`
// with `onWin: 'back'`, back = 2 is the classic Fibonacci, back = Infinity is `onWin: 'reset'`
// (Martingale and the other one-win ladders). A cycle starts at level 0 and ends when a win lands
// on level 0 (done) or with a cap. The level chain is Markov, so cycles are renewals.
//
// `cycleStats` iterates the cycle chain to absorption and returns q (cap per cycle), the moments
// of the cycle length T and profit R, the mean cap loss and the turnover per cycle; `predict`
// turns them into the E3/E5 quantities (λ, e^(-λ), n½, x, k, a closed-form median). `noCapExact`
// iterates the level chain for S spins (the exact never-capped share from a fresh bankroll), and
// `sessionDp` runs the whole session over (level, equity) with the harness's rules: an
// unaffordable bet is cut to the equity if that meets the table minimum (reconcile `reduce`) and
// the session busts otherwise; stop-win and stop-loss are checked on equity after each round; a
// cap is seen at the next window, so a cap on the last spin does not end the session as a cap.
// `labouchereCycle` is the cycle chain for Labouchere, whose state is the line itself.

export interface Level {
  /** Total stake at this level, cents. */
  stake: number;
  /** Probability the layout wins. */
  p: number;
  /** Net profit of a win, cents. */
  win: number;
}

export interface LevelLadder {
  levels: Level[];
  /** Levels a win steps back (Infinity: reset to level 0). */
  back: number;
}

export interface CycleStats {
  /** Per-cycle cap probability. */
  q: number;
  /** Mean cycle length, spins (done and capped cycles). */
  ET: number;
  /** Mean length of a cycle that ends done. */
  ETdone: number;
  /** Variance of the length of a done cycle. */
  VarTdone: number;
  /** Mean cycle profit, cents (done and capped cycles together). */
  ER: number;
  /** Mean profit of a done cycle, cents (tau-bar). */
  tau: number;
  /** Variance of the profit of a done cycle. */
  VarRdone: number;
  /** Covariance of profit and length of a done cycle. */
  CovRTdone: number;
  /** Mean loss of a capped cycle, cents (positive). */
  capLoss: number;
  /** Largest mean cap loss over the spin counts at which a cycle can cap, cents. */
  capLossMax: number;
  /** Mean turnover per cycle, cents. */
  wager: number;
  /** Probability mass left unabsorbed when the iteration stopped. */
  residual: number;
}

const EPS = 1e-15;

/** Iterate the cycle chain to absorption. */
export function cycleStats(lad: LevelLadder, maxSpins = 2_000_000): CycleStats {
  const L = lad.levels.length;
  const st = lad.levels.map((l) => l.stake);
  const pw = lad.levels.map((l) => l.p);
  const wn = lad.levels.map((l) => l.win);
  // Per level: mass, E[R 1], E[R^2 1], E[W 1].
  let m = new Float64Array(L);
  let r = new Float64Array(L);
  let r2 = new Float64Array(L);
  let w = new Float64Array(L);
  let nm = new Float64Array(L);
  let nr = new Float64Array(L);
  let nr2 = new Float64Array(L);
  let nw = new Float64Array(L);
  m[0] = 1;
  let alive = 1;
  const d = { p: 0, t: 0, t2: 0, r: 0, r2: 0, rt: 0, w: 0 };
  const c = { p: 0, t: 0, r: 0, w: 0, max: 0 };
  let t = 0;
  while (alive > EPS && t < maxSpins) {
    t++;
    nm.fill(0);
    nr.fill(0);
    nr2.fill(0);
    nw.fill(0);
    alive = 0;
    for (let k = 0; k < L; k++) {
      const mk = m[k]!;
      if (mk === 0) continue;
      const rk = r[k]!;
      const r2k = r2[k]!;
      const wk = w[k]! + mk * st[k]!;
      const p = pw[k]!;
      // win
      {
        const g = wn[k]!;
        const mm = mk * p;
        const rr = (rk + mk * g) * p;
        const rr2 = (r2k + 2 * g * rk + g * g * mk) * p;
        const ww = wk * p;
        const j = lad.back === Infinity ? 0 : Math.max(0, k - lad.back);
        if (j === 0) {
          d.p += mm;
          d.t += t * mm;
          d.t2 += t * t * mm;
          d.r += rr;
          d.r2 += rr2;
          d.rt += t * rr;
          d.w += ww;
        } else {
          nm[j]! += mm;
          nr[j]! += rr;
          nr2[j]! += rr2;
          nw[j]! += ww;
          alive += mm;
        }
      }
      // loss
      {
        const g = -st[k]!;
        const mm = mk * (1 - p);
        const rr = (rk + mk * g) * (1 - p);
        const rr2 = (r2k + 2 * g * rk + g * g * mk) * (1 - p);
        const ww = wk * (1 - p);
        if (k + 1 === L) {
          c.p += mm;
          c.t += t * mm;
          c.r += rr;
          c.w += ww;
          if (mm > 0) c.max = Math.max(c.max, -rr / mm);
        } else {
          nm[k + 1]! += mm;
          nr[k + 1]! += rr;
          nr2[k + 1]! += rr2;
          nw[k + 1]! += ww;
          alive += mm;
        }
      }
    }
    [m, nm] = [nm, m];
    [r, nr] = [nr, r];
    [r2, nr2] = [nr2, r2];
    [w, nw] = [nw, w];
  }
  const tau = d.r / d.p;
  const ETdone = d.t / d.p;
  return {
    q: c.p,
    ET: d.t + c.t,
    ETdone,
    VarTdone: d.t2 / d.p - ETdone * ETdone,
    ER: d.r + c.r,
    tau,
    VarRdone: d.r2 / d.p - tau * tau,
    CovRTdone: d.rt / d.p - tau * ETdone,
    capLoss: c.p > 0 ? -c.r / c.p : 0,
    capLossMax: c.max,
    wager: d.w + c.w,
    residual: alive,
  };
}

/** Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function probit(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269];
  const a4 = -30.66479806614716;
  const a5 = 2.506628277459239;
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972];
  const b4 = -13.28068155288572;
  const cc = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734];
  const c4 = 4.374664141464968;
  const c5 = 2.938163982698783;
  const dd = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((cc[0]! * q + cc[1]!) * q + cc[2]!) * q + cc[3]!) * q + c4) * q + c5) /
      ((((dd[0]! * q + dd[1]!) * q + dd[2]!) * q + dd[3]!) * q + 1)
    );
  }
  if (p > 1 - pl) return -probit(1 - p);
  const q = p - 0.5;
  const rr = q * q;
  return (
    ((((((a[0]! * rr + a[1]!) * rr + a[2]!) * rr + a[3]!) * rr + a4) * rr + a5) * q) /
    (((((b[0]! * rr + b[1]!) * rr + b[2]!) * rr + b[3]!) * rr + b4) * rr + 1)
  );
}

export interface Prediction {
  /** Winning cycles per spin, (1 - q) / E[T]. */
  pEff: number;
  /** Bankroll in cycle profits: mean cap loss / tau. */
  B: number;
  x: number;
  /** k = qB / (1 - q); P(no cap) = e^(-k x). */
  k: number;
  /** Expected caps in S spins, q S / E[T]. */
  lambda: number;
  /** e^(-lambda). */
  pNoCap: number;
  /** Median horizon ln2 E[T] / q, spins. */
  nHalf: number;
  /** Closed-form median at S, cents, or null when e^(-lambda) <= 1/2. */
  median: number | null;
  /** Realized edge of the cycle, ER / wager (must be -1/37 on a single-zero wheel). */
  edge: number;
}

/**
 * The closed forms. The median is E5's "refined" rule with the renewal CLT: survivors hold the
 * top e^(-λ) of sessions, so the overall median is their (1 - 1/(2 e^(-λ))) quantile, and a
 * survivor's net after S spins is about Normal(S τ/E[T_done], S Var(R - τ T/E[T_done]) / E[T_done]).
 */
export function predict(cs: CycleStats, S: number): Prediction {
  const pEff = (1 - cs.q) / cs.ET;
  const B = cs.capLoss / cs.tau;
  const lambda = (cs.q * S) / cs.ET;
  const pNoCap = Math.exp(-lambda);
  const slope = cs.tau / cs.ETdone;
  const varUnit =
    cs.VarRdone - 2 * slope * cs.CovRTdone + slope * slope * cs.VarTdone; /* Var(R - slope T) */
  const mu = S * slope;
  const sd = Math.sqrt(Math.max(0, (S * varUnit) / cs.ETdone));
  const median = pNoCap > 0.5 ? mu + sd * probit(1 - 1 / (2 * pNoCap)) : null;
  return {
    pEff,
    B,
    x: (pEff * S) / B,
    k: (cs.q * B) / (1 - cs.q),
    lambda,
    pNoCap,
    nHalf: (Math.LN2 * cs.ET) / cs.q,
    median,
    edge: cs.ER / cs.wager,
  };
}

/**
 * Exact P(no cap seen by the harness) over S spins from a fresh ladder (bankroll never binding):
 * a cap from the loss on spin S is not seen, so caps on spins 1..S-1 count.
 */
export function noCapExact(lad: LevelLadder, S: number): { pNoCap: number; crossing: number } {
  const L = lad.levels.length;
  let m = new Float64Array(L);
  let n = new Float64Array(L);
  m[0] = 1;
  let alive = 1;
  let crossing = -1;
  let atS = 1;
  for (let t = 1; t <= Math.max(S, 1); t++) {
    n.fill(0);
    let capped = 0;
    for (let k = 0; k < L; k++) {
      const mk = m[k]!;
      if (mk === 0) continue;
      const p = lad.levels[k]!.p;
      const j = lad.back === Infinity ? 0 : Math.max(0, k - lad.back);
      n[j]! += mk * p;
      if (k + 1 === L) capped += mk * (1 - p);
      else n[k + 1]! += mk * (1 - p);
    }
    alive -= capped;
    // the seen share at spin t counts caps on spins 1..t-1; the never-capped share at t counts 1..t
    if (crossing < 0 && alive < 0.5) crossing = t;
    if (t === S - 1) atS = alive;
    [m, n] = [n, m];
  }
  if (S === 1) atS = 1;
  return { pNoCap: atS, crossing };
}

export interface SessionOptions {
  bankroll: number;
  spins: number;
  onCap: 'stop' | 'reset';
  /** Smallest bet the table accepts (a reduced bet below it busts the session), cents. */
  tableMin: number;
  /** Chip unit a reduced bet is floored to, cents. */
  chip?: number;
  stopWin?: number;
  stopLoss?: number;
  /** Equity ceiling as a multiple of the bankroll (mass above it is clamped). */
  ceiling?: number;
  /** Rounds at which the path is sampled (default: 1..50 and every 10). */
  checkpoints?: number[];
}

export interface SessionResult {
  mean: number;
  median: number;
  pWin: number;
  cvar5: number;
  pBust: number;
  /** Sessions ended by a cap (onCap stop). */
  pCap: number;
  pStopWin: number;
  pStopLoss: number;
  wager: number;
  rounds: number;
  /** Last checkpoint with a positive median (null: never). */
  medianAheadUntil: number | null;
  path: { round: number; p50: number; ahead: number }[];
  /** Mass clamped at the equity ceiling. */
  clamped: number;
}

function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Quantile of a discrete distribution on a grid (smallest value with CDF >= p). */
function quantileOf(mass: Float64Array, p: number): number {
  let acc = 0;
  for (let i = 0; i < mass.length; i++) {
    acc += mass[i]!;
    if (acc >= p - 1e-12) return i;
  }
  return mass.length - 1;
}

/** The whole session over (level, equity), with the harness's rules. */
export function sessionDp(lad: LevelLadder, o: SessionOptions): SessionResult {
  const L = lad.levels.length;
  const chip = o.chip ?? 100;
  let u = gcd(o.bankroll, chip);
  for (const l of lad.levels) u = gcd(gcd(u, l.stake), l.win);
  const B0 = Math.round(o.bankroll / u);
  const N = Math.ceil(B0 * (o.ceiling ?? 4)) + 1;
  const st = lad.levels.map((l) => Math.round(l.stake / u));
  const wn = lad.levels.map((l) => l.win / u);
  const pw = lad.levels.map((l) => l.p);
  const minU = Math.ceil(o.tableMin / u);
  const chipU = Math.max(1, Math.round(chip / u));
  const sw = o.stopWin === undefined ? Infinity : o.stopWin / u;
  const sl = o.stopLoss === undefined ? Infinity : o.stopLoss / u;
  const checkpoints = new Set(
    o.checkpoints ??
      Array.from({ length: o.spins }, (_, i) => i + 1).filter((t) => t <= 50 || t % 10 === 0),
  );
  checkpoints.add(o.spins);
  let cur = new Float64Array(L * N);
  let nxt = new Float64Array(L * N);
  const ended = new Float64Array(N); // money in the pocket: stopped, capped or bust sessions
  cur[B0] = 1;
  let lo = B0;
  let hi = B0;
  // `nxt` still holds the distribution of two spins ago over [plo, phi]: clear that range.
  let plo = 0;
  let phi = -1;
  let pBust = 0;
  let pCap = 0;
  let pSW = 0;
  let pSL = 0;
  let wager = 0;
  let rounds = 0;
  let clamped = 0;
  const path: SessionResult['path'] = [];
  const back = lad.back;
  const put = (k: number, e: number, mm: number, nlo: { v: number }, nhi: { v: number }): void => {
    if (e >= N) {
      clamped += mm;
      e = N - 1;
    }
    nxt[k * N + e]! += mm;
    if (e < nlo.v) nlo.v = e;
    if (e > nhi.v) nhi.v = e;
  };
  for (let t = 1; t <= o.spins; t++) {
    const nlo = { v: N };
    const nhi = { v: -1 };
    if (phi >= plo) for (let k = 0; k < L; k++) nxt.fill(0, k * N + plo, k * N + phi + 1);
    for (let k = 0; k < L; k++) {
      const base = k * N;
      const s = st[k]!;
      const p = pw[k]!;
      const jw = back === Infinity ? 0 : Math.max(0, k - back);
      for (let e = lo; e <= hi; e++) {
        const mm = cur[base + e]!;
        if (mm === 0) continue;
        let b = s;
        if (e < s) {
          b = Math.floor(e / chipU) * chipU;
          if (b <= 0 || b < minU) {
            pBust += mm;
            ended[e]! += mm;
            continue;
          }
        }
        wager += mm * b * u;
        rounds += mm;
        const ew = e + Math.round((wn[k]! * b) / s);
        const el = e - b;
        // win
        const mw = mm * p;
        if (ew - B0 >= sw) {
          pSW += mw;
          ended[Math.min(ew, N - 1)]! += mw;
          if (ew >= N) clamped += mw;
        } else put(jw, ew, mw, nlo, nhi);
        // loss
        const ml = mm * (1 - p);
        if (B0 - el >= sl) {
          pSL += ml;
          ended[el]! += ml;
        } else if (k + 1 === L) {
          if (o.onCap === 'stop' && t < o.spins) {
            pCap += ml;
            ended[el]! += ml;
          } else put(0, el, ml, nlo, nhi);
        } else put(k + 1, el, ml, nlo, nhi);
      }
    }
    [cur, nxt] = [nxt, cur];
    plo = lo;
    phi = hi;
    lo = nlo.v;
    hi = nhi.v;
    if (hi < lo) {
      lo = 0;
      hi = -1;
    }
    if (checkpoints.has(t)) {
      const dist = Float64Array.from(ended);
      for (let k = 0; k < L; k++) {
        const base = k * N;
        for (let e = lo; e <= hi; e++) dist[e]! += cur[base + e]!;
      }
      let ahead = 0;
      for (let e = B0 + 1; e < N; e++) ahead += dist[e]!;
      path.push({ round: t, p50: (quantileOf(dist, 0.5) - B0) * u, ahead });
    }
  }
  const dist = Float64Array.from(ended);
  for (let k = 0; k < L; k++) {
    const base = k * N;
    for (let e = lo; e <= hi; e++) dist[e]! += cur[base + e]!;
  }
  let mean = 0;
  let win = 0;
  for (let e = 0; e < N; e++) {
    mean += dist[e]! * (e - B0);
    if (e > B0) win += dist[e]!;
  }
  // CVaR 5 %: mean of the worst 5 % of the mass.
  let need = 0.05;
  let cv = 0;
  for (let e = 0; e < N && need > 1e-15; e++) {
    const take = Math.min(need, dist[e]!);
    cv += take * (e - B0);
    need -= take;
  }
  let mau: number | null = null;
  for (const pt of path) if (pt.p50 > 0) mau = pt.round;
  return {
    mean: mean * u,
    median: (quantileOf(dist, 0.5) - B0) * u,
    pWin: win,
    cvar5: (cv / 0.05) * u,
    pBust,
    pCap,
    pStopWin: pSW,
    pStopLoss: pSL,
    wager,
    rounds,
    medianAheadUntil: mau,
    path,
    clamped,
  };
}

// ---------------------------------------------------------------- ladder builders

export const RED = 18 / 37;
export const DOZEN = 12 / 37;

/** Single-bet ladder on an outside bet paying `payout` to 1 with win probability p. */
export function singleBet(stakes: number[], back: number, p = RED, payout = 1): LevelLadder {
  return { levels: stakes.map((s) => ({ stake: s, p, win: s * payout })), back };
}

/** Largest prefix whose sum fits the bankroll. */
export function fit(stakes: number[], bankroll: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (const s of stakes) {
    if (sum + s > bankroll) break;
    out.push(s);
    sum += s;
  }
  return out;
}

export function fibonacciStakes(unit: number, n: number): number[] {
  const f = [1, 1];
  while (f.length < n) f.push(f[f.length - 1]! + f[f.length - 2]!);
  return f.slice(0, n).map((x) => x * unit);
}

export function geometricStakes(base: number, r: number, n: number, chip = 100): number[] {
  return Array.from({ length: n }, (_, k) => Math.ceil((base * r ** k) / chip - 1e-9) * chip);
}

export function dalembertStakes(base: number, step: number, n: number): number[] {
  return Array.from({ length: n }, (_, k) => base + k * step);
}

// ---------------------------------------------------------------- Labouchere

export interface LabouchereInput {
  line: number[];
  /** Cents per line unit. */
  unit: number;
  maxLength: number;
  /** Cap when the next bet would exceed this, cents (Infinity: none). */
  maxAmount?: number;
  p?: number;
  payout?: number;
  /** States lighter than this are dropped (their mass is reported in `residual`). */
  prune?: number;
}

/**
 * Cycle chain over Labouchere lines (the line is the state). The remaining target is
 * sum(line) × unit, so a done cycle nets sum(initial) × unit and a cycle's running net is
 * (sum(initial) - sum(line)) × unit. A loss appends first + last (a cap if the line would exceed
 * maxLength or the next bet would exceed maxAmount); a win removes the first and last numbers.
 */
export function labouchereCycle(inp: LabouchereInput, maxSpins = 100_000): CycleStats {
  const prune = inp.prune ?? 1e-12;
  const p = inp.p ?? RED;
  const pay = inp.payout ?? 1;
  const u = inp.unit;
  const maxAmt = inp.maxAmount ?? Infinity;
  const sum0 = inp.line.reduce((a, b) => a + b, 0);
  const bet = (l: number[]): number => (l.length === 1 ? l[0]! : l[0]! + l[l.length - 1]!);
  type S = { line: number[]; m: number; w: number };
  let states = new Map<string, S>([[inp.line.join(','), { line: inp.line, m: 1, w: 0 }]]);
  const d = { p: 0, t: 0, t2: 0, r: 0, r2: 0, rt: 0, w: 0 };
  const c = { p: 0, t: 0, r: 0, w: 0, max: 0 };
  let alive = 1;
  let t = 0;
  let pruned = 0;
  const add = (map: Map<string, S>, line: number[], m: number, w: number): void => {
    const key = line.join(',');
    const s = map.get(key);
    if (s) {
      s.m += m;
      s.w += w;
    } else map.set(key, { line, m, w });
  };
  while (alive > prune && t < maxSpins) {
    t++;
    const next = new Map<string, S>();
    alive = 0;
    for (const s of states.values()) {
      if (s.m < prune) {
        pruned += s.m;
        continue;
      }
      const b = bet(s.line);
      const w = s.w + s.m * b * u;
      // win: remove first and last; a win pays `pay` × b and clears that many line units (even
      // money: exactly the two numbers bet).
      const mw = s.m * p;
      const ww = w * p;
      const rest = s.line.length <= 2 ? [] : s.line.slice(1, -1);
      if (pay !== 1) throw new Error('labouchereCycle: even money only');
      if (rest.length === 0) {
        const R = sum0 * u;
        d.p += mw;
        d.t += t * mw;
        d.t2 += t * t * mw;
        d.r += R * mw;
        d.r2 += R * R * mw;
        d.rt += t * R * mw;
        d.w += ww;
      } else {
        add(next, rest, mw, ww);
        alive += mw;
      }
      // loss: append first + last
      const ml = s.m * (1 - p);
      const wl = w * (1 - p);
      const grown = [...s.line, b];
      if (grown.length > inp.maxLength || bet(grown) * u > maxAmt) {
        const R = (sum0 - grown.reduce((a, x) => a + x, 0)) * u;
        c.p += ml;
        c.t += t * ml;
        c.r += R * ml;
        c.w += wl;
        c.max = Math.max(c.max, -R);
      } else {
        add(next, grown, ml, wl);
        alive += ml;
      }
    }
    states = next;
  }
  const tau = d.r / d.p;
  const ETdone = d.t / d.p;
  return {
    q: c.p,
    ET: d.t + c.t,
    ETdone,
    VarTdone: d.t2 / d.p - ETdone * ETdone,
    ER: d.r + c.r,
    tau,
    VarRdone: d.r2 / d.p - tau * tau,
    CovRTdone: d.rt / d.p - tau * ETdone,
    capLoss: c.p > 0 ? -c.r / c.p : 0,
    capLossMax: c.max,
    wager: d.w + c.w,
    residual: alive + pruned,
  };
}

/** Deterministic 32-bit PRNG (mulberry32), for the Labouchere cycle sampler. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Labouchere cycle statistics by sampling (the exact line-state chain above grows exponentially
 * with maxLength: 18 s at maxLength 8). Same conventions as `cycleStats`; `ruin` is the share of
 * cycles whose deficit plus next bet exceeded `bankroll` before the cycle ended (the bankroll,
 * not the cap, would bind there), and `residual` is 0.
 */
export function labouchereMc(
  inp: LabouchereInput & { bankroll?: number },
  cycles = 1_000_000,
  seed = 20261031,
): CycleStats & { ruin: number } {
  const p = inp.p ?? RED;
  if ((inp.payout ?? 1) !== 1) throw new Error('labouchereMc: even money only');
  const u = inp.unit;
  const maxAmt = inp.maxAmount ?? Infinity;
  const bank = inp.bankroll ?? Infinity;
  const sum0 = inp.line.reduce((a, b) => a + b, 0);
  const rnd = mulberry32(seed);
  const buf = new Float64Array(inp.maxLength + 2);
  let nd = 0;
  let td = 0;
  let td2 = 0;
  let rd = 0;
  let rtd = 0;
  let nc = 0;
  let tc = 0;
  let rc = 0;
  let cmax = 0;
  let wsum = 0;
  let ruin = 0;
  for (let i = 0; i < cycles; i++) {
    let head = 0;
    let tail = inp.line.length;
    for (let j = 0; j < tail; j++) buf[j] = inp.line[j]!;
    let sum = sum0;
    let t = 0;
    let w = 0;
    let ruined = false;
    for (;;) {
      t++;
      const n = tail - head;
      const b = n === 1 ? buf[head]! : buf[head]! + buf[tail - 1]!;
      if (!ruined && (sum - sum0 + b) * u > bank) ruined = true;
      w += b * u;
      if (rnd() < p) {
        sum -= b;
        head++;
        if (tail - head > 0) tail--;
        if (tail <= head) {
          const R = sum0 * u;
          nd++;
          td += t;
          td2 += t * t;
          rd += R;
          rtd += R * t;
          break;
        }
      } else {
        const len = n + 1;
        const nf = len === 1 ? b : buf[head]! + b;
        if (len > inp.maxLength || nf * u > maxAmt) {
          const R = (sum0 - sum - b) * u;
          nc++;
          tc += t;
          rc += R;
          cmax = Math.max(cmax, -R);
          break;
        }
        if (tail >= buf.length) {
          buf.copyWithin(0, head, tail);
          tail -= head;
          head = 0;
        }
        buf[tail++] = b;
        sum += b;
      }
    }
    wsum += w;
    if (ruined) ruin++;
  }
  const tau = rd / nd;
  const ETdone = td / nd;
  return {
    q: nc / cycles,
    ET: (td + tc) / cycles,
    ETdone,
    VarTdone: td2 / nd - ETdone * ETdone,
    ER: (rd + rc) / cycles,
    tau,
    VarRdone: 0,
    CovRTdone: rtd / nd - tau * ETdone,
    capLoss: nc > 0 ? -rc / nc : 0,
    capLossMax: cmax,
    wager: wsum / cycles,
    residual: 0,
    ruin: ruin / cycles,
  };
}
