// Throwaway checks for the sync spike: the Drive client against the fake Drive, and the GIS token
// source against a fake GIS. Run: npx vitest run --root docs/design/sync-prototype
import { describe, expect, it } from 'vitest';
import { RemoteError, RESUMABLE_CHUNK, RESUMABLE_THRESHOLD } from './contracts-sync.mts';
import { createDriveStore } from './drive.mts';
import { createFakeDrive } from './fake-drive.mts';
import { createGisTokenSource, DRIVE_APPDATA_SCOPE, type GisOauth2 } from './gis.mts';

const bytes = (n: number, seed = 1): Uint8Array => {
  const b = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) b[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 24;
  return b;
};

describe('Drive client against the fake Drive', () => {
  it('creates (multipart), lists with paging, downloads, updates, deletes', async () => {
    const fake = createFakeDrive({ tokens: new Set(['t1']), pageSize: 2 });
    const d = createDriveStore({ token: () => 't1', fetchImpl: fake.fetch });
    const a = await d.create('lib.dev1.json.gz', bytes(1000), { appProperties: { kind: 'lib' } });
    await d.create('b', bytes(10, 2));
    await d.create('c', bytes(10, 3));
    const all = await d.list();
    expect(all.map((f) => f.name).sort()).toEqual(['b', 'c', 'lib.dev1.json.gz']);
    expect(all.find((f) => f.id === a.id)?.appProperties).toEqual({ kind: 'lib' });
    expect(await d.download(a.id)).toEqual(bytes(1000));
    const u = await d.update(a.id, bytes(5, 9));
    expect(u.version).toBe('2');
    expect(await d.download(a.id)).toEqual(bytes(5, 9));
    await d.delete(a.id);
    expect((await d.list()).length).toBe(2);
    const about = await d.about();
    expect(about.email).toBe('owner@example.com');
    expect(about.usage).toBe(20);
  });

  it('uploads a large run resumably and resumes after a dropped connection', async () => {
    let drop = 1;
    const fake = createFakeDrive({
      tokens: new Set(['t1']),
      // the second chunk PUT fails once (connection reset)
      fault: (m, url) => {
        if (m === 'PUT' && url.searchParams.has('upload_id') && fake.sessions.size && [...fake.sessions.values()][0]!.got.length === 1 && drop-- > 0)
          return new Response(null, { status: 503 });
        return undefined;
      },
    });
    const uris = new Map<string, string>();
    const d = createDriveStore({
      token: () => 't1',
      fetchImpl: fake.fetch,
      sessions: { get: async (k) => uris.get(k), set: async (k, v) => void (v ? uris.set(k, v) : uris.delete(k)) },
    });
    const big = bytes(RESUMABLE_THRESHOLD + RESUMABLE_CHUNK + 123, 7);
    await expect(d.create('run.x.gz', big, { resumeKey: 'run:x' })).rejects.toMatchObject({ code: 'server' });
    expect(uris.has('run:x')).toBe(true); // session kept for the retry
    const seen: number[] = [];
    const f = await d.create('run.x.gz', big, { resumeKey: 'run:x', onProgress: (n) => seen.push(n) });
    expect(f.bytes).toBe(big.length);
    expect(seen[0]).toBeGreaterThan(RESUMABLE_CHUNK); // continued, did not start over
    expect(uris.has('run:x')).toBe(false);
    const back = await d.download(f.id);
    expect(back.length).toBe(big.length);
    expect(back.every((v, i) => v === big[i])).toBe(true);
  });

  it('maps errors: 401 auth, 429 rate with Retry-After, 403 quota', async () => {
    const fake = createFakeDrive({
      tokens: new Set(['ok']),
      fault: (m) =>
        m === 'DELETE'
          ? new Response(JSON.stringify({ error: { errors: [{ reason: 'storageQuotaExceeded' }] } }), { status: 403 })
          : m === 'PATCH'
            ? new Response('{}', { status: 429, headers: { 'Retry-After': '3' } })
            : undefined,
    });
    const bad = createDriveStore({ token: () => 'expired', fetchImpl: fake.fetch });
    await expect(bad.list()).rejects.toMatchObject({ code: 'auth', status: 401 });
    const none = createDriveStore({ token: () => null, fetchImpl: fake.fetch });
    await expect(none.list()).rejects.toBeInstanceOf(RemoteError);
    const d = createDriveStore({ token: () => 'ok', fetchImpl: fake.fetch });
    await expect(d.update('x', bytes(1))).rejects.toMatchObject({ code: 'rate', retryAfterMs: 3000 });
    await expect(d.delete('x')).rejects.toMatchObject({ code: 'quota' });
    const offline = createDriveStore({ token: () => 'ok', fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')) });
    await expect(offline.list()).rejects.toMatchObject({ code: 'network' });
  });
});

describe('GIS token source against a fake GIS', () => {
  function fakeGis(grant: { scope: string } | { error: string } | 'popup-blocked') {
    const calls: { prompt?: string; login_hint?: string }[] = [];
    const revoked: string[] = [];
    let n = 0;
    const g: GisOauth2 = {
      initTokenClient: (c) => ({
        requestAccessToken: (o) => {
          calls.push(o ?? {});
          queueMicrotask(() => {
            if (grant === 'popup-blocked') c.error_callback?.({ type: 'popup_failed_to_open' });
            else if ('error' in grant) c.callback({ error: grant.error });
            else c.callback({ access_token: `tok${++n}`, expires_in: 3599, scope: grant.scope });
          });
        },
      }),
      hasGrantedAllScopes: (r, ...s) => s.every((x) => (r.scope ?? '').split(' ').includes(x)),
      revoke: (t, done) => {
        revoked.push(t);
        done?.();
      },
    };
    return { g, calls, revoked };
  }

  it('signs in, expires after ~1 h, reconnects silently with the email hint, revokes', async () => {
    let now = 1_000_000;
    const f = fakeGis({ scope: DRIVE_APPDATA_SCOPE });
    const ts = createGisTokenSource({ clientId: 'cid', load: async () => f.g, now: () => now, whoAmI: async () => 'owner@example.com' });
    expect(ts.state.state).toBe('signed-out');
    expect(ts.current()).toBeNull();
    expect(await ts.acquire({ silent: false })).toBe('tok1');
    expect(f.calls[0]).toEqual({ prompt: 'select_account' });
    expect(ts.state).toMatchObject({ state: 'signed-in', email: 'owner@example.com' });
    now += 3599_000 - 60_000; // inside the 2-minute skew
    expect(ts.current()).toBeNull();
    expect(ts.state).toEqual({ state: 'expired', email: 'owner@example.com' });
    expect(await ts.acquire({ silent: true })).toBe('tok2');
    expect(f.calls[1]).toEqual({ prompt: '', login_hint: 'owner@example.com' });
    await ts.revoke();
    expect(f.revoked).toEqual(['tok2']);
    expect(ts.state.state).toBe('signed-out');
  });

  it('refuses a grant without drive.appdata, reports a blocked popup, and an unconfigured build', async () => {
    const noScope = createGisTokenSource({ clientId: 'cid', load: async () => fakeGis({ scope: 'email' }).g, whoAmI: async () => 'x' });
    await expect(noScope.acquire({ silent: false })).rejects.toMatchObject({ code: 'scope' });
    const blocked = createGisTokenSource({ clientId: 'cid', load: async () => fakeGis('popup-blocked').g, whoAmI: async () => 'x' });
    await expect(blocked.acquire({ silent: true })).rejects.toMatchObject({ code: 'popup-blocked' });
    const denied = createGisTokenSource({ clientId: 'cid', load: async () => fakeGis({ error: 'access_denied' }).g, whoAmI: async () => 'x' });
    await expect(denied.acquire({ silent: false })).rejects.toMatchObject({ code: 'denied' });
    const off = createGisTokenSource({ clientId: '', whoAmI: async () => 'x' });
    expect(off.state.state).toBe('unconfigured');
    await expect(off.acquire({ silent: false })).rejects.toMatchObject({ code: 'unconfigured' });
  });
});
