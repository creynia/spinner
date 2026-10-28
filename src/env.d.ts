/// <reference types="vite/client" />
declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;

/** Test hook (architecture.md §6.7): present only in non-production builds or with `?e2e`. */
interface SpinnerTestHook {
  version: string;
  sha: string;
  /** Spawns a real module worker, sends `ping`, resolves 'pong' after checking versions. */
  ping(): Promise<'pong'>;
  pool: { size: number };
}
interface Window {
  __spinner?: SpinnerTestHook;
}
