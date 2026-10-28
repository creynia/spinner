// Service worker registration + update flow (architecture.md §8.1). No-op in dev and on
// file:// / content:// (protocol check).

type UpdateListener = (apply: () => void) => void;

let waiting: ServiceWorker | null = null;
let registration: ServiceWorkerRegistration | null = null;
const listeners = new Set<UpdateListener>();
let runActive = false;
const runListeners = new Set<(active: boolean) => void>();

/** The run controller calls this so the toast can say the run will resume after the reload. */
export function setRunActive(active: boolean): void {
  runActive = active;
  runListeners.forEach((l) => l(active));
}

/** Subscribe to the run-active flag; the listener fires once with the current value. */
export function onRunActive(listener: (active: boolean) => void): () => void {
  runListeners.add(listener);
  listener(runActive);
  return () => runListeners.delete(listener);
}

function applyUpdate(): void {
  waiting?.postMessage('SKIP_WAITING');
}

function notify(worker: ServiceWorker): void {
  waiting = worker;
  listeners.forEach((l) => l(applyUpdate));
}

/** Subscribe to "a new version is ready"; call `apply()` to activate it (page then reloads). */
export function onUpdateAvailable(listener: UpdateListener): () => void {
  listeners.add(listener);
  if (waiting) listener(applyUpdate);
  return () => listeners.delete(listener);
}

export type UpdateCheck = 'unsupported' | 'update-available' | 'up-to-date' | 'failed';

/**
 * Settings → "Check for updates". Asks the browser to re-fetch sw.js and resolves with the
 * outcome ('unsupported' in dev, file:// and browsers without SW).
 * When an update is found the onUpdateAvailable listeners fire (toast), as for the automatic check.
 */
export async function checkForUpdates(): Promise<UpdateCheck> {
  if (!registration) return 'unsupported';
  try {
    await registration.update();
    const found = registration.waiting ?? registration.installing;
    if (!found || !navigator.serviceWorker.controller) return 'up-to-date';
    if (found.state === 'installed') notify(found);
    else
      await new Promise<void>((done) => {
        found.addEventListener('statechange', () => {
          if (found.state === 'installed') notify(found);
          if (found.state === 'installed' || found.state === 'redundant') done();
        });
      });
    return waiting ? 'update-available' : 'up-to-date';
  } catch {
    return 'failed';
  }
}

export function registerSW(): void {
  if (import.meta.env.DEV) return;
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.protocol !== 'http:') return;

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !waiting) return; // first claim on a fresh install: don't reload
    reloading = true;
    location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        registration = reg;
        if (reg.waiting && navigator.serviceWorker.controller) notify(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          installing?.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              notify(installing);
            }
          });
        });
      })
      .catch(() => {
        /* offline support is best-effort */
      });
  });
}
