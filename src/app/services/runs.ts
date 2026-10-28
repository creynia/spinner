// Runs (architecture.md §6.4): what Home and the nav chip need. Listing never throws: a run whose
// results cannot be read yet shows its status line instead of a verdict. startRun/resumeRun wire
// the harness controller; progress is published to `activeRun`.
import type { NormalizedDefinition } from '@core/contracts/experiment';
import type { RunController, RunMeta, RunProgress, RunSink } from '@core/contracts/run';
import { createRunController, createRunSink, runMetrics } from '@core';
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

const controllers = new Map<string, RunController>();
let sinkFactory: (() => Promise<RunSink>) | null = null;
/** Tests and integration can swap how the sink is built. */
export function setSinkFactory(f: (() => Promise<RunSink>) | null): void {
  sinkFactory = f;
}

async function loadVerdict(meta: RunMeta, sink: RunSink | null): Promise<RunVerdict | null> {
  if (meta.status !== 'done' || !sink) return null;
  try {
    const data = await sink.load(meta.runId);
    if (!data) return null;
    const d = data.definition.session;
    return {
      ...verdictFromMetrics(runMetrics(data)),
      roundsPerSession: d.maxRounds,
      roundsPerHour: d.roundsPerHour,
    };
  } catch {
    return null;
  }
}

/** Most recent first. `definitionNames` maps definitionId -> name. */
export async function listRecentRuns(limit = 5): Promise<RunListItem[]> {
  const repo = await getRepo();
  const [runs, defs] = await Promise.all([repo.listRuns(), repo.listDefinitions()]);
  const names = new Map(defs.map((d) => [d.id, d.definition.name]));
  let sink: RunSink | null = null;
  try {
    sink = await getSink();
  } catch {
    sink = null;
  }
  const top = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  const items = await Promise.all(
    top.map(async (m): Promise<RunListItem> => ({
      runId: m.runId,
      name: names.get(m.definitionId) ?? 'Untitled experiment',
      status: m.status,
      interrupted: m.interrupted === true,
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

function attach(c: RunController): void {
  controllers.set(c.runId, c);
  c.subscribe((p) => {
    activeRun.set(p.status === 'running' || p.status === 'queued' ? p : null);
    if (p.status === 'done' || p.status === 'paused' || p.status === 'error') void refreshRuns();
  });
}

async function getSink(): Promise<RunSink> {
  if (sinkFactory) return sinkFactory();
  await getRepo();
  const backend = getBackend();
  if (!backend) throw new Error('The result store is not available yet.');
  return createRunSink(backend);
}

export async function startRun(definition: NormalizedDefinition): Promise<string> {
  const c = createRunController({
    definition,
    plugin: game.plugin as never,
    pool: getPool(),
    sink: await getSink(),
  });
  attach(c);
  await c.start();
  return c.runId;
}

export async function resumeRun(runId: string): Promise<void> {
  await controllers.get(runId)?.resume();
}
export async function pauseRun(runId: string): Promise<void> {
  await controllers.get(runId)?.pause();
}
export async function cancelRun(runId: string): Promise<void> {
  await controllers.get(runId)?.cancel();
}
