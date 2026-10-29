// What Watch needs from the outside, injectable so tests need no pool, store or worker.
import type { ComponentType } from 'preact';
import type { NormalizedDefinition } from '@core/contracts/experiment';
import type { SessionTrace } from '@core/contracts/strategy-trace';
import type { RunData, SummaryRow } from '@core/contracts/run';
import type { GameUi } from '@core/ui';
import { CORE_VERSION, loadRun, simulate } from '@core';
import { roulette } from '@game/roulette';
import { rouletteUi } from '@game/roulette/ui';
import { getBackend, getRepo } from '../../services/db';
import { getPool } from '../../services/pool';
import { remoteRunName } from '../../services/runs';

export interface SimResult {
  row: SummaryRow;
  trace: SessionTrace;
}

export interface WatchDeps {
  loadRun: (runId: string) => Promise<RunData | null>;
  /** The experiment's name when the run is a done run that only lives in Drive, else null. */
  remoteName?: (runId: string) => Promise<string | null>;
  /** Re-simulate one session with its full trace (determinism makes it exact). */
  simulate: (def: NormalizedDefinition, index: number, schedule: Int32Array) => Promise<SimResult>;
  ui: Pick<GameUi<never>, 'TableView' | 'OutcomeGlyph'> & { TableView: ComponentType<never> };
  resolveRules: (def: NormalizedDefinition) => unknown;
  gameVersion: string;
  coreVersion: string;
}

export const defaultDeps: WatchDeps = {
  async loadRun(runId) {
    await getRepo();
    const backend = getBackend();
    return backend ? loadRun(backend, runId) : null;
  },
  remoteName: remoteRunName,
  async simulate(def, index, schedule) {
    const r = await simulate(getPool(), def, index, schedule);
    return { row: r.row, trace: r.trace };
  },
  ui: rouletteUi as unknown as WatchDeps['ui'],
  resolveRules: (def) => roulette.rules.resolve(def.game.rules),
  gameVersion: roulette.version,
  coreVersion: CORE_VERSION,
};
