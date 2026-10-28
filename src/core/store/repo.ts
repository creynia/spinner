// Library and run records over a `Backend` (harness-data-analysis.md §9.1, §10.2 step 7).
import type { DefinitionRecord, ExperimentGroup, StrategyRecord } from '../contracts/experiment';
import type { LayoutRecord } from '../contracts/layout';
import type { RunData, RunMeta } from '../contracts/run';
import { newRunId } from '../experiment';
import type { Backend } from './backend';
import { loadRun, writeCompacted } from './sink';

export interface ImportResult {
  status: 'imported' | 'exists';
  runId: string;
}

export interface Repo {
  readonly backend: Backend;
  listDefinitions(): Promise<DefinitionRecord[]>;
  getDefinition(id: string): Promise<DefinitionRecord | undefined>;
  putDefinition(rec: DefinitionRecord): Promise<void>;
  listStrategies(): Promise<StrategyRecord[]>;
  getStrategy(id: string): Promise<StrategyRecord | undefined>;
  putStrategy(rec: StrategyRecord): Promise<void>;
  deleteStrategy(id: string): Promise<void>;
  listGroups(): Promise<ExperimentGroup[]>;
  putGroup(g: ExperimentGroup): Promise<void>;
  deleteGroup(id: string): Promise<void>;
  /** Newest first. */
  listRuns(): Promise<RunMeta[]>;
  listRunsOfDefinition(definitionId: string): Promise<RunMeta[]>;
  getRun(runId: string): Promise<RunMeta | undefined>;
  putRun(meta: RunMeta): Promise<void>;
  loadRun(runId: string): Promise<RunData | null>;
  /**
   * Deletes `runs`, `runParts`, `summaries`, `checkpoints`, `breakdowns`, `samples` in one
   * transaction and removes the id from `definitions.runIds` and from groups.
   */
  deleteRun(runId: string): Promise<void>;
  /** §10.2 step 7. Same runId and digest: `exists`; same runId, other digest: a new suffix. */
  importRun(data: RunData, opts?: { origin?: DefinitionRecord['origin'] }): Promise<ImportResult>;
  /** Newest first (`byUpdated`). */
  listLayouts(): Promise<LayoutRecord[]>;
  getLayout(id: string): Promise<LayoutRecord | undefined>;
  putLayout(rec: LayoutRecord): Promise<void>;
  deleteLayout(id: string): Promise<void>;
  getSetting<T>(key: string): Promise<T | undefined>;
  setSetting(key: string, value: unknown): Promise<void>;
}

export function createRepo(backend: Backend): Repo {
  const putOne = (store: Parameters<Backend['tx']>[0][number], value: unknown): Promise<void> =>
    backend.tx([store], 'readwrite', (t) => t.put(store, value));
  const delOne = (store: Parameters<Backend['tx']>[0][number], key: string): Promise<void> =>
    backend.tx([store], 'readwrite', (t) => t.delete(store, key));
  const newestFirst = (a: RunMeta, b: RunMeta): number =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.runId < b.runId ? 1 : -1;

  return {
    backend,
    listDefinitions: async () =>
      (await backend.getAll<DefinitionRecord>('definitions', 'byUpdated')).reverse(),
    getDefinition: (id) => backend.get('definitions', id),
    putDefinition: (rec) => putOne('definitions', rec),
    listStrategies: async () =>
      (await backend.getAll<StrategyRecord>('strategies', 'byUpdated')).reverse(),
    getStrategy: (id) => backend.get('strategies', id),
    putStrategy: (rec) => putOne('strategies', rec),
    deleteStrategy: (id) => delOne('strategies', id),
    listGroups: async () =>
      (await backend.getAll<ExperimentGroup>('groups', 'byUpdated')).reverse(),
    putGroup: (g) => putOne('groups', g),
    deleteGroup: (id) => delOne('groups', id),
    listLayouts: async () => (await backend.getAll<LayoutRecord>('layouts', 'byUpdated')).reverse(),
    getLayout: (id) => backend.get('layouts', id),
    putLayout: (rec) => putOne('layouts', rec),
    deleteLayout: (id) => delOne('layouts', id),
    listRuns: async () => (await backend.getAll<RunMeta>('runs')).sort(newestFirst),
    listRunsOfDefinition: async (definitionId) =>
      (
        await backend.getAll<RunMeta>(
          'runs',
          'byDefinition',
          typeof IDBKeyRange !== 'undefined' ? IDBKeyRange.only(definitionId) : undefined,
        )
      )
        .filter((r) => r.definitionId === definitionId)
        .sort(newestFirst),
    getRun: (runId) => backend.get('runs', runId),
    putRun: (meta) => putOne('runs', meta),
    loadRun: (runId) => loadRun(backend, runId),

    async deleteRun(runId) {
      const meta = await backend.get<RunMeta>('runs', runId);
      const partKeys = await backend.getAllKeys(
        'runParts',
        typeof IDBKeyRange !== 'undefined'
          ? IDBKeyRange.bound([runId, 0], [runId, Infinity])
          : ({
              includes: (k: unknown) => Array.isArray(k) && k[0] === runId,
            } as unknown as IDBKeyRange),
      );
      const def = meta
        ? await backend.get<DefinitionRecord>('definitions', meta.definitionId)
        : undefined;
      const groups = (await backend.getAll<ExperimentGroup>('groups')).filter((g) =>
        g.runIds.includes(runId),
      );
      await backend.tx(
        [
          'runs',
          'runParts',
          'summaries',
          'checkpoints',
          'breakdowns',
          'samples',
          'definitions',
          'groups',
        ],
        'readwrite',
        (t) => {
          for (const s of ['runs', 'summaries', 'checkpoints', 'breakdowns', 'samples'] as const) {
            t.delete(s, runId);
          }
          for (const k of partKeys) t.delete('runParts', k);
          if (def && def.runIds.includes(runId)) {
            t.put('definitions', { ...def, runIds: def.runIds.filter((r) => r !== runId) });
          }
          for (const g of groups) {
            t.put('groups', { ...g, runIds: g.runIds.filter((r) => r !== runId) });
          }
        },
      );
    },

    async importRun(data, opts = {}) {
      let meta = data.meta;
      const have = await backend.get<RunMeta>('runs', meta.runId);
      if (have) {
        if (have.resultsDigest === meta.resultsDigest)
          return { status: 'exists', runId: meta.runId };
        let id = newRunId(meta.definitionId);
        while (await backend.get('runs', id)) id = newRunId(meta.definitionId);
        meta = { ...meta, runId: id };
      }
      // the definition record (with `origin`) is written in the same transaction as the results
      await writeCompacted(backend, { ...data, meta }, meta, opts.origin ?? 'import');
      return { status: 'imported', runId: meta.runId };
    },

    async getSetting<T>(key: string) {
      return (await backend.get<{ key: string; value: T }>('settings', key))?.value;
    },
    setSetting: (key, value) => putOne('settings', { key, value }),
  };
}
