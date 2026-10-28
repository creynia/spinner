// Define/Library data access: the core store repo (library of definitions and strategies), the
// Quick check runner, Dry run and share links. Storage falls back to memory like the rest of the app.
import type {
  DefinitionRecord,
  ExperimentDefinition,
  NormalizedDefinition,
  StrategyRecord,
} from '@core/contracts/experiment';
import type { StrategyDefinition } from '@core/contracts/strategy';
import {
  createMemoryBackend,
  createRunController,
  createRunSink,
  definitionId,
  encodeShareLink,
  exportDefinitionFile,
  runMetrics,
  type Repo,
} from '@core';
import { canonicalJson } from '@core/experiment';
import { game } from '../../services/game';
import { getPool } from '../../services/pool';
import { activeRun, DRY_RUN_TAG, getCoreRepo, startRun } from '../../services/runs';
import { setQuickCheckRunner } from '../../services/quickCheck';
import { verdictFromMetrics, type VerdictInput } from '../../services/verdict';
import { createStore } from '../../state/store';

/** The library repo: the same one the run service writes to (services/runs). */
export const libraryRepo = (): Promise<Repo> => getCoreRepo();

/** Bumped after every library write so lists reload. */
export const libraryVersion = createStore(0);
const touch = () => libraryVersion.update((v) => v + 1);

export async function saveDefinition(
  d: NormalizedDefinition,
  opts: { derivedFrom?: string; origin?: DefinitionRecord['origin'] } = {},
): Promise<string> {
  const repo = await libraryRepo();
  const id = await definitionId(d);
  const now = new Date().toISOString();
  const have = await repo.getDefinition(id);
  const rec: DefinitionRecord = have
    ? { ...have, updatedAt: now }
    : {
        v: 1,
        id,
        definition: d,
        createdAt: now,
        updatedAt: now,
        origin: opts.origin ?? 'user',
        runIds: [],
        ...(opts.derivedFrom && opts.derivedFrom !== id ? { derivedFrom: opts.derivedFrom } : {}),
      };
  await repo.putDefinition(rec);
  touch();
  return id;
}

export async function deleteDefinition(id: string): Promise<void> {
  const repo = await libraryRepo();
  await repo.backend.tx(['definitions'], 'readwrite', (t) => t.delete('definitions', id));
  touch();
}

async function strategyHash(s: StrategyDefinition): Promise<string> {
  return definitionHash(canonicalJson(s as never));
}
async function definitionHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Saves a strategy to the library, one record per strategy id (edits update it). */
export async function saveStrategy(s: StrategyDefinition): Promise<string> {
  const repo = await libraryRepo();
  const now = new Date().toISOString();
  const have = await repo.getStrategy(s.id);
  const rec: StrategyRecord = {
    v: 1,
    id: s.id,
    strategy: s,
    hash: await strategyHash(s),
    createdAt: have?.createdAt ?? now,
    updatedAt: now,
    ...(have?.derivedFrom ? { derivedFrom: have.derivedFrom } : {}),
  };
  await repo.putStrategy(rec);
  touch();
  return s.id;
}

export async function deleteStrategy(id: string): Promise<void> {
  await (await libraryRepo()).deleteStrategy(id);
  touch();
}

export async function loadDefinitionOfRun(runId: string): Promise<NormalizedDefinition | null> {
  const repo = await libraryRepo();
  const meta = await repo.getRun(runId);
  if (!meta) return null;
  return (await repo.getDefinition(meta.definitionId))?.definition ?? null;
}

// ------------------------------------------------------------------ quick check

export const QUICK_SESSIONS = 200;
const RATE_KEY = 'spinner:rounds-per-sec';

/** Measured rounds per second on this device (from the last Quick check), if any. */
export function measuredRate(): number | null {
  try {
    const v = Number(localStorage.getItem(RATE_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function rememberRate(r: number): void {
  try {
    localStorage.setItem(RATE_KEY, String(Math.round(r)));
  } catch {
    // storage unavailable
  }
}

/** Runs the sessions on the pool into a throwaway memory sink; nothing is stored. */
async function localQuickCheck(d: NormalizedDefinition, sessions: number): Promise<VerdictInput> {
  const def: NormalizedDefinition = {
    ...d,
    run: { ...d.run, sessions, sampleSessions: 0 },
  };
  const sink = createRunSink(createMemoryBackend());
  const t0 = performance.now();
  const c = createRunController({
    definition: def,
    plugin: game.plugin,
    pool: getPool(),
    sink,
    locks: null,
  });
  const done = c.settled();
  await c.start();
  const status = await done;
  if (status !== 'done') throw new Error(c.error?.message ?? `The check ended early (${status}).`);
  const data = await sink.load(c.runId);
  if (!data) throw new Error('The check produced no results.');
  const rules = game.plugin.rules.resolve(def.game.rules);
  const tableMax = game.plugin.limits('outside', rules)?.max;
  const m = runMetrics(data, tableMax === undefined ? {} : { tableMax });
  const seconds = (performance.now() - t0) / 1000;
  const rounds = Array.from(data.summary.roundsPlayed).reduce((a, b) => a + b, 0);
  if (seconds > 0 && rounds > 0) rememberRate(rounds / seconds);
  return verdictFromMetrics(m);
}

let installed = false;
/**
 * services/quickCheck holds the runner; Define installs the pool-backed one when the screen loads.
 */
export function installQuickCheck(): void {
  if (installed) return;
  installed = true;
  setQuickCheckRunner(localQuickCheck);
}

// ------------------------------------------------------------------ dry run

/**
 * Dry runs are transient: the run id is remembered (module variable mirrored in localStorage), the
 * previous dry run is deleted when a new one starts, and the Library hides them by run id. Nothing
 * is ever matched by definition id (runs started without keys share an empty one).
 */
const DRY_KEY = 'spinner:dry-runs';
let dryIds: string[] | null = null;

function readDry(): string[] {
  if (dryIds) return dryIds;
  try {
    const v: unknown = JSON.parse(localStorage.getItem(DRY_KEY) ?? '[]');
    dryIds = Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string' && x !== '')
      : [];
  } catch {
    dryIds = [];
  }
  return dryIds;
}
function writeDry(ids: string[]): void {
  dryIds = ids;
  try {
    localStorage.setItem(DRY_KEY, JSON.stringify(ids));
  } catch {
    // storage unavailable: the module variable still holds it for this page view
  }
}

export const isDryRunId = (runId: string): boolean => runId !== '' && readDry().includes(runId);
export function markDryRun(runId: string): void {
  if (runId !== '' && !readDry().includes(runId)) writeDry([...readDry(), runId]);
}

/** Deletes the remembered dry runs (only those run ids) and their own definition records. */
export async function purgeDryRuns(): Promise<void> {
  const ids = readDry();
  if (ids.length === 0) return;
  const repo = await libraryRepo();
  for (const runId of ids) {
    try {
      const meta = await repo.getRun(runId);
      await repo.deleteRun(runId);
      const defId = meta?.definitionId;
      if (defId) {
        const rec = await repo.getDefinition(defId);
        if (
          rec &&
          rec.runIds.length === 0 &&
          (await repo.listRunsOfDefinition(defId)).length === 0 &&
          rec.definition.name.startsWith('Dry run: ')
        ) {
          await repo.backend.tx(['definitions'], 'readwrite', (t) =>
            t.delete('definitions', defId),
          );
        }
      }
    } catch {
      // already gone
    }
  }
  writeDry([]);
  touch();
}

/** A one-session run of the same definition and seed; resolves with its run id once it has finished. */
export async function startDryRun(d: NormalizedDefinition): Promise<string> {
  await purgeDryRuns();
  const dry: NormalizedDefinition = {
    ...d,
    name: `Dry run: ${d.name}`,
    tags: [...new Set([...(d.tags ?? []), DRY_RUN_TAG])].sort(),
    run: { ...d.run, sessions: 1, sampleSessions: 1 },
  };
  const runId = await startRun(dry);
  markDryRun(runId);
  await new Promise<void>((resolve) => {
    let off = (): void => undefined;
    const timer = setTimeout(() => {
      off();
      resolve();
    }, 8000);
    off = activeRun.subscribe((p) => {
      if (p === null || p.runId !== runId) {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
    if (activeRun.get() === null || activeRun.get()?.runId !== runId) {
      clearTimeout(timer);
      off();
      resolve();
    }
  });
  return runId;
}

// ------------------------------------------------------------------ sharing

export type ShareResult = { link: string } | { file: string; chars: number };

export async function shareOf(d: ExperimentDefinition): Promise<ShareResult> {
  const r = await encodeShareLink(d as NormalizedDefinition);
  if ('hash' in r) {
    const base = typeof location !== 'undefined' ? location.href.split('#')[0] : '';
    return { link: `${base}${r.hash}` };
  }
  return { file: exportDefinitionFile(d), chars: r.chars };
}
