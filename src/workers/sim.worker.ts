// Sim worker entry (harness-data-analysis.md §5.1): the whole batch protocol (ping, init, batch,
// simulate, dispose) is `createWorkerHandler` from the harness; results are posted with their
// buffers transferred, never cloned. Owner: core-harness.
import type { FromSim, ToSim } from '@core/contracts/protocol';
import { createWorkerHandler } from '@core/harness';
import { roulette } from '@game/roulette';

const handle = createWorkerHandler(roulette);

self.onmessage = (e: MessageEvent<ToSim>): void => {
  handle(e.data, (msg: FromSim, transfer?: Transferable[]) =>
    self.postMessage(msg, { transfer: transfer ?? [] }),
  );
};
