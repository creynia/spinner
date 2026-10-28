// Loading a stored run for the results screens: one cache, the table maximum, run names.
import { useEffect, useState } from 'preact/hooks';
import type { RunData } from '@core/contracts/run';
import { getCoreRepo, tableMaxFor } from '../../services/runs';

export { tableMaxFor };

const cache = new Map<string, RunData>();
const CACHE_MAX = 6;

export function clearRunCache(runId?: string): void {
  if (runId) cache.delete(runId);
  else cache.clear();
}

/** Done runs are immutable, so they are cached; partial runs are always re-read. */
export async function loadRunData(runId: string): Promise<RunData | null> {
  const hit = cache.get(runId);
  if (hit) return hit;
  const data = await (await getCoreRepo()).loadRun(runId);
  if (data && data.meta.status === 'done') {
    cache.set(runId, data);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  }
  return data;
}

export type RunDataState =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'error'; message: string }
  | { state: 'ready'; data: RunData };

export function useRunData(runId: string | undefined): RunDataState {
  const [s, setS] = useState<RunDataState>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    setS({ state: 'loading' });
    if (!runId) {
      setS({ state: 'missing' });
      return;
    }
    loadRunData(runId).then(
      (data) => live && setS(data ? { state: 'ready', data } : { state: 'missing' }),
      (e: unknown) =>
        live && setS({ state: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [runId]);
  return s;
}

export function NotFoundCard({ what, message }: { what: string; message?: string }) {
  return (
    <section class="card" role="alert">
      <h2>{what} not found</h2>
      <p class="muted">
        {message ??
          'It may have been deleted, or it lives in another browser. Import a run file to bring it here.'}
      </p>
      <p>
        <a class="btn btn-secondary" href="#/library">
          Open the library
        </a>
      </p>
    </section>
  );
}
