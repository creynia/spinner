// Loading a stored run for the results screens: one cache, the table maximum, run names.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { RunData } from '@core/contracts/run';
import { getCoreRepo, remoteRunName, tableMaxFor } from '../../services/runs';
import { useStore } from '../../state/store';
import { libraryVersion } from '../Define/data';

export { tableMaxFor };

const cache = new Map<string, RunData>();
const CACHE_MAX = 6;

// A library write (a rename) can change what a cached run shows, so drop the cache.
libraryVersion.subscribe(() => cache.clear());

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
  /** A done run that only lives in Drive: the screen shows the `RemoteRunCard`, which downloads it. */
  | { state: 'remote'; name: string; reload: () => void }
  | { state: 'error'; message: string }
  | { state: 'ready'; data: RunData };

export function useRunData(runId: string | undefined): RunDataState {
  const [s, setS] = useState<RunDataState>({ state: 'loading' });
  // A library write (a rename) reloads in place: no loading flash, so the open tab survives.
  const version = useStore(libraryVersion, (v) => v);
  const shown = useRef<string | undefined>(undefined);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    if (shown.current !== runId) setS({ state: 'loading' });
    shown.current = runId;
    if (!runId) {
      setS({ state: 'missing' });
      return;
    }
    loadRunData(runId).then(
      async (data) => {
        if (data) return live && setS({ state: 'ready', data });
        const name = await remoteRunName(runId);
        if (!live) return;
        setS(
          name === null
            ? { state: 'missing' }
            : { state: 'remote', name, reload: () => setNonce((n) => n + 1) },
        );
      },
      (e: unknown) =>
        live && setS({ state: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [runId, version, nonce]);
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
