// `window.__spinner`: the e2e test hook (architecture.md §6.7). Installed only outside production
// builds or when the URL has `?e2e`. `ping()` proves a real module worker answers under /spinner/.
import { CORE_VERSION } from '@core/contracts/version';
import { SIM_PROTOCOL, type FromSim } from '@core/contracts/protocol';
import { spawnSimWorker } from '../workers/spawn';
import {
  accountSwitchPrompt,
  conflictNotices,
  expireTokenForTest,
  firstSyncError,
  firstSyncPrompt,
  signInError,
  signInRedirectOffer,
  syncAbout,
  syncAuth,
  syncDeviceId,
  syncDevices,
  syncElsewhere,
  syncPrefs,
  syncStatus,
} from './services/sync';

function ping(): Promise<'pong'> {
  return new Promise((resolve, reject) => {
    const transport = spawnSimWorker();
    const timer = setTimeout(() => {
      transport.terminate();
      reject(new Error('worker did not answer ping within 10 s'));
    }, 10_000);
    const done = (fn: () => void): void => {
      clearTimeout(timer);
      transport.terminate();
      fn();
    };
    transport.onMessage((msg: FromSim) => {
      if (msg.t === 'pong') {
        if (msg.protocol !== SIM_PROTOCOL || msg.coreVersion !== CORE_VERSION) {
          done(() => reject(new Error('worker version mismatch: App updated, reload')));
        } else {
          done(() => resolve('pong'));
        }
      } else if (msg.t === 'error') {
        done(() => reject(new Error(`${msg.code}: ${msg.message}`)));
      }
    });
    transport.post({ t: 'ping' });
  });
}

/**
 * `window.__spinnerSync`: the sync stores and the D23 test helper, nothing else. It deliberately
 * has no `signOut`, `removeDriveData` or other action: a browser test drives those through the UI.
 */
const syncHook = {
  syncStatus,
  syncAuth,
  conflictNotices,
  syncPrefs,
  firstSyncPrompt,
  syncDevices,
  syncAbout,
  accountSwitchPrompt,
  firstSyncError,
  signInError,
  signInRedirectOffer,
  syncElsewhere,
  syncDeviceId,
  expireTokenForTest,
};
declare global {
  interface Window {
    __spinnerSync?: typeof syncHook;
  }
}

export function installTestHook(): void {
  if (import.meta.env.MODE === 'production' && !location.search.includes('e2e')) return;
  window.__spinnerSync = syncHook;
  window.__spinner = {
    version: __APP_VERSION__,
    sha: __BUILD_SHA__,
    ping,
    pool: { size: 1 },
  };
}
