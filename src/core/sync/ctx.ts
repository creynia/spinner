// The seam between the engine (WP-S2b: engine.ts, apply/push helpers) and the parts WP-S2c owns
// (runs.ts, gc.ts, first.ts, erase.ts). S2b builds one `SyncCtx` per cycle and passes it in, so
// the two packages work in parallel against frozen signatures. FROZEN with WP-S0.
import type { DeviceId, RemoteStore } from '../contracts/sync';
import type { HlcClock } from './hlc';
import type { SyncBackend, SyncEngineDeps } from './engine';

export interface SyncCtx {
  /** Tracked backend; use `backend.raw` for writes that must leave no dirty mark. */
  backend: SyncBackend;
  remote: RemoteStore;
  clock: HlcClock;
  deviceId: DeviceId;
  /** The persistent, monotone `syncMeta.vvCounter` (N1, S-B). */
  vv: {
    /** Consume a fresh value (in memory; becomes durable at `reserve`). */
    next(): number;
    /** Persist the counter. Must complete before any upload that carries consumed values. */
    reserve(): Promise<void>;
  };
  deps: SyncEngineDeps;
}
