/**
 * `RemoteStore` over the Drive v3 REST API, appDataFolder only, with plain `fetch` (no gapi
 * client library; sync.md §5.3). `fetchImpl` is injectable so tests run it against the fake Drive.
 * Every method rejects with `RemoteError` only (an abort rejects with the abort's own error).
 */
import {
  RemoteError,
  RESUMABLE_CHUNK,
  RESUMABLE_THRESHOLD,
  type RemoteAbout,
  type RemoteErrorCode,
  type RemoteFile,
  type RemoteStore,
  type TransferProgress,
} from '@core';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FILE_FIELDS = 'id,name,size,version,md5Checksum,modifiedTime,appProperties';

export interface DriveOptions {
  /** Current access token or null (the engine maps null to `needs-auth` before calling). */
  token: () => string | null;
  fetchImpl?: typeof fetch;
  /** Persists resumable session URIs across reloads (syncMeta in the app, a Map in tests). */
  sessions?: {
    get(k: string): Promise<string | undefined>;
    set(k: string, uri: string | undefined): Promise<void>;
  };
}

interface DriveFileJson {
  id: string;
  name: string;
  size?: string;
  version?: string;
  md5Checksum?: string;
  modifiedTime?: string;
  appProperties?: Record<string, string>;
}

function toFile(j: DriveFileJson): RemoteFile {
  return {
    id: j.id,
    name: j.name,
    bytes: Number(j.size ?? 0),
    version: j.version ?? '0',
    ...(j.md5Checksum ? { md5: j.md5Checksum } : {}),
    modifiedTime: j.modifiedTime ?? '',
    appProperties: j.appProperties ?? {},
  };
}

const GOOGLE_ORIGIN = 'https://www.googleapis.com';
const MAX_RETRY_AFTER_MS = 3_600_000;
/** A 308 must move the offset forward; chunks are 256 KiB multiples, so this bounds the loop. */
const MIN_STEP = 256 * 1024;

/**
 * F1: the bearer token only ever goes to Drive's own API. A resumable session URI comes from a
 * response header (and from storage), so it is checked before use and before it is persisted.
 */
export function assertDriveUrl(uri: string): void {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    throw new RemoteError('bad-response', 0, 'invalid Drive URL');
  }
  if (
    u.origin !== GOOGLE_ORIGIN ||
    !(u.pathname.startsWith('/upload/drive/v3/') || u.pathname.startsWith('/drive/v3/'))
  )
    throw new RemoteError('bad-response', 0, 'refusing to send credentials to an unexpected URL');
}

/** Maps an HTTP failure to a `RemoteError` (sync.md §9). */
export async function errorOf(res: Response): Promise<RemoteError> {
  let reason = '';
  let message = `HTTP ${res.status}`;
  try {
    const j = (await res.json()) as {
      error?: { message?: string; errors?: { reason?: string }[] };
    };
    reason = j.error?.errors?.[0]?.reason ?? '';
    message = j.error?.message ?? message;
  } catch {
    // not JSON
  }
  const ra = Number(res.headers.get('Retry-After'));
  const retry = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, MAX_RETRY_AFTER_MS) : undefined;
  let code: RemoteErrorCode;
  if (res.status === 401) code = 'auth';
  else if (res.status === 429) code = 'rate';
  else if (res.status === 403)
    code = /rateLimit|dailyLimit/i.test(reason)
      ? 'rate'
      : reason === 'storageQuotaExceeded'
        ? 'quota'
        : 'forbidden';
  else if (res.status === 404) code = 'not-found';
  else if (res.status >= 500) code = 'server';
  else code = 'bad-response';
  return new RemoteError(code, res.status, message, retry);
}

/** TS 6 types `BodyInit` with `Uint8Array<ArrayBuffer>`; our buffers are never shared. */
const asBody = (b: Uint8Array): BodyInit => b as Uint8Array<ArrayBuffer>;

/** `Range: bytes=0-524287` -> 524288 (the next offset). */
function rangeEnd(h: string | null): number {
  const m = h ? /bytes=0-(\d+)/.exec(h) : null;
  return m ? Number(m[1]) + 1 : 0;
}

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

export function createDriveStore(opts: DriveOptions): RemoteStore {
  const f = opts.fetchImpl ?? fetch.bind(globalThis);

  async function call(
    url: string,
    init: RequestInit = {},
    ok: number[] = [200],
  ): Promise<Response> {
    assertDriveUrl(url);
    const token = opts.token();
    if (!token) throw new RemoteError('auth', 401, 'not signed in');
    let res: Response;
    try {
      res = await f(url, {
        ...init,
        // Never let the HTTP cache or the service worker keep Drive responses (sync.md §5.5).
        cache: 'no-store',
        // A redirect would carry the Authorization header to wherever it points.
        redirect: 'error',
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      if (isAbort(e)) throw e;
      throw new RemoteError('network', 0, e instanceof Error ? e.message : 'network error');
    }
    if (!ok.includes(res.status)) throw await errorOf(res);
    return res;
  }

  const fileOf = async (res: Response): Promise<RemoteFile> => {
    try {
      const j = (await res.json()) as DriveFileJson;
      if (typeof j.id !== 'string') throw new Error('no id');
      return toFile(j);
    } catch {
      throw new RemoteError('bad-response', res.status, 'unexpected Drive response');
    }
  };

  async function multipart(
    name: string,
    bytes: Uint8Array,
    appProperties: Record<string, string>,
    contentType: string,
    signal?: AbortSignal,
  ): Promise<RemoteFile> {
    const boundary = `spinner${Math.random().toString(36).slice(2)}`;
    const meta = JSON.stringify({ name, parents: ['appDataFolder'], appProperties });
    const head = new TextEncoder().encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
        `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    );
    const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head, 0);
    body.set(bytes, head.length);
    body.set(tail, head.length + bytes.length);
    const res = await call(`${UPLOAD}/files?uploadType=multipart&fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: asBody(body),
      ...(signal ? { signal } : {}),
    });
    return fileOf(res);
  }

  /**
   * Resumable upload (sync.md §5.3): init, PUT 8 MiB chunks, resume from the persisted session
   * with `bytes *\/N`, restart on 404 or 410 (an expired session) once.
   */
  async function resumable(
    name: string,
    bytes: Uint8Array,
    appProperties: Record<string, string>,
    contentType: string,
    resumeKey: string | undefined,
    onProgress?: TransferProgress,
    signal?: AbortSignal,
    restarted = false,
  ): Promise<RemoteFile> {
    const total = bytes.length;
    const forget = async (): Promise<void> => {
      if (resumeKey) await opts.sessions?.set(resumeKey, undefined);
    };
    let uri = resumeKey ? await opts.sessions?.get(resumeKey) : undefined;
    let offset = 0;
    if (uri) {
      try {
        assertDriveUrl(uri);
      } catch (e) {
        await forget(); // a poisoned or foreign session is dropped; the next attempt starts fresh
        throw e;
      }
      // Ask how much the server has: 308 + Range, or 200/201 when it was already complete.
      const q = await call(
        uri,
        {
          method: 'PUT',
          headers: { 'Content-Range': `bytes */${total}` },
          ...(signal ? { signal } : {}),
        },
        [200, 201, 308, 404, 410],
      );
      if (q.status === 200 || q.status === 201) {
        await forget();
        return fileOf(q);
      }
      if (q.status === 308) {
        offset = rangeEnd(q.headers.get('Range'));
        if (offset >= total)
          throw new RemoteError('bad-response', 308, 'inconsistent upload progress');
      } else {
        uri = undefined; // expired session (about a week): start over
        await forget();
      }
    }
    if (!uri) {
      const init = await call(`${UPLOAD}/files?uploadType=resumable&fields=${FILE_FIELDS}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': contentType,
          'X-Upload-Content-Length': String(total),
        },
        body: JSON.stringify({ name, parents: ['appDataFolder'], appProperties }),
        ...(signal ? { signal } : {}),
      });
      uri = init.headers.get('Location') ?? undefined;
      if (!uri) throw new RemoteError('bad-response', init.status, 'no upload session');
      assertDriveUrl(uri);
      if (resumeKey) await opts.sessions?.set(resumeKey, uri);
    }
    // F2: every 308 must advance the offset, and never reach the total (that would be a 200).
    const maxSteps = Math.ceil(total / MIN_STEP) + 4;
    for (let step = 0; ; step++) {
      if (step > maxSteps) throw new RemoteError('bad-response', 308, 'upload made no progress');
      const end = Math.min(offset + RESUMABLE_CHUNK, total);
      const res = await call(
        uri,
        {
          method: 'PUT',
          headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${total}` },
          body: asBody(bytes.subarray(offset, end)),
          ...(signal ? { signal } : {}),
        },
        [200, 201, 308, 404, 410],
      );
      if (res.status === 404 || res.status === 410) {
        // The session died under us. Start over once; a second death is a real failure.
        await forget();
        if (restarted) throw await errorOf(res);
        return resumable(
          name,
          bytes,
          appProperties,
          contentType,
          resumeKey,
          onProgress,
          signal,
          true,
        );
      }
      if (res.status !== 308) {
        await forget();
        onProgress?.(total, total);
        return fileOf(res);
      }
      // If the Range header is not exposed to us, assume the whole chunk landed (sync.md §15 R3).
      const got = res.headers.get('Range');
      const next = got ? rangeEnd(got) : end;
      if (next <= offset || next >= total)
        throw new RemoteError('bad-response', 308, 'inconsistent upload progress');
      offset = next;
      onProgress?.(offset, total);
    }
  }

  return {
    kind: 'drive',
    async list(o = {}) {
      const out: RemoteFile[] = [];
      let page: string | undefined;
      do {
        const q = new URLSearchParams({
          spaces: 'appDataFolder',
          pageSize: '1000',
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          ...(page ? { pageToken: page } : {}),
        });
        const res = await call(`${API}/files?${q}`, o.signal ? { signal: o.signal } : {});
        let j: { files?: DriveFileJson[]; nextPageToken?: string };
        try {
          j = (await res.json()) as typeof j;
        } catch {
          throw new RemoteError('bad-response', res.status, 'unexpected Drive response');
        }
        for (const x of j.files ?? []) out.push(toFile(x));
        page = j.nextPageToken;
      } while (page);
      return out;
    },
    async download(fileId, o = {}) {
      const res = await call(
        `${API}/files/${encodeURIComponent(fileId)}?alt=media`,
        o.signal ? { signal: o.signal } : {},
      );
      try {
        const total = Number(res.headers.get('Content-Length') ?? 0);
        if (!res.body || !o.onProgress) return new Uint8Array(await res.arrayBuffer());
        const reader = res.body.getReader();
        const parts: Uint8Array[] = [];
        let n = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          n += value.length;
          o.onProgress(n, total);
        }
        const out = new Uint8Array(n);
        let p = 0;
        for (const x of parts) {
          out.set(x, p);
          p += x.length;
        }
        return out;
      } catch (e) {
        if (isAbort(e)) throw e;
        throw new RemoteError(
          'network',
          0,
          e instanceof Error ? e.message : 'download interrupted',
        );
      }
    },
    create(name, bytes, o = {}) {
      const ct = o.contentType ?? 'application/gzip';
      const props = o.appProperties ?? {};
      return bytes.length > RESUMABLE_THRESHOLD
        ? resumable(name, bytes, props, ct, o.resumeKey, o.onProgress, o.signal)
        : multipart(name, bytes, props, ct, o.signal);
    },
    async update(fileId, bytes, o = {}) {
      const res = await call(
        `${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=${FILE_FIELDS}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/gzip' },
          body: asBody(bytes),
          ...(o.signal ? { signal: o.signal } : {}),
        },
      );
      return fileOf(res);
    },
    async delete(fileId, o = {}) {
      await call(
        `${API}/files/${encodeURIComponent(fileId)}`,
        { method: 'DELETE', ...(o.signal ? { signal: o.signal } : {}) },
        [200, 204, 404],
      );
    },
    async about(): Promise<RemoteAbout> {
      const res = await call(
        `${API}/about?fields=user(emailAddress,displayName,permissionId),storageQuota(limit,usage)`,
      );
      let j: {
        user?: { emailAddress?: string; displayName?: string; permissionId?: string };
        storageQuota?: { limit?: string; usage?: string };
      };
      try {
        j = (await res.json()) as typeof j;
      } catch {
        throw new RemoteError('bad-response', res.status, 'unexpected Drive response');
      }
      return {
        email: j.user?.emailAddress ?? '',
        displayName: j.user?.displayName ?? '',
        accountId: j.user?.permissionId ?? '',
        usage: Number(j.storageQuota?.usage ?? 0),
        limit: j.storageQuota?.limit ? Number(j.storageQuota.limit) : null,
      };
    },
  };
}
