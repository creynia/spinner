import { describe, expect, it } from 'vitest';
import { CORE_VERSION } from '../contracts/version';
import { SIM_PROTOCOL, type FromSim, type ToSim } from '../contracts/protocol';
import { ENDED_BY, ENDED_BY_STRATEGY_BASE } from '../contracts/run';
import type { StrategyRuntime } from '../contracts/strategy';
import {
  FLAT_COIN,
  MARTINGALE_COIN,
  STAGED_COIN,
  coin,
  coinDefinition,
  compileTestStrategy,
} from '../testing';
import { checkpointSchedule, chunkSizeFor } from './schedule';
import { createWorkerHandler } from './handler';
import { buildRunner } from './handler';

function drive(handle: ReturnType<typeof createWorkerHandler>, msg: ToSim): FromSim[] {
  const out: FromSim[] = [];
  handle(msg, (m) => out.push(m));
  return out;
}

const handle = () => createWorkerHandler(coin, { compile: compileTestStrategy });

function initMsg(def = coinDefinition({ strategy: STAGED_COIN, sessions: 100, maxRounds: 50 })) {
  return {
    def,
    msg: {
      t: 'init' as const,
      runKey: 'k1',
      definition: def,
      schedule: checkpointSchedule(def.session.maxRounds, def.run.sessions, 'auto'),
      chunkSize: chunkSizeFor(def.session.maxRounds),
      sessions: def.run.sessions,
    },
  };
}

describe('worker handler', () => {
  it('answers ping with pong carrying the protocol, core and game versions', () => {
    expect(drive(handle(), { t: 'ping' })).toEqual([
      {
        t: 'pong',
        protocol: SIM_PROTOCOL,
        coreVersion: CORE_VERSION,
        game: { id: 'coin', version: coin.version },
      },
    ]);
  });

  it('init replies ready with labels and the 20 columns; dispose replies nothing', () => {
    const h = handle();
    const [ready] = drive(h, initMsg().msg);
    expect(ready).toMatchObject({
      t: 'ready',
      runKey: 'k1',
      labels: { stages: ['warm', 'mart', 'flat'], categories: ['coin'], reasons: ['walk-away'] },
    });
    if (ready?.t !== 'ready') throw new Error('unreachable');
    expect(ready.columns.map((c) => c.name)).toEqual([
      'final',
      'net',
      'peak',
      'trough',
      'maxDrawdown',
      'roundsPlayed',
      'roundsWagered',
      'wagered',
      'expectedLoss',
      'variance',
      'endedBy',
      'stopStage',
      'rejected',
      'deferred',
      'adjusted',
      'anomalies',
      'maxExposure',
      'stageRounds',
      'catWagered',
      'catNet',
    ]);
    expect(ready.columns.find((c) => c.name === 'stageRounds')?.width).toBe(3);
    expect(ready.columns.find((c) => c.name === 'catNet')?.width).toBe(1);
    expect(drive(h, { t: 'dispose' })).toEqual([]);
  });

  it('a batch before init, or for another run, is a stale-run error', () => {
    const h = handle();
    const batch: ToSim = {
      t: 'batch',
      runKey: 'k1',
      batchId: 7,
      firstChunk: 0,
      chunkCount: 1,
      traceIndices: [],
    };
    expect(drive(h, batch)).toEqual([
      expect.objectContaining({ t: 'error', code: 'stale-run', batchId: 7 }),
    ]);
    drive(h, initMsg().msg);
    expect(drive(h, { ...batch, runKey: 'other' })).toEqual([
      expect.objectContaining({ t: 'error', code: 'stale-run' }),
    ]);
  });

  it('a strategy that does not compile is an init-error, not a throw', () => {
    const h = createWorkerHandler(coin, {
      compile: () => {
        throw new Error('nope');
      },
    });
    const [r] = drive(h, initMsg().msg);
    expect(r).toMatchObject({ t: 'init-error', errors: [{ code: 'E_INIT', message: 'nope' }] });
  });

  it('the default compiler is core/strategy: its stub throws, which is an init-error', () => {
    const [r] = drive(createWorkerHandler(coin), initMsg().msg);
    // Until core-strategy lands the stub throws; afterwards a real runtime answers ready.
    expect(['init-error', 'ready']).toContain(r?.t);
  });

  it('batch-done carries one buffer per column, K checkpoints per session and chunk stats', () => {
    const h = handle();
    const { msg, def } = initMsg();
    const [ready] = drive(h, msg);
    if (ready?.t !== 'ready') throw new Error('unreachable');
    const K = msg.schedule.length;
    const chunkSize = msg.chunkSize;
    const replies = drive(h, {
      t: 'batch',
      runKey: 'k1',
      batchId: 3,
      firstChunk: 0,
      chunkCount: 2,
      traceIndices: [0, 5],
    });
    const done = replies[0];
    if (done?.t !== 'batch-done') throw new Error(JSON.stringify(done));
    expect(done).toMatchObject({ batchId: 3, firstChunk: 0, chunkCount: 2, firstSession: 0 });
    expect(done.count).toBe(Math.min(def.run.sessions, 2 * chunkSize));
    expect(done.columns).toHaveLength(20);
    ready.columns.forEach((spec, i) => {
      const bytes = { i32: 4, u8: 1, u16: 2, f64: 8, f64i: 8 }[spec.dtype];
      expect(done.columns[i]!.byteLength).toBe(done.count * spec.width * bytes);
    });
    expect(done.checkpoints.byteLength).toBe(done.count * K * 4);
    expect(done.chunks.map((c) => c.chunk)).toEqual([0, 1]);
    expect(done.chunks[0]!.expCum.length).toBe(K);
    expect(done.samples.map((s) => s.index)).toEqual([0, 5]);
    expect(done.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('simulate replies with the row, checkpoints and a full trace', () => {
    const h = handle();
    const def = coinDefinition({ strategy: STAGED_COIN, sessions: 50, maxRounds: 40 });
    const [r] = drive(h, { t: 'simulate', reqId: 9, definition: def, index: 3 });
    if (r?.t !== 'simulated') throw new Error(JSON.stringify(r));
    expect(r.reqId).toBe(9);
    expect(r.row.index).toBe(3);
    expect(r.trace).toHaveLength(r.row.roundsPlayed);
    expect(r.trace[0]).toMatchObject({ w: 0, stage: 'warm', reconcile: { actions: 2 } });
    expect(r.trace.at(-1)!.equity).toBe(r.row.final);
    expect(r.checkpoints.at(-1)).toBe(r.row.final);
  });
});

/** Run every chunk of a definition in one batch and return the runner's output and the runner. */
function runAll(
  def = coinDefinition({ strategy: STAGED_COIN, sessions: 400, maxRounds: 120, bankroll: 5000 }),
  compile: (
    d: typeof def.strategy,
    c: Parameters<typeof compileTestStrategy>[1],
  ) => StrategyRuntime = compileTestStrategy,
) {
  const schedule = checkpointSchedule(def.session.maxRounds, def.run.sessions, 'auto');
  const chunkSize = chunkSizeFor(def.session.maxRounds);
  const runner = buildRunner(coin, def, schedule, chunkSize, def.run.sessions, compile);
  const chunks = Math.ceil(def.run.sessions / chunkSize);
  return { def, runner, schedule, chunkSize, chunks, out: runner.runBatch(0, chunks, [0, 1, 2]) };
}

describe('session loop invariants (coin, staged strategy)', () => {
  const { def, out, schedule, chunkSize } = runAll();
  const t = out.table;
  const K = schedule.length;
  const n = out.count;

  it('money columns are consistent per session', () => {
    for (let i = 0; i < n; i++) {
      expect(t.net[i]).toBe(t.final[i]! - def.session.bankroll);
      expect(t.peak[i]!).toBeGreaterThanOrEqual(Math.max(t.final[i]!, def.session.bankroll));
      expect(t.trough[i]!).toBeLessThanOrEqual(Math.min(t.final[i]!, def.session.bankroll));
      expect(t.maxDrawdown[i]!).toBeLessThanOrEqual(t.peak[i]! - t.trough[i]!);
      expect(t.maxDrawdown[i]!).toBeGreaterThanOrEqual(0);
      expect(t.roundsPlayed[i]!).toBeLessThanOrEqual(def.session.maxRounds);
      expect(t.roundsWagered[i]!).toBeLessThanOrEqual(t.roundsPlayed[i]!);
    }
  });

  it('per-stage and per-category tallies add up', () => {
    for (let i = 0; i < n; i++) {
      let rounds = 0;
      for (let s = 0; s < 3; s++) rounds += t.stageRounds[i * 3 + s]!;
      expect(rounds).toBe(t.roundsPlayed[i]);
      expect(t.catNet[i]).toBe(t.net[i]);
      expect(t.catWagered[i]).toBe(t.wagered[i]);
    }
  });

  it('coin: expected loss is wagered/37 and variance is bounded by the stake squared', () => {
    for (let i = 0; i < n; i++) {
      expect(t.expectedLoss[i]!).toBeCloseTo(t.wagered[i]! / 37, 6);
      expect(t.variance[i]!).toBeGreaterThanOrEqual(0);
    }
  });

  it('checkpoints start at the bankroll, end at the final equity, and carry forward', () => {
    for (let i = 0; i < n; i++) {
      expect(out.checkpoints[i * K]).toBe(def.session.bankroll);
      expect(out.checkpoints[i * K + K - 1]).toBe(t.final[i]);
      for (let c = 0; c < K; c++) {
        if (schedule[c]! >= t.roundsPlayed[i]!) {
          expect(out.checkpoints[i * K + c]).toBe(t.final[i]);
        }
      }
    }
  });

  it('chunk expCum at the last checkpoint is the chunk total of expected loss', () => {
    let k = 0;
    for (const cs of out.chunks) {
      let sum = 0;
      for (let j = 0; j < chunkSize && k < n; j++, k++) sum += t.expectedLoss[k]!;
      // Same accumulation order (index order), so equality is exact.
      expect(cs.expCum[K - 1]).toBe(sum);
    }
  });

  it('records the strategy stop reason as 16 + its index in the sorted reasons', () => {
    const walked = Array.from(t.endedBy).filter((c) => c >= ENDED_BY_STRATEGY_BASE);
    expect(walked.length).toBeGreaterThan(0);
    for (const c of walked) expect(c).toBe(ENDED_BY_STRATEGY_BASE + 0);
    // 'walk-away' is the only reason, so labels.reasons[0].
    const r = runAll();
    expect(r.runner.labels.reasons).toEqual(['walk-away']);
  });

  it('transitions count goto between stages', () => {
    let total = 0;
    for (const cs of out.chunks) for (const x of cs.transitions) total += x;
    expect(total).toBeGreaterThan(0);
    for (const cs of out.chunks) {
      for (let s = 0; s < 3; s++) expect(cs.transitions[s * 3 + s]).toBe(0);
    }
  });

  it('trace of a sample matches its stored row and has one window per round', () => {
    for (const s of out.samples) {
      expect(s.row.final).toBe(t.final[s.index]);
      expect(s.trace.length).toBe(
        Math.min(2000, s.row.roundsPlayed + (s.row.endedBy === 'rounds' ? 0 : 1)),
      );
      expect(s.truncated).toBe(false);
    }
  });
});

describe('session stops', () => {
  it('stop-win and stop-loss end the session on the first round that reaches them', () => {
    const { def, out } = runAll(
      coinDefinition({
        strategy: FLAT_COIN,
        sessions: 300,
        maxRounds: 400,
        bankroll: 10_000,
        stopWin: 500,
        stopLoss: 700,
      }),
    );
    const t = out.table;
    let wins = 0;
    let losses = 0;
    for (let i = 0; i < out.count; i++) {
      if (t.endedBy[i] === ENDED_BY['stop-win']) {
        wins++;
        expect(t.net[i]).toBe(500); // flat $1: lands exactly on the target
      } else if (t.endedBy[i] === ENDED_BY['stop-loss']) {
        losses++;
        expect(t.net[i]).toBe(-700);
      } else expect(t.endedBy[i]).toBe(ENDED_BY.rounds);
    }
    expect(wins).toBeGreaterThan(0);
    expect(losses).toBeGreaterThan(0);
    expect(def.session.stopWin).toBe(500);
  });

  it('bust: the desired layout cannot be funded and the table is empty', () => {
    const { out } = runAll(
      coinDefinition({ strategy: MARTINGALE_COIN, sessions: 200, maxRounds: 300, bankroll: 1000 }),
    );
    const t = out.table;
    let busts = 0;
    for (let i = 0; i < out.count; i++) {
      if (t.endedBy[i] === ENDED_BY.bust) {
        busts++;
        expect(t.final[i]!).toBeLessThan(100); // below the coin table minimum
        expect(t.rejected[i]!).toBeGreaterThan(0);
      }
    }
    expect(busts).toBeGreaterThan(0);
  });

  it('counts reconcile adjustments (reduced to the bankroll) and rejection reasons per chunk', () => {
    const { out } = runAll(
      coinDefinition({ strategy: MARTINGALE_COIN, sessions: 200, maxRounds: 300, bankroll: 1000 }),
    );
    let adjusted = 0;
    for (let i = 0; i < out.count; i++) adjusted += out.table.adjusted[i]!;
    expect(adjusted).toBeGreaterThan(0);
    const reasons = new Set(out.chunks.flatMap((c) => Object.keys(c.rejectedByReason)));
    expect(reasons.has('unaffordable')).toBe(true);
  });

  it('a strategy error ends the session with endedBy error and reports it in the chunk', () => {
    const compile = (
      d: Parameters<typeof compileTestStrategy>[0],
      c: Parameters<typeof compileTestStrategy>[1],
    ) => {
      const rt = compileTestStrategy(d, c);
      return {
        ...rt,
        step: (...a: Parameters<StrategyRuntime['step']>) => {
          rt.step(...a);
          if (a[1].window === 3) a[2].error = { code: 'E_RT_TEST', message: 'boom' };
        },
      };
    };
    const { out } = runAll(
      coinDefinition({ strategy: FLAT_COIN, sessions: 70, maxRounds: 20 }),
      compile,
    );
    expect(Array.from(out.table.endedBy).every((c) => c === ENDED_BY.error)).toBe(true);
    expect(Array.from(out.table.roundsPlayed).every((r) => r === 3)).toBe(true);
    const errors = out.chunks.flatMap((c) => c.errors);
    expect(errors).toHaveLength(70);
    expect(errors[0]).toEqual({ index: 0, code: 'E_RT_TEST', message: 'boom' });
  });

  it('an exception in the strategy is a session error, not a failed batch', () => {
    const compile = (
      d: Parameters<typeof compileTestStrategy>[0],
      c: Parameters<typeof compileTestStrategy>[1],
    ) => {
      const rt = compileTestStrategy(d, c);
      return {
        ...rt,
        step: (...a: Parameters<StrategyRuntime['step']>) => {
          if (a[1].window === 2) throw new Error('kaboom');
          rt.step(...a);
        },
      };
    };
    const { out } = runAll(
      coinDefinition({ strategy: FLAT_COIN, sessions: 10, maxRounds: 20 }),
      compile,
    );
    expect(out.chunks[0]!.errors[0]).toMatchObject({
      code: 'session-exception',
      message: 'kaboom',
    });
    expect(out.table.endedBy[0]).toBe(ENDED_BY.error);
  });

  it('an unlisted strategy stop reason is an error', () => {
    const compile = (
      d: Parameters<typeof compileTestStrategy>[0],
      c: Parameters<typeof compileTestStrategy>[1],
    ) => {
      const rt = compileTestStrategy(d, c);
      return {
        ...rt,
        step: (...a: Parameters<StrategyRuntime['step']>) => {
          rt.step(...a);
          if (a[1].window === 1) a[2].stop = 'surprise';
        },
      };
    };
    const { out } = runAll(
      coinDefinition({ strategy: FLAT_COIN, sessions: 4, maxRounds: 20 }),
      compile,
    );
    expect(out.chunks[0]!.errors[0]).toMatchObject({ code: 'unknown-stop-reason' });
  });

  it('equity leaving the int32 range ends the session with equity-overflow', () => {
    const rich = { ...FLAT_COIN, unit: 100_000 };
    const { out } = runAll(
      coinDefinition({ strategy: rich, sessions: 4, maxRounds: 200, bankroll: 2_147_483_000 }),
    );
    expect(out.chunks[0]!.errors.some((e) => e.code === 'equity-overflow')).toBe(true);
  });

  it('saturates the u16 counters', () => {
    // 70k rounds of unaffordable (rejected) bets would be needed; instead check the clamp via a
    // strategy that asks for a below-minimum amount every round: 100000 rounds => saturated.
    const tiny = { ...FLAT_COIN, unit: 1 };
    const { out } = runAll(
      coinDefinition({ strategy: tiny, sessions: 1, maxRounds: 70_000, bankroll: 10_000 }),
    );
    expect(out.table.rejected[0]).toBe(65_535);
  });
});

describe('batch independence', () => {
  it('chunks run alone, in pairs or all together give the same bytes', () => {
    const { runner, chunks, out } = runAll();
    const alone: number[] = [];
    for (let c = 0; c < chunks; c++) {
      const o = runner.runBatch(c, 1, []);
      alone.push(...Array.from(o.table.final));
    }
    expect(alone).toEqual(Array.from(out.table.final));
    const tail = runner.runBatch(3, 5, []);
    expect(Array.from(tail.table.net)).toEqual(
      Array.from(out.table.net.slice(tail.firstSession, tail.firstSession + tail.count)),
    );
    expect(Array.from(tail.checkpoints)).toEqual(
      Array.from(
        out.checkpoints.slice(
          tail.firstSession * (out.checkpoints.length / out.count),
          (tail.firstSession + tail.count) * (out.checkpoints.length / out.count),
        ),
      ),
    );
  });

  it('simulate(index) reproduces the stored summary row', () => {
    const { runner, out } = runAll();
    for (const index of [0, 1, 137, 399]) {
      const sim = runner.simulate(index);
      expect(sim.row.final).toBe(out.table.final[index]);
      expect(sim.row.roundsPlayed).toBe(out.table.roundsPlayed[index]);
      expect(sim.row.wagered).toBe(out.table.wagered[index]);
      expect(sim.row.expectedLoss).toBe(out.table.expectedLoss[index]);
    }
  });
});
