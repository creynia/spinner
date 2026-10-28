// Shown when IndexedDB is unavailable, blocked or full (architecture.md §6.3). Dismissible.
import { dismissStorageBanner, storageStatus } from '../services/db';
import { useStore } from '../state/store';

export const STORAGE_BANNER_TEXT =
  'Results are kept in memory only on this device. Export runs to keep them.';

export function StorageBanner() {
  const s = useStore(storageStatus, (v) => v);
  if (s.state === 'ok' || s.dismissed) return null;
  return (
    <div class="banner" role="status" data-storage-banner>
      <span>{STORAGE_BANNER_TEXT}</span>
      <button type="button" class="btn btn-ghost" onClick={dismissStorageBanner}>
        Dismiss
      </button>
    </div>
  );
}
