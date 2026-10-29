// Runs (architecture.md §6.4): what Home and the nav chip need. Listing never throws: a run whose
// results cannot be read yet shows its status line instead of a verdict. startRun/resumeRun wire
// the harness controller; progress is published to `activeRun`.
import type { DefinitionRecord, NormalizedDefinition } from '@core/contracts/experiment';
import type { RunMeta, RunProgress, RunSink } from '@core/contracts/run';
import {
  CORE_VERSION,
  createMemoryBackend,
  createRepo,
  createRunController,
  createRunSink,
  definitionId as hashDefinition,
  isRunLockedElsewhere,
  newRunId,
  resultsDigest,
  runKey as hashRunKey,
  runMetrics,
  simKey as hashSimKey,
  type Backend,
  type HarnessRunController,
  type Repo as CoreRepo,
  experimentName,
} from '@core';
import { setRunActive } from '../../pwa/register';
import { createStore } from '../state/store';
import { getBackend, getRepo } from './db';
import { game } from './game';
import { getPool } from './pool';
import { verdictFromMetrics, type VerdictInput } from './verdict';

export type RunVerdict = VerdictInput & { roundsPerSession: number; roundsPerHour: number };

export interface RunListItem {
  runId: string;
  name: string;
  status: RunMeta['status'];
  interrupted: boolean;
  createdAt: string;
  sessions: number;
  completedSessions: number;
  /** Verdict numbers, or null until the run is done (or its results cannot be read). */
  verdict: RunVerdict | null;
}

export const activeRun = createStore<RunProgress | null>(null);
export const recentRuns = createStore<RunListItem[]>([]);

const controllers = new Map<string, HarnessRunController>();
const fallbackBackend: Backend = createMemoryBackend();
let sinkFactory: (() => Promise<RunSink>) | null = null;
/** Tests and integration can swap how the sink is built. */
export function setSinkFactory(f: (() => Promise<RunSink>) | null): void {
  sinkFactory = f;
}

/** Finished runs never change, so a verdict is computed once per run id per page load. */
const verdictCache = new Map<string, RunVerdict>();
export function clearVerdictCache(): void {
  verdictCache.clear();
}

/** Even-money table maximum for the definition's rules, cents (always passed to runMetrics). */
export function tableMaxFor(def: NormalizedDefinition): number | undefined {
  try {
    const rules = game.plugin.rules.resolve(def.game.rules);
    return game.plugin.limits('outside', rules)?.max;
  } catch {
    return undefined;
  }
}

async function loadVerdict(meta: RunMeta, sink: RunSink | null): Promise<RunVerdict | null> {
  if (meta.status !== 'done') return null;
  const cached = verdictCache.get(meta.runId);
  if (cached) return cached;
  if (!sink) return null;
  try {
    const data = await sink.load(meta.runId);
    if (!data) return null;
    const d = data.definition.session;
    const v: RunVerdict = {
      ...verdictFromMetrics(runMetrics(data, { tableMax: tableMaxFor(data.definition) })),
      roundsPerSession: d.maxRounds,
      roundsPerHour: d.roundsPerHour,
    };
    verdictCache.set(meta.runId, v);
    return v;
  } catch {
    return null;
  }
}

/** Dry runs (Define's one-session Watch runs) carry this tag on their definition. */
export const DRY_RUN_TAG = 'dry-run';

/** Ids of definitions tagged as dry runs; their runs stay out of lists and pickers. */
export async function dryRunDefinitionIds(): Promise<Set<string>> {
  const defs = await (await getCoreRepo()).listDefinitions();
  return new Set(defs.filter((d) => d.definition.tags?.includes(DRY_RUN_TAG)).map((d) => d.id));
}

/** Most recent first, dry runs excluded. */
export async function listRecentRuns(limit = 5): Promise<RunListItem[]> {
  const repo = await getRepo();
  const [all, defs] = await Promise.all([repo.listRuns(), repo.listDefinitions()]);
  const dry = new Set(
    defs.filter((d) => d.definition.tags?.includes(DRY_RUN_TAG)).map((d) => d.id),
  );
  const runs = all
    .filter((m) => !dry.has(m.definitionId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const names = new Map(defs.map((d) => [d.id, experimentName(d)]));
  // Only the newest `limit` runs are touched; their verdicts are cached per run id.
  const top = runs.slice(0, limit);
  let sink: RunSink | null = null;
  if (top.some((m) => m.status === 'done' && !verdictCache.has(m.runId))) {
    try {
      sink = await getSink();
    } catch {
      sink = null;
    }
  }
  const items = await Promise.all(
    top.map(async (m): Promise<RunListItem> => ({
      runId: m.runId,
      name: names.get(m.definitionId) ?? 'Untitled experiment',
      status: m.status,
      interrupted: m.interrupted === true || (await looksInterrupted(m)),
      createdAt: m.createdAt,
      sessions: m.sessions,
      completedSessions: m.completedSessions,
      verdict: await loadVerdict(m, sink),
    })),
  );
  return items;
}

export async function refreshRuns(): Promise<void> {
  try {
    recentRuns.set(await listRecentRuns(5));
  } catch {
    recentRuns.set([]);
  }
}

/** Runs that can be resumed: paused, or interrupted while running. */
export function isResumable(r: Pick<RunListItem, 'status' | 'interrupted'>): boolean {
  return (
    r.status === 'paused' || (r.interrupted && r.status !== 'done' && r.status !== 'cancelled')
  );
}

/** A run the store calls running/queued although no controller in this page drives it. */
async function looksInterrupted(m: RunMeta): Promise<boolean> {
  if (m.status !== 'running' && m.status !== 'queued') return false;
  if (controllers.has(m.runId)) return false;
  try {
    return !(await isRunLockedElsewhere(m.runId));
  } catch {
    return true;
  }
}

/** The backend results live in: the store, or an in-memory one when storage is unavailable. */
async function dataBackend(): Promise<Backend> {
  await getRepo();
  return getBackend() ?? fallbackBackend;
}

/** `core/store`'s repo (runs, definitions, groups, loadRun...), never null. */
export async function getCoreRepo(): Promise<CoreRepo> {
  return createRepo(await dataBackend());
}

async function getSink(): Promise<RunSink> {
  if (sinkFactory) return sinkFactory();
  return createRunSink(await dataBackend());
}

/** Live controllers by run id (this page only). */
export function getController(runId: string): HarnessRunController | undefined {
  return controllers.get(runId);
}

let activeCount = 0;
/** Register a controller: progress goes to `activeRun`, `setRunActive` tracks running runs. */
export function adoptController(c: HarnessRunController): void {
  if (controllers.get(c.runId) === c) return;
  controllers.set(c.runId, c);
  let running = false;
  c.subscribe((p) => {
    const live = p.status === 'running' || p.status === 'queued';
    if (live !== running) {
      running = live;
      activeCount += live ? 1 : -1;
      setRunActive(activeCount > 0);
    }
    if (live) activeRun.set(p);
    else if (activeRun.get()?.runId === p.runId) activeRun.set(null);
    if (p.status === 'done' || p.status === 'paused' || p.status === 'error') void refreshRuns();
  });
}

export interface StartOptions {
  /** Called with the controller before it starts (e.g. to queue sweeps). */
  onController?: (c: HarnessRunController) => void;
}

/** Stable identity of a definition for this app version. */
export async function runKeys(definition: NormalizedDefinition) {
  const definitionId = await hashDefinition(definition);
  const simKey = await hashSimKey(definition, game.plugin.version, CORE_VERSION);
  const runKey = await hashRunKey(definitionId, game.plugin.version, CORE_VERSION);
  return { definitionId, simKey, runKey };
}

/** Make sure the definition is in the library and lists the run. */
async function recordRun(
  repo: CoreRepo,
  definition: NormalizedDefinition,
  runId: string,
  id: string,
) {
  const now = new Date().toISOString();
  const have = await repo.getDefinition(id);
  const rec: DefinitionRecord = have ?? {
    v: 1,
    id,
    definition,
    createdAt: now,
    updatedAt: now,
    origin: 'user',
    runIds: [],
  };
  await repo.putDefinition({ ...rec, updatedAt: now, runIds: [...rec.runIds, runId] });
}

function build(
  definition: NormalizedDefinition,
  keys: Awaited<ReturnType<typeof runKeys>>,
  sink: RunSink,
  runId?: string,
) {
  return createRunController({
    definition,
    plugin: game.plugin,
    pool: getPool(),
    sink,
    keys,
    runId: runId ?? newRunId(keys.definitionId),
    appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0',
    digest: resultsDigest,
  });
}

/**
 * Create and start a run (keyed: definition id, sim key, run key, digest, app version) and return
 * its id as soon as the workers are initialised. The caller navigates to `#/run/:runId`.
 */
export async function startRun(
  definition: NormalizedDefinition,
  opts: StartOptions = {},
): Promise<string> {
  const keys = await runKeys(definition);
  const c = build(definition, keys, await getSink());
  adoptController(c);
  opts.onController?.(c);
  try {
    await recordRun(await getCoreRepo(), definition, c.runId, keys.definitionId);
  } catch {
    // the run still works without a library record
  }
  await c.start();
  return c.runId;
}

/** Rebuild a controller from the stored run (after a reload) and resume it. */
export async function resumeStored(runId: string): Promise<void> {
  const live = controllers.get(runId);
  if (live) return live.resume();
  const data = await (await getCoreRepo()).loadRun(runId);
  if (!data) throw new Error('That run is not in this browser.');
  const m = data.meta;
  const keys = { definitionId: m.definitionId, simKey: m.simKey, runKey: m.runKey };
  const c = build(data.definition, keys, await getSink(), runId);
  adoptController(c);
  await c.resume();
}

export async function resumeRun(runId: string): Promise<void> {
  await resumeStored(runId);
}
export async function pauseRun(runId: string): Promise<void> {
  await controllers.get(runId)?.pause();
}
export async function cancelRun(runId: string): Promise<void> {
  await controllers.get(runId)?.cancel();
}

/** Run meta with the interrupted flag resolved (see `looksInterrupted`). Null when unknown. */
export async function readRunMeta(runId: string): Promise<RunMeta | null> {
  const meta = (await (await getCoreRepo()).getRun(runId)) ?? null;
  if (!meta) return null;
  if (await looksInterrupted(meta)) return { ...meta, status: 'paused', interrupted: true };
  return meta;
}
