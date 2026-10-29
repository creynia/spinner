/**
 * The subset of Drive v3 that `services/sync/drive.ts` uses, as a `fetch`-shaped function over one
 * in-memory appDataFolder (sync.md §11.1, §11.3). Unit tests pass it as `fetchImpl`; e2e tests
 * route `https://www.googleapis.com/**` to it with `routeDrive`, so two browser contexts share one
 * fake Drive (two devices, one account). No Google, no network.
 */
import type { BrowserContext, Page } from '@playwright/test';

export interface FakeFile {
  id: string;
  name: string;
  bytes: Uint8Array;
  version: number;
  modifiedTime: string;
  appProperties: Record<string, string>;
}

export interface FakeDriveOptions {
  /** Accepted bearer tokens. Anything else is 401. */
  tokens?: Set<string>;
  /** Also accepted: any token for which this returns true (e.g. the GIS fake's tokens). */
  acceptToken?: (t: string) => boolean;
  /** Files per `files.list` page (the client asks for 1000). */
  pageSize?: number;
  /** Fault injection: called before each request; return a Response to short-circuit it. */
  fault?: (method: string, url: URL) => Response | undefined;
  email?: string;
  /** Drive `permissionId` (the stable account id the sync binds to); default one fixed id. */
  permissionId?: string;
  /** Resumable `308` answers leave out the `Range` header (a CORS-hidden header; sync.md §15 R3). */
  omitRange?: boolean;
}

export interface RequestLog {
  method: string;
  path: string;
  query: string;
  auth: string;
}

export function createFakeDrive(o: FakeDriveOptions = {}) {
  const tokens = o.tokens ?? new Set<string>();
  const files = new Map<string, FakeFile>();
  const sessions = new Map<
    string,
    { name: string; total: number; got: Uint8Array[]; props: Record<string, string> }
  >();
  /** Finished resumable sessions: a `bytes *\/N` query answers 200 with the file. */
  const finished = new Map<string, string>();
  const log: RequestLog[] = [];
  let seq = 0;
  let clock = Date.parse('2026-10-28T00:00:00Z');
  const opts = { ...o };

  const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  const err = (status: number, reason: string, message = reason): Response =>
    json(status, { error: { code: status, message, errors: [{ reason }] } });
  const meta = (f: FakeFile) => ({
    id: f.id,
    name: f.name,
    size: String(f.bytes.length),
    version: String(f.version),
    md5Checksum: `md5-${f.id}-${f.version}`,
    modifiedTime: f.modifiedTime,
    appProperties: f.appProperties,
  });
  const put = (name: string, bytes: Uint8Array, props: Record<string, string>): FakeFile => {
    const f: FakeFile = {
      id: `f${++seq}`,
      name,
      bytes,
      version: 1,
      modifiedTime: new Date((clock += 1000)).toISOString(),
      appProperties: props,
    };
    files.set(f.id, f);
    return f;
  };
  const bodyBytes = async (b: BodyInit | null | undefined): Promise<Uint8Array> =>
    b == null ? new Uint8Array() : new Uint8Array(await new Response(b).arrayBuffer());
  const rangeHeader = (n: number): Record<string, string> =>
    n > 0 && !opts.omitRange ? { Range: `bytes=0-${n - 1}` } : {};

  async function handle(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const req = input instanceof Request ? input : undefined;
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (init.method ?? req?.method ?? 'GET').toUpperCase();
    const h = new Headers(init.headers ?? req?.headers);
    const auth = h.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    log.push({ method, path: url.pathname, query: url.search, auth });
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const short = opts.fault?.(method, url);
    if (short) return short;
    if (!auth || !(tokens.has(auth) || opts.acceptToken?.(auth)))
      return err(401, 'authError', 'Invalid Credentials');

    const p = url.pathname;
    const body = init.body ?? (req ? await req.clone().arrayBuffer() : undefined);
    // resumable session PUTs
    if (url.searchParams.has('upload_id') && method === 'PUT') {
      const id = url.searchParams.get('upload_id')!;
      const doneId = finished.get(id);
      const cr = h.get('Content-Range') ?? '';
      if (doneId && cr.startsWith('bytes */')) return json(200, meta(files.get(doneId)!));
      const s = sessions.get(id);
      if (!s) return err(404, 'notFound');
      const have = s.got.reduce((n, x) => n + x.length, 0);
      if (cr.startsWith('bytes */'))
        return new Response(null, { status: 308, headers: rangeHeader(have) });
      const chunk = await bodyBytes(body);
      s.got.push(chunk);
      const now = have + chunk.length;
      if (now < s.total) return new Response(null, { status: 308, headers: rangeHeader(now) });
      const all = new Uint8Array(s.total);
      let q = 0;
      for (const x of s.got) {
        all.set(x, q);
        q += x.length;
      }
      sessions.delete(id);
      const f = put(s.name, all, s.props);
      finished.set(id, f.id);
      return json(200, meta(f));
    }
    if (p === '/drive/v3/about') {
      const usage = [...files.values()].reduce((n, f) => n + f.bytes.length, 0);
      return json(200, {
        user: {
          emailAddress: opts.email ?? 'owner@example.com',
          displayName: 'Owner',
          permissionId: opts.permissionId ?? '0123456789',
        },
        storageQuota: { limit: String(15 * 2 ** 30), usage: String(usage) },
      });
    }
    if (p === '/drive/v3/files' && method === 'GET') {
      if (url.searchParams.get('spaces') !== 'appDataFolder') return err(403, 'insufficientScopes');
      const all = [...files.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
      const size = Math.min(opts.pageSize ?? 1000, Number(url.searchParams.get('pageSize') ?? 100));
      const start = Number(url.searchParams.get('pageToken') ?? 0);
      const page = all.slice(start, start + size);
      return json(200, {
        files: page.map(meta),
        ...(start + size < all.length ? { nextPageToken: String(start + size) } : {}),
      });
    }
    if (p === '/upload/drive/v3/files' && method === 'POST') {
      const type = url.searchParams.get('uploadType');
      if (type === 'resumable') {
        const m = JSON.parse(new TextDecoder().decode(await bodyBytes(body))) as {
          name: string;
          parents: string[];
          appProperties?: Record<string, string>;
        };
        if (m.parents[0] !== 'appDataFolder') return err(403, 'insufficientScopes');
        const id = `u${++seq}`;
        sessions.set(id, {
          name: m.name,
          total: Number(h.get('X-Upload-Content-Length')),
          got: [],
          props: m.appProperties ?? {},
        });
        return new Response(null, {
          status: 200,
          headers: {
            Location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${id}`,
          },
        });
      }
      if (type === 'multipart') {
        const boundary = /boundary=(\S+)/.exec(h.get('Content-Type') ?? '')?.[1];
        const raw = await bodyBytes(body);
        const text = new TextDecoder('latin1').decode(raw);
        const parts = text.split(`--${boundary}`);
        const metaPart = parts[1]!.split('\r\n\r\n')[1]!.replace(/\r\n$/, '');
        const m = JSON.parse(metaPart) as {
          name: string;
          parents: string[];
          appProperties?: Record<string, string>;
        };
        if (m.parents[0] !== 'appDataFolder') return err(403, 'insufficientScopes');
        const start = text.indexOf('\r\n\r\n', text.indexOf('\r\n\r\n') + 4) + 4;
        const end = text.lastIndexOf(`\r\n--${boundary}--`);
        return json(200, meta(put(m.name, raw.slice(start, end), m.appProperties ?? {})));
      }
    }
    const fm = /^\/(upload\/)?drive\/v3\/files\/([^/]+)$/.exec(p);
    if (fm) {
      const f = files.get(decodeURIComponent(fm[2]!));
      if (!f) return err(404, 'notFound', 'File not found');
      if (method === 'GET' && url.searchParams.get('alt') === 'media') {
        return new Response(f.bytes.slice(), {
          status: 200,
          headers: { 'Content-Length': String(f.bytes.length) },
        });
      }
      if (method === 'PATCH' && fm[1]) {
        f.bytes = await bodyBytes(body);
        f.version += 1;
        f.modifiedTime = new Date((clock += 1000)).toISOString();
        return json(200, meta(f));
      }
      if (method === 'DELETE') {
        files.delete(f.id);
        return new Response(null, { status: 204 });
      }
    }
    return err(400, 'badRequest', `fake drive: unsupported ${method} ${p}`);
  }

  return {
    fetch: handle,
    files,
    sessions,
    tokens,
    log,
    /** Change options on the fly (e.g. `omitRange`, `fault`). */
    set<K extends keyof FakeDriveOptions>(k: K, v: FakeDriveOptions[K]): void {
      opts[k] = v;
    },
    /** Makes the server forget an upload session, like Drive's one-week expiry. */
    expireSession(id?: string): void {
      if (id) sessions.delete(id);
      else sessions.clear();
    },
  };
}

export type FakeDrive = ReturnType<typeof createFakeDrive>;

/** Routes `https://www.googleapis.com/**` of a page or a whole context to the fake. */
export async function routeDrive(target: BrowserContext | Page, drive: FakeDrive): Promise<void> {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'authorization, content-type, content-range, x-upload-content-type, x-upload-content-length',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'Range, Location, Content-Length',
  };
  await target.route('https://www.googleapis.com/**', async (route) => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const headers = await r.allHeaders();
    const data = r.postDataBuffer();
    const res = await drive.fetch(r.url(), {
      method: r.method(),
      headers,
      ...(data ? { body: new Uint8Array(data) } : {}),
    });
    await route.fulfill({
      status: res.status,
      headers: {
        ...Object.fromEntries(res.headers.entries()),
        // The page is cross-origin to Google: expose what the client reads.
        ...cors,
      },
      body: Buffer.from(await res.arrayBuffer()),
    });
  });
}
