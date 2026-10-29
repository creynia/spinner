/* eslint-disable @typescript-eslint/require-await -- async stubs and fake method tables */
import { describe, expect, it } from 'vitest';
import { RemoteError, RESUMABLE_CHUNK, RESUMABLE_THRESHOLD } from '@core';
import { assertDriveUrl, createDriveStore, errorOf } from '../../../src/app/services/sync/drive';
import { createFakeDrive } from './fakes';
import { bytes, sum } from './helpers';

const urlOf = (u: RequestInfo | URL): string =>
  typeof u === 'string' ? u : u instanceof URL ? u.href : u.url;

const store = (fake: ReturnType<typeof createFakeDrive>, uris = new Map<string, string>()) => ({
  uris,
  d: createDriveStore({
    token: () => 't1',
    fetchImpl: fake.fetch,
    sessions: {
      get: async (k) => uris.get(k),
      set: async (k, v) => void (v ? uris.set(k, v) : uris.delete(k)),
    },
  }),
});

describe('Drive client against the fake Drive', () => {
  it('creates (multipart), lists, downloads, updates, deletes; every call is appDataFolder and no-store', async () => {
    const calls: RequestInit[] = [];
    const fake = createFakeDrive({ tokens: new Set(['t1']) });
    const d = createDriveStore({
      token: () => 't1',
      fetchImpl: (u, i) => (calls.push(i ?? {}), fake.fetch(u, i)),
    });
    const a = await d.create('lib.dev1.json.gz', bytes(1000), { appProperties: { kind: 'lib' } });
    await d.create('b', bytes(10, 2));
    const all = await d.list();
    expect(all.map((f) => f.name).sort()).toEqual(['b', 'lib.dev1.json.gz']);
    expect(all.find((f) => f.id === a.id)?.appProperties).toEqual({ kind: 'lib' });
    expect(sum(await d.download(a.id))).toBe(sum(bytes(1000)));
    const u = await d.update(a.id, bytes(5, 9));
    expect(u.version).toBe('2');
    expect(sum(await d.download(a.id))).toBe(sum(bytes(5, 9)));
    await d.delete(a.id);
    await d.delete(a.id); // 404 counts as success
    expect((await d.list()).length).toBe(1);
    const about = await d.about();
    expect(about).toMatchObject({ email: 'owner@example.com', accountId: '0123456789', usage: 10 });
    expect(about.limit).toBe(15 * 2 ** 30);
    expect(calls.every((c) => c.cache === 'no-store')).toBe(true);
    expect(fake.log.every((l) => l.auth === 't1')).toBe(true);
  });

  it('pages the list across nextPageToken', async () => {
    const fake = createFakeDrive({ tokens: new Set(['t1']), pageSize: 2 });
    const { d } = store(fake);
    for (let i = 0; i < 5; i++) await d.create(`f${i}`, bytes(4, i + 1));
    fake.log.length = 0;
    expect((await d.list()).map((f) => f.name)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4']);
    expect(fake.log.filter((l) => l.path === '/drive/v3/files').length).toBe(3);
    expect(fake.log[0]!.query).toContain('spaces=appDataFolder');
  });

  it('uses a resumable session above the threshold, in 8 MiB chunks', async () => {
    const fake = createFakeDrive({ tokens: new Set(['t1']) });
    const { d, uris } = store(fake);
    const big = bytes(RESUMABLE_THRESHOLD + RESUMABLE_CHUNK + 123, 7);
    const seen: number[] = [];
    const f = await d.create('run.x.gz', big, {
      resumeKey: 'run:x',
      onProgress: (n) => seen.push(n),
    });
    expect(f.bytes).toBe(big.length);
    expect(seen.at(-1)).toBe(big.length);
    expect(fake.log.filter((l) => l.method === 'PUT').length).toBe(2);
    expect(uris.size).toBe(0);
    expect(sum(await d.download(f.id))).toBe(sum(big));
    // exactly at the threshold stays multipart
    fake.log.length = 0;
    await d.create('edge', bytes(RESUMABLE_THRESHOLD, 3));
    expect(fake.log.some((l) => l.query.includes('multipart'))).toBe(true);
  });

  it('resumes after a dropped connection from the persisted session', async () => {
    let drop = 1;
    const fake = createFakeDrive({
      tokens: new Set(['t1']),
      fault: (m, url) => {
        const s = [...fake.sessions.values()][0];
        return m === 'PUT' && url.searchParams.has('upload_id') && s?.got.length === 1 && drop-- > 0
          ? new Response(null, { status: 503 })
          : undefined;
      },
    });
    const { d, uris } = store(fake);
    const big = bytes(RESUMABLE_THRESHOLD + RESUMABLE_CHUNK + 123, 7);
    await expect(d.create('run.x.gz', big, { resumeKey: 'run:x' })).rejects.toMatchObject({
      code: 'server',
    });
    expect(uris.has('run:x')).toBe(true);
    const seen: number[] = [];
    const f = await d.create('run.x.gz', big, {
      resumeKey: 'run:x',
      onProgress: (n) => seen.push(n),
    });
    expect(seen[0]).toBeGreaterThan(RESUMABLE_CHUNK); // continued, did not start over
    expect(uris.has('run:x')).toBe(false);
    expect(fake.files.size).toBe(1);
    expect(sum(await d.download(f.id))).toBe(sum(big));
  });

  it('returns the file when the persisted session had already finished', async () => {
    const fake = createFakeDrive({ tokens: new Set(['t1']) });
    const { d, uris } = store(fake);
    const big = bytes(RESUMABLE_THRESHOLD + 10, 5);
    const first = await d.create('run.y.gz', big, { resumeKey: 'run:y' });
    // the app died after the last chunk but before it recorded the result
    const [id] = [...fake.log]
      .reverse()
      .find((l) => l.query.includes('upload_id'))!
      .query.match(/upload_id=(\w+)/)!
      .slice(1);
    uris.set(
      'run:y',
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${id}`,
    );
    const again = await d.create('run.y.gz', big, { resumeKey: 'run:y' });
    expect(again.id).toBe(first.id);
    expect(fake.files.size).toBe(1);
    expect(uris.size).toBe(0);
  });

  it('restarts on 404 for a stale persisted session (status query)', async () => {
    const fake = createFakeDrive({ tokens: new Set(['t1']) });
    const { d, uris } = store(fake);
    uris.set(
      'k',
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=gone',
    );
    const big = bytes(RESUMABLE_THRESHOLD + 10, 2);
    const f = await d.create('run.z.gz', big, { resumeKey: 'k' });
    expect(f.bytes).toBe(big.length);
    expect(uris.size).toBe(0);
  });

  it('restarts once when the session dies under a chunk (404), then gives up', async () => {
    const fake = createFakeDrive({ tokens: new Set(['t1']) });
    const { d, uris } = store(fake);
    const big = bytes(RESUMABLE_THRESHOLD + RESUMABLE_CHUNK + 5, 4);
    let killed = 0;
    fake.set('fault', (m, url) => {
      if (
        m === 'PUT' &&
        url.searchParams.has('upload_id') &&
        killed < 1 &&
        [...fake.sessions.values()][0]?.got.length === 1
      ) {
        killed++;
        fake.expireSession();
        return undefined; // the next PUT finds no session
      }
      return undefined;
    });
    const f = await d.create('run.k.gz', big, { resumeKey: 'run:k' });
    expect(sum(await d.download(f.id))).toBe(sum(big));
    expect(fake.files.size).toBe(1);
    expect(uris.size).toBe(0);
    // a session that keeps dying: not-found after the single restart
    fake.set('fault', (m, url) =>
      m === 'PUT' && url.searchParams.has('upload_id')
        ? (fake.expireSession(), undefined)
        : undefined,
    );
    await expect(d.create('run.k2.gz', big, { resumeKey: 'run:k2' })).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('assumes the whole chunk landed when the Range header is missing', async () => {
    const fake = createFakeDrive({ tokens: new Set(['t1']), omitRange: true });
    const { d } = store(fake);
    const big = bytes(RESUMABLE_THRESHOLD + RESUMABLE_CHUNK + 1, 6);
    const seen: number[] = [];
    const f = await d.create('run.r.gz', big, { onProgress: (n) => seen.push(n) });
    expect(seen).toEqual([RESUMABLE_CHUNK, big.length]);
    expect(sum(await d.download(f.id))).toBe(sum(big));
  });

  it('aborts uploads, downloads and lists with the caller signal', async () => {
    const fake = createFakeDrive({ tokens: new Set(['t1']) });
    const { d } = store(fake);
    const f = await d.create('a', bytes(100));
    const ac = new AbortController();
    ac.abort();
    const abort = { name: 'AbortError' };
    await expect(d.list({ signal: ac.signal })).rejects.toMatchObject(abort);
    await expect(d.download(f.id, { signal: ac.signal })).rejects.toMatchObject(abort);
    await expect(d.create('b', bytes(10), { signal: ac.signal })).rejects.toMatchObject(abort);
    await expect(d.update(f.id, bytes(10), { signal: ac.signal })).rejects.toMatchObject(abort);
    await expect(d.delete(f.id, { signal: ac.signal })).rejects.toMatchObject(abort);
    await expect(
      d.create('c', bytes(RESUMABLE_THRESHOLD + 1), { signal: ac.signal, resumeKey: 'k' }),
    ).rejects.toMatchObject(abort);
    expect(fake.files.size).toBe(1);
  });

  it('streams download progress', async () => {
    const fake = createFakeDrive({ tokens: new Set(['t1']) });
    const { d } = store(fake);
    const f = await d.create('a', bytes(5000));
    const seen: [number, number][] = [];
    const back = await d.download(f.id, { onProgress: (n, t) => seen.push([n, t]) });
    expect(back.length).toBe(5000);
    expect(seen.at(-1)).toEqual([5000, 5000]);
  });

  it('maps every error code', async () => {
    const reply = (status: number, reason = '', headers: Record<string, string> = {}) =>
      new Response(JSON.stringify({ error: { message: 'm', errors: [{ reason }] } }), {
        status,
        headers,
      });
    const codes: [Response, string][] = [
      [reply(401), 'auth'],
      [reply(403, 'userRateLimitExceeded'), 'rate'],
      [reply(403, 'rateLimitExceeded'), 'rate'],
      [reply(403, 'dailyLimitExceeded'), 'rate'],
      [reply(403, 'sharingRateLimitExceeded'), 'rate'],
      [reply(429), 'rate'],
      [reply(403, 'storageQuotaExceeded'), 'quota'],
      [reply(403, 'insufficientScopes'), 'forbidden'],
      [reply(404), 'not-found'],
      [reply(500), 'server'],
      [reply(503), 'server'],
      [reply(400), 'bad-response'],
      [new Response('<html>', { status: 502 }), 'server'],
    ];
    for (const [res, code] of codes) expect(await errorOf(res)).toMatchObject({ code });
    expect((await errorOf(reply(429, '', { 'Retry-After': '3' }))).retryAfterMs).toBe(3000);
    expect((await errorOf(reply(429, '', { 'Retry-After': 'soon' }))).retryAfterMs).toBeUndefined();
  });

  it('rejects with RemoteError only: no token, bad token, network, garbage body', async () => {
    const fake = createFakeDrive({ tokens: new Set(['ok']) });
    await expect(
      createDriveStore({ token: () => null, fetchImpl: fake.fetch }).list(),
    ).rejects.toMatchObject({ code: 'auth' });
    await expect(
      createDriveStore({ token: () => 'expired', fetchImpl: fake.fetch }).list(),
    ).rejects.toMatchObject({ code: 'auth', status: 401 });
    const off = createDriveStore({
      token: () => 'ok',
      fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    for (const op of [
      () => off.list(),
      () => off.about(),
      () => off.delete('x'),
      () => off.create('x', bytes(3)),
    ])
      await expect(op()).rejects.toBeInstanceOf(RemoteError);
    await expect(off.list()).rejects.toMatchObject({ code: 'network' });
    const junk = createDriveStore({
      token: () => 'ok',
      fetchImpl: async () => new Response('nope', { status: 200 }),
    });
    await expect(junk.list()).rejects.toMatchObject({ code: 'bad-response' });
    await expect(junk.about()).rejects.toMatchObject({ code: 'bad-response' });
    await expect(junk.update('x', bytes(1))).rejects.toMatchObject({ code: 'bad-response' });
    const d = createDriveStore({
      token: () => 'ok',
      fetchImpl: createFakeDrive({
        tokens: new Set(['ok']),
        fault: (m) =>
          m === 'PATCH'
            ? new Response('{}', { status: 429, headers: { 'Retry-After': '3' } })
            : undefined,
      }).fetch,
    });
    await expect(d.update('x', bytes(1))).rejects.toMatchObject({
      code: 'rate',
      retryAfterMs: 3000,
    });
  });

  it('drops the token the moment it becomes null (mid-upload expiry is a 401, not a stale send)', async () => {
    const fake = createFakeDrive({ tokens: new Set(['t1']) });
    let tok: string | null = 't1';
    const d = createDriveStore({ token: () => tok, fetchImpl: fake.fetch });
    const big = bytes(RESUMABLE_THRESHOLD + RESUMABLE_CHUNK + 5, 8);
    await expect(d.create('r', big, { onProgress: () => (tok = null) })).rejects.toMatchObject({
      code: 'auth',
    });
  });

  describe('token-host guard (F1)', () => {
    const OK = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=u1';
    it('asserts Google API origin and Drive path prefixes', () => {
      expect(() => assertDriveUrl(OK)).not.toThrow();
      expect(() => assertDriveUrl('https://www.googleapis.com/drive/v3/files')).not.toThrow();
      for (const bad of [
        'https://evil.test/upload/drive/v3/files',
        'http://www.googleapis.com/drive/v3/files',
        'https://www.googleapis.com.evil.test/drive/v3/files',
        'https://www.googleapis.com:8443/drive/v3/files',
        'https://www.googleapis.com/oauth2/v1/userinfo',
        'https://www.googleapis.com/drive/v3evil',
        'not a url',
      ])
        expect(() => assertDriveUrl(bad), bad).toThrow(RemoteError);
    });

    it('never follows redirects with the bearer token', async () => {
      const inits: RequestInit[] = [];
      const fake = createFakeDrive({ tokens: new Set(['t1']) });
      const d = createDriveStore({
        token: () => 't1',
        fetchImpl: (u, i) => (inits.push(i ?? {}), fake.fetch(u, i)),
      });
      await d.list();
      await d.create('a', bytes(10));
      expect(inits.length).toBeGreaterThan(1);
      expect(inits.every((i) => i.redirect === 'error')).toBe(true);
    });

    it('a poisoned Location is refused before any token is sent or any session persisted', async () => {
      const sent: string[] = [];
      const fake = createFakeDrive({ tokens: new Set(['t1']) });
      const uris = new Map<string, string>();
      const d = createDriveStore({
        token: () => 't1',
        fetchImpl: async (u, i) => {
          sent.push(urlOf(u));
          const res = await fake.fetch(u, i);
          return urlOf(u).includes('uploadType=resumable')
            ? new Response(null, { status: 200, headers: { Location: 'https://evil.test/steal' } })
            : res;
        },
        sessions: {
          get: async (k) => uris.get(k),
          set: async (k, v) => void (v ? uris.set(k, v) : uris.delete(k)),
        },
      });
      await expect(
        d.create('r', bytes(RESUMABLE_THRESHOLD + 5), { resumeKey: 'k' }),
      ).rejects.toMatchObject({ code: 'bad-response' });
      expect(sent.some((u) => u.includes('evil.test'))).toBe(false);
      expect(uris.size).toBe(0);
    });

    it('a poisoned persisted session is dropped, never sent to, and the retry starts fresh', async () => {
      const sent: string[] = [];
      const fake = createFakeDrive({ tokens: new Set(['t1']) });
      const uris = new Map([['k', 'https://evil.test/upload/drive/v3/files?upload_id=x']]);
      const d = createDriveStore({
        token: () => 't1',
        fetchImpl: (u, i) => (sent.push(urlOf(u)), fake.fetch(u, i)),
        sessions: {
          get: async (k) => uris.get(k),
          set: async (k, v) => void (v ? uris.set(k, v) : uris.delete(k)),
        },
      });
      const big = bytes(RESUMABLE_THRESHOLD + 5, 3);
      await expect(d.create('r', big, { resumeKey: 'k' })).rejects.toMatchObject({
        code: 'bad-response',
      });
      expect(sent).toEqual([]);
      expect(uris.size).toBe(0);
      const f = await d.create('r', big, { resumeKey: 'k' });
      expect(f.bytes).toBe(big.length);
    });
  });

  describe('resumable progress guard (F2)', () => {
    const big = () => bytes(RESUMABLE_THRESHOLD + RESUMABLE_CHUNK + 5, 9);
    const stuck = (range: string | null) => (m: string, url: URL) =>
      m === 'PUT' && url.searchParams.has('upload_id')
        ? new Response(null, { status: 308, headers: range ? { Range: range } : {} })
        : undefined;

    it('fails when the offset does not advance', async () => {
      const fake = createFakeDrive({ tokens: new Set(['t1']), fault: stuck('bytes=0-262143') });
      const { d } = store(fake);
      await expect(d.create('r', big())).rejects.toMatchObject({ code: 'bad-response' });
      expect(fake.log.filter((l) => l.method === 'PUT').length).toBeLessThan(5);
    });
    it('fails when the offset goes backwards', async () => {
      let n = 0;
      const fake = createFakeDrive({
        tokens: new Set(['t1']),
        fault: (m, url) =>
          m === 'PUT' && url.searchParams.has('upload_id')
            ? new Response(null, {
                status: 308,
                headers: { Range: n++ === 0 ? 'bytes=0-524287' : 'bytes=0-262143' },
              })
            : undefined,
      });
      await expect(store(fake).d.create('r', big())).rejects.toMatchObject({
        code: 'bad-response',
      });
    });
    it('fails when a 308 claims the whole file (or more) arrived', async () => {
      const total = big().length;
      for (const end of [total - 1, total + 100]) {
        const fake = createFakeDrive({ tokens: new Set(['t1']), fault: stuck(`bytes=0-${end}`) });
        await expect(store(fake).d.create('r', big())).rejects.toMatchObject({
          code: 'bad-response',
        });
      }
    });
    it('fails on a 308 without Range for the final chunk, instead of looping', async () => {
      const fake = createFakeDrive({ tokens: new Set(['t1']), fault: stuck(null) });
      await expect(store(fake).d.create('r', big())).rejects.toMatchObject({
        code: 'bad-response',
      });
    });
  });

  it('clamps Retry-After to one hour (F3)', async () => {
    const res = (v: string) => new Response('{}', { status: 429, headers: { 'Retry-After': v } });
    expect((await errorOf(res('86400'))).retryAfterMs).toBe(3_600_000);
    expect((await errorOf(res('3600'))).retryAfterMs).toBe(3_600_000);
    expect((await errorOf(res('90'))).retryAfterMs).toBe(90_000);
  });
});
