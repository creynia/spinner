/**
 * PROTOTYPE of `tests/fakes/drive-server.ts` (sync.md §10.1): the subset of Drive v3 that
 * `drive.ts` uses, as a `fetch`-shaped function over one in-memory folder. Unit tests pass it as
 * `fetchImpl`; e2e tests route `https://www.googleapis.com/**` to it with Playwright `page.route`,
 * so two browser contexts share one fake Drive (two devices, one account).
 */
interface FakeFile {
  id: string;
  name: string;
  bytes: Uint8Array;
  version: number;
  modifiedTime: string;
  appProperties: Record<string, string>;
}

export interface FakeDriveOptions {
  /** Accepted bearer tokens; anything else is 401. */
  tokens: Set<string>;
  pageSize?: number;
  /** Fault injection: called before each request; return a Response to short-circuit it. */
  fault?: (method: string, url: URL) => Response | undefined;
  email?: string;
}

export function createFakeDrive(o: FakeDriveOptions) {
  const files = new Map<string, FakeFile>();
  const sessions = new Map<string, { name: string; total: number; got: Uint8Array[]; props: Record<string, string> }>();
  let seq = 0;
  let clock = Date.parse('2026-10-28T00:00:00Z');
  const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
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
    const f = { id: `f${++seq}`, name, bytes, version: 1, modifiedTime: new Date((clock += 1000)).toISOString(), appProperties: props };
    files.set(f.id, f);
    return f;
  };
  const bodyBytes = async (b: BodyInit | null | undefined): Promise<Uint8Array> =>
    b == null ? new Uint8Array() : new Uint8Array(await new Response(b).arrayBuffer());

  async function handle(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? 'GET').toUpperCase();
    const h = new Headers(init.headers);
    const short = o.fault?.(method, url);
    if (short) return short;
    const auth = h.get('Authorization')?.replace(/^Bearer /, '');
    if (!auth || !o.tokens.has(auth)) return err(401, 'authError', 'Invalid Credentials');

    const p = url.pathname;
    // resumable session PUTs
    if (url.searchParams.has('upload_id') && method === 'PUT') {
      const s = sessions.get(url.searchParams.get('upload_id')!);
      if (!s) return err(404, 'notFound');
      const have = s.got.reduce((n, x) => n + x.length, 0);
      const cr = h.get('Content-Range') ?? '';
      if (cr.startsWith('bytes */')) {
        return have === s.total ? json(200, {}) : new Response(null, { status: 308, headers: have ? { Range: `bytes=0-${have - 1}` } : {} });
      }
      const chunk = await bodyBytes(init.body);
      s.got.push(chunk);
      const now = have + chunk.length;
      if (now < s.total) return new Response(null, { status: 308, headers: { Range: `bytes=0-${now - 1}` } });
      const all = new Uint8Array(s.total);
      let q = 0;
      for (const x of s.got) {
        all.set(x, q);
        q += x.length;
      }
      sessions.delete(url.searchParams.get('upload_id')!);
      return json(200, meta(put(s.name, all, s.props)));
    }
    if (p === '/drive/v3/about') {
      const usage = [...files.values()].reduce((n, f) => n + f.bytes.length, 0);
      return json(200, {
        user: { emailAddress: o.email ?? 'owner@example.com', displayName: 'Owner', permissionId: '0123456789' },
        storageQuota: { limit: String(15 * 2 ** 30), usage: String(usage) },
      });
    }
    if (p === '/drive/v3/files' && method === 'GET') {
      if (url.searchParams.get('spaces') !== 'appDataFolder') return err(403, 'insufficientScopes');
      const all = [...files.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
      const size = Math.min(o.pageSize ?? 1000, Number(url.searchParams.get('pageSize') ?? 100));
      const start = Number(url.searchParams.get('pageToken') ?? 0);
      const page = all.slice(start, start + size);
      return json(200, { files: page.map(meta), ...(start + size < all.length ? { nextPageToken: String(start + size) } : {}) });
    }
    if (p === '/upload/drive/v3/files' && method === 'POST') {
      const type = url.searchParams.get('uploadType');
      if (type === 'resumable') {
        const m = JSON.parse(new TextDecoder().decode(await bodyBytes(init.body))) as { name: string; parents: string[]; appProperties?: Record<string, string> };
        if (m.parents[0] !== 'appDataFolder') return err(403, 'insufficientScopes');
        const id = `u${++seq}`;
        sessions.set(id, { name: m.name, total: Number(h.get('X-Upload-Content-Length')), got: [], props: m.appProperties ?? {} });
        return new Response(null, { status: 200, headers: { Location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${id}` } });
      }
      if (type === 'multipart') {
        const boundary = /boundary=(\S+)/.exec(h.get('Content-Type') ?? '')?.[1];
        const raw = await bodyBytes(init.body);
        const text = new TextDecoder('latin1').decode(raw);
        const parts = text.split(`--${boundary}`);
        const metaPart = parts[1]!.split('\r\n\r\n')[1]!.replace(/\r\n$/, '');
        const m = JSON.parse(metaPart) as { name: string; parents: string[]; appProperties?: Record<string, string> };
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
        return new Response(f.bytes.slice(), { status: 200, headers: { 'Content-Length': String(f.bytes.length) } });
      }
      if (method === 'PATCH' && fm[1]) {
        f.bytes = await bodyBytes(init.body);
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

  return { fetch: handle as typeof fetch, files, sessions };
}
