/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Google OAuth client id (public by design); overrides the committed default (sync.md §12). */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}
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
