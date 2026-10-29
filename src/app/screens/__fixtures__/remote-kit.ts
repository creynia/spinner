// Test kit for the WP-S5b consumer tests: a run that is only in Drive (a stub plus a library
// without its results) and a stub-only paused run, behind a mocked sync service. Used as
//   vi.mock('../../services/sync', async (orig) => (await import('../__fixtures__/remote-kit')).syncMock(await orig()))
// Not part of the app bundle.
import type { RunData } from '@core/contracts/run';
import type { RunStub } from '@core';
import { evictRunResults } from '@core';
import { makeRun } from '../../../core/store/__fixtures__/synth';
import { getCoreRepo } from '../../services/runs';
import { createStore } from '../../state/store';

export interface RemoteWorld {
  stubs: RunStub[];
  /** Run ids `downloadRun` was called for, in order. */
  downloads: string[];
  evicted: string[];
  /** Every `evictRun` call, refused or not. */
  evictCalls: number;
  reuploaded: string[];
  /** What a successful download does (the test puts the results on the device). */
  onDownload: (runId: string) => Promise<void>;
  evictError: string | null;
  /** What `downloadRun` answers (default 'ok'; anything else downloads nothing). */
  downloadResult:
    ((runId: string) => 'ok' | 'offline' | 'needs-auth' | 'missing' | 'corrupt') | null;
}

export const world: RemoteWorld = {
  stubs: [],
  downloads: [],
  evicted: [],
  evictCalls: 0,
  reuploaded: [],
  onDownload: () => Promise.resolve(),
  evictError: null,
  downloadResult: null,
};

export function resetWorld(): void {
  world.stubs = [];
  world.downloads = [];
  world.evicted = [];
  world.evictCalls = 0;
  world.reuploaded = [];
  world.onDownload = () => Promise.resolve();
  world.evictError = null;
  world.downloadResult = null;
}

/** The mock of `services/sync`: everything real except the five calls that need a Drive. */
const devices = createStore<
  { id: string; name: string; lastSyncedAt: string; appVersion: string }[]
>([]);

export function syncMock<T extends object>(orig: T): T {
  // the kit must not import the module it mocks (the mock factory would wait on itself)
  return {
    ...orig,
    syncDevices: devices,
    listRemoteRuns: () => Promise.resolve(world.stubs.slice()),
    remoteRun: (id: string) => Promise.resolve(world.stubs.find((s) => s.runId === id) ?? null),
    downloadRun: async (id: string) => {
      world.downloads.push(id);
      const r = world.downloadResult?.(id) ?? 'ok';
      if (r === 'ok') await world.onDownload(id);
      return r;
    },
    evictRun: async (id: string) => {
      world.evictCalls++;
      if (world.evictError) throw new Error(world.evictError);
      world.evicted.push(id);
      await evictRunResults((await getCoreRepo()).backend, id);
    },
    reuploadRun: (id: string) => {
      world.reuploaded.push(id);
      return Promise.resolve('uploaded' as const);
    },
  };
}

export function stubOf(data: RunData, over: Partial<RunStub> = {}): RunStub {
  const m = data.meta;
  return {
    runId: m.runId,
    definitionId: m.definitionId,
    simKey: m.simKey,
    runKey: m.runKey,
    status: m.status,
    sessions: m.sessions,
    completedSessions: m.completedSessions,
    prefixSessions: m.prefixSessions,
    createdAt: m.createdAt,
    appVersion: '1',
    gameId: 'roulette',
    gameVersion: m.gameVersion,
    coreVersion: m.coreVersion,
    ...(m.resultsDigest ? { resultsDigest: m.resultsDigest } : {}),
    verdict: {
      meanNet: -4100,
      halfWidth: 600,
      pAhead: 0.38,
      pBust: 0.1,
      n: m.sessions,
      roundsPerSession: 20,
      roundsPerHour: 40,
    },
    owner: 'dev-a',
    extra: { device: { cores: 1, workers: 1, ua: 'x' }, timing: { elapsedMs: 1 }, resumes: [] },
    bundle: { name: `run.${m.runId}.x.spinner.json.gz`, bytes: 1_800_000, sha256: 'ab' },
    ...over,
  };
}

export interface Seeded {
  data: RunData;
  /** The done run: its results are NOT on this device, only the stub. */
  remote: RunStub;
  /** A paused run of the same definition on another device: a stub, no bundle. */
  paused: RunStub;
  name: string;
}

/**
 * Imports a finished run, then drops its results ("Remove download") so it is remote-only, and
 * adds a stub-only paused run of the same definition. `world.onDownload` puts the results back.
 */
export async function seedRemote(n = 0, name = `Remote exp ${n}`): Promise<Seeded> {
  resetWorld();
  devices.set([{ id: 'dev-a', name: 'Laptop', lastSyncedAt: '', appVersion: '1' }]);
  const base = await makeRun({
    sessions: 12,
    maxRounds: 20,
    chunkSize: 4,
    samples: 2,
    seed: 7 + n,
    name,
  });
  const data: RunData = { ...base, meta: { ...base.meta, runId: `${base.meta.runId}-r${n}` } };
  const repo = await getCoreRepo();
  await repo.importRun(data);
  const rec = await repo.getDefinition(data.meta.definitionId);
  // the run id the definition lists must be the one we renamed to
  await repo.backend.tx(['definitions'], 'readwrite', (t) =>
    t.put('definitions', { ...rec!, runIds: [data.meta.runId, `${data.meta.runId}-paused`] }),
  );
  await repo.renameDefinition(data.meta.definitionId, name);
  await evictRunResults(repo.backend, data.meta.runId);
  world.onDownload = async () => void (await (await getCoreRepo()).importRun(data));
  const remote = stubOf(data);
  const paused = stubOf(data, {
    runId: `${data.meta.runId}-paused`,
    runKey: `${data.meta.runKey}p`,
    simKey: `${data.meta.simKey}p`,
    status: 'paused',
    completedSessions: 5,
    prefixSessions: 5,
    createdAt: new Date(Date.parse(data.meta.createdAt) + 1000).toISOString(),
  });
  delete (paused as { bundle?: unknown }).bundle;
  delete (paused as { resultsDigest?: unknown }).resultsDigest;
  delete (paused as { verdict?: unknown }).verdict;
  world.stubs = [remote, paused];
  return { data, remote, paused, name };
}
