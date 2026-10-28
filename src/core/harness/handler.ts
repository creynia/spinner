// The handler a sim worker (or the in-thread transport) runs: one message in, replies out
// (harness-data-analysis.md §5.1; contracts/protocol.ts).
import type { GamePlugin } from '../contracts/game';
import type { NormalizedDefinition } from '../contracts/experiment';
import { SIM_PROTOCOL, type FromSim, type ToSim } from '../contracts/protocol';
import type {
  CompileContext,
  Diagnostic,
  StrategyDefinition,
  StrategyRuntime,
} from '../contracts/strategy';
import { MAX_STOP_REASONS } from '../contracts/strategy';
import { CORE_VERSION } from '../contracts/version';
import { compileStrategy, StrategyCompileError } from '../strategy';
import { chunkSizeFor, checkpointSchedule } from './schedule';
import { BatchRunner, batchTransferList } from './session';

export type WorkerHandler = (
  msg: ToSim,
  reply: (msg: FromSim, transfer?: Transferable[]) => void,
) => void;

type AnyPlugin = GamePlugin<unknown, unknown, unknown, unknown>;

export interface WorkerHandlerOptions {
  /** Strategy compiler; default `compileStrategy` from core/strategy. Tests inject a driver. */
  compile?: (def: StrategyDefinition, ctx: CompileContext) => StrategyRuntime;
}

function diagnostic(code: string, message: string): Diagnostic {
  return { code, severity: 'error', path: '', message };
}

function compileContext(plugin: AnyPlugin, rules: unknown): CompileContext {
  return {
    catalog: plugin.bets.catalog(rules),
    parseBet: (id) => plugin.bets.parse(id),
    facts: plugin.facts,
    rules,
    limits: (betOrClass, r, view) => plugin.limits(betOrClass, r, view),
    compileFact: (ref, r) => plugin.compileFact(ref, r),
    compileHistory: plugin.compileHistory
      ? (predicate, r) => plugin.compileHistory!(predicate, r)
      : undefined,
  };
}

/** Resolve rules, compile the strategy and build the batch runner for a definition. */
export function buildRunner(
  plugin: AnyPlugin,
  definition: NormalizedDefinition,
  schedule: Int32Array,
  chunkSize: number,
  sessions: number,
  compile: NonNullable<WorkerHandlerOptions['compile']>,
): BatchRunner {
  const rules = plugin.rules.resolve(definition.game.rules);
  const runtime = compile(definition.strategy, compileContext(plugin, rules));
  if (runtime.stopReasons.length > MAX_STOP_REASONS) {
    throw new Error(
      `strategy has ${runtime.stopReasons.length} stop reasons (max ${MAX_STOP_REASONS})`,
    );
  }
  return new BatchRunner({ plugin, rules, definition, runtime, schedule, chunkSize, sessions });
}

export function createWorkerHandler(
  plugin: AnyPlugin,
  opts: WorkerHandlerOptions = {},
): WorkerHandler {
  const compile = opts.compile ?? compileStrategy;
  let run: { runKey: string; runner: BatchRunner } | null = null;
  // Watch re-simulates the same definition repeatedly: keep the last compiled runner.
  let simCache: { key: string; runner: BatchRunner } | null = null;

  return (msg, reply) => {
    switch (msg.t) {
      case 'ping':
        reply({
          t: 'pong',
          protocol: SIM_PROTOCOL,
          coreVersion: CORE_VERSION,
          game: { id: plugin.id, version: plugin.version },
        });
        return;
      case 'init': {
        run = null;
        try {
          const runner = buildRunner(
            plugin,
            msg.definition,
            msg.schedule,
            msg.chunkSize,
            msg.sessions,
            compile,
          );
          run = { runKey: msg.runKey, runner };
          reply({ t: 'ready', runKey: msg.runKey, labels: runner.labels, columns: runner.specs });
        } catch (e) {
          reply({
            t: 'init-error',
            runKey: msg.runKey,
            errors:
              e instanceof StrategyCompileError
                ? [...e.diagnostics]
                : [diagnostic('E_INIT', e instanceof Error ? e.message : String(e))],
          });
        }
        return;
      }
      case 'batch': {
        if (!run || run.runKey !== msg.runKey) {
          reply({
            t: 'error',
            runKey: msg.runKey,
            batchId: msg.batchId,
            code: 'stale-run',
            message: 'batch for a run this worker was not initialised with',
          });
          return;
        }
        if (
          !Number.isInteger(msg.firstChunk) ||
          !Number.isInteger(msg.chunkCount) ||
          msg.firstChunk < 0 ||
          msg.chunkCount < 1 ||
          (msg.firstChunk + msg.chunkCount - 1) * run.runner.chunkSize >= run.runner.sessions
        ) {
          reply({
            t: 'error',
            runKey: msg.runKey,
            batchId: msg.batchId,
            code: 'bad-batch',
            message: `chunks ${msg.firstChunk}+${msg.chunkCount} are outside the run`,
          });
          return;
        }
        try {
          const o = run.runner.runBatch(msg.firstChunk, msg.chunkCount, msg.traceIndices);
          reply(
            {
              t: 'batch-done',
              runKey: msg.runKey,
              batchId: msg.batchId,
              firstChunk: msg.firstChunk,
              chunkCount: msg.chunkCount,
              firstSession: o.firstSession,
              count: o.count,
              columns: o.columns,
              checkpoints: o.checkpoints.buffer as ArrayBuffer,
              chunks: o.chunks,
              samples: o.samples,
              elapsedMs: o.elapsedMs,
            },
            batchTransferList(o),
          );
        } catch (e) {
          reply({
            t: 'error',
            runKey: msg.runKey,
            batchId: msg.batchId,
            code: 'batch-failed',
            message: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
      case 'simulate': {
        try {
          const def = msg.definition;
          const sessions = def.run.sessions;
          const schedule =
            msg.schedule ??
            checkpointSchedule(def.session.maxRounds, sessions, def.run.checkpointSchedule);
          const key = JSON.stringify(def) + '|' + (msg.schedule ? msg.schedule.join(',') : '');
          let runner: BatchRunner;
          if (simCache && simCache.key === key) runner = simCache.runner;
          else {
            runner = buildRunner(
              plugin,
              def,
              schedule,
              chunkSizeFor(def.session.maxRounds),
              sessions,
              compile,
            );
            simCache = { key, runner };
          }
          const r = runner.simulate(msg.index);
          reply(
            {
              t: 'simulated',
              reqId: msg.reqId,
              row: r.row,
              checkpoints: r.checkpoints,
              trace: r.trace,
            },
            [r.checkpoints.buffer as ArrayBuffer],
          );
        } catch (e) {
          reply({
            t: 'error',
            reqId: msg.reqId,
            code: 'simulate-failed',
            message: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
      case 'dispose':
        run = null;
        simCache = null;
        return;
    }
  };
}
