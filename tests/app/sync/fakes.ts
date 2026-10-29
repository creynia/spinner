/* eslint-disable @typescript-eslint/unbound-method -- async stubs and fake method tables */
// Typed access to tests/e2e/fakes/* from the app test project. tsconfig.app.json does not list
// tests/e2e (it belongs to the node project), and a composite project may not import files outside
// its list, so the fakes are loaded by a computed path and described structurally here.
import { join } from 'node:path';

export interface FakeDriveOptions {
  tokens?: Set<string>;
  acceptToken?: (t: string) => boolean;
  pageSize?: number;
  fault?: (method: string, url: URL) => Response | undefined;
  email?: string;
  omitRange?: boolean;
}
export interface FakeDrive {
  fetch: typeof fetch;
  files: Map<string, { id: string; name: string; bytes: Uint8Array }>;
  sessions: Map<string, { got: Uint8Array[] }>;
  tokens: Set<string>;
  log: { method: string; path: string; query: string; auth: string }[];
  set<K extends keyof FakeDriveOptions>(k: K, v: FakeDriveOptions[K]): void;
  expireSession(id?: string): void;
}
export interface GisFakeControls {
  mode: 'grant' | 'blocked' | 'closed' | 'hang' | 'denied' | 'noscope';
  calls: { prompt?: string; login_hint?: string }[];
  revoked: string[];
  issued: string[];
  expiresIn: number;
}

// import.meta.url is not a file URL under happy-dom, so the repo root comes from the cwd (vitest runs there).
const dir = join(process.cwd(), 'tests/e2e/fakes');
const drive = (await import(/* @vite-ignore */ join(dir, 'drive-server.ts'))) as {
  createFakeDrive(o?: FakeDriveOptions): FakeDrive;
};
const gis = (await import(/* @vite-ignore */ join(dir, 'gis-fake.ts'))) as {
  installGisFake(): GisFakeControls;
  gisFakeScript(): string;
  isFakeToken(t: string): boolean;
};
const auth = (await import(/* @vite-ignore */ join(dir, 'auth-page.ts'))) as {
  consentRedirect(
    url: URL,
    n: number,
    o?: { outcome?: string; error?: string; tokenPrefix?: string },
  ): string;
};

export const createFakeDrive = drive.createFakeDrive;
export const installGisFake = gis.installGisFake;
export const gisFakeScript = gis.gisFakeScript;
export const isFakeToken = gis.isFakeToken;
export const consentRedirect = auth.consentRedirect;
