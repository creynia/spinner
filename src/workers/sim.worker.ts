// Sim worker entry (harness-data-analysis.md §5.1). WP0: answers `ping` with `pong` through the
// harness handler; the batch protocol arrives with core-harness. Owner: core-harness.
import type { FromSim, ToSim } from '@core/contracts/protocol';
import { createWorkerHandler } from '@core/harness';
import { roulette } from '@game/roulette';

const handle = createWorkerHandler(roulette);

self.onmessage = (e: MessageEvent<ToSim>): void => {
  handle(e.data, (msg: FromSim, transfer?: Transferable[]) =>
    self.postMessage(msg, { transfer: transfer ?? [] }),
  );
};
