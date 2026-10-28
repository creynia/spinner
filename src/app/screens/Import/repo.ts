// The core-store repo over the app's backend (import needs `importRun`), or a throwaway memory
// repo when storage is unavailable, so an import still opens for this visit.
import { createMemoryBackend, createRepo, type Repo } from '@core';
import { getBackend, getRepo } from '../../services/db';

let fallback: Repo | null = null;

export async function getStoreRepo(): Promise<Repo> {
  await getRepo();
  const b = getBackend();
  if (b) return createRepo(b);
  fallback ??= createRepo(createMemoryBackend());
  return fallback;
}
