// Single-shot job: re-simulate one session with its full trace (Watch), through the pool's `aux`
// worker so Watch stays responsive while a run is going.
import type { NormalizedDefinition } from '../contracts/experiment';
import type { SimTransport } from '../contracts/protocol';
import type { SummaryRow } from '../contracts/run';
import type { SessionTrace } from '../contracts/strategy-trace';
import type { SimPool } from './pool';

export interface SimulatedResult {
  row: SummaryRow;
  checkpoints: Int32Array;
  trace: SessionTrace;
}

export class SimulateError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SimulateError';
  }
}

let nextReqId = 1;

export function simulateOn(
  transport: SimTransport,
  definition: NormalizedDefinition,
  index: number,
  schedule?: Int32Array,
): Promise<SimulatedResult> {
  const reqId = nextReqId++;
  return new Promise<SimulatedResult>((resolve, reject) => {
    const off = transport.onMessage((msg) => {
      if (msg.t === 'simulated' && msg.reqId === reqId) {
        off();
        resolve({ row: msg.row, checkpoints: msg.checkpoints, trace: msg.trace });
      } else if (msg.t === 'error' && (msg.reqId === reqId || msg.reqId === undefined)) {
        off();
        reject(new SimulateError(msg.code, msg.message));
      }
    });
    transport.post({ t: 'simulate', reqId, definition, index, schedule });
  });
}

/** Re-simulate session `index` of `definition` on the pool's aux worker. */
export function simulate(
  pool: SimPool,
  definition: NormalizedDefinition,
  index: number,
  schedule?: Int32Array,
): Promise<SimulatedResult> {
  return simulateOn(pool.aux(), definition, index, schedule);
}
