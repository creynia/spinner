// Library lists for Home: recent definitions (and refresh). Runs live in services/runs.
import type { DefinitionRecord } from '@core/contracts/experiment';
import { getRepo } from '../services/db';
import { DRY_RUN_TAG, refreshRuns } from '../services/runs';
import { createStore } from './store';

export const recentDefinitions = createStore<DefinitionRecord[]>([]);
/** False until the first load finishes, so screens can tell "loading" from "empty". */
export const libraryLoaded = createStore(false);

export async function refreshLibrary(): Promise<void> {
  try {
    const defs = await (await getRepo()).listDefinitions();
    recentDefinitions.set(
      defs
        .filter((d) => !d.definition.tags?.includes(DRY_RUN_TAG))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 5),
    );
  } catch {
    recentDefinitions.set([]);
  }
  await refreshRuns();
  libraryLoaded.set(true);
}
