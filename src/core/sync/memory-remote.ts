// An in-memory RemoteStore for tests and the fuzz (sync.md §11.1). The semantics are Drive's where
// the engine relies on them: ids are opaque and never reused, names are not unique, `update`
// replaces content atomically and bumps `version`, a missing id is `not-found`.
import { RemoteError, type RemoteFile, type RemoteStore } from '../contracts/sync';

export interface MemoryRemoteOptions {
  /**
   * Return an error to make the named operation fail (crash injection). `phase` is `'before'`
   * (the call has no effect) or `'after'` (the effect happened but the caller sees the error: a
   * lost response). A fault without a phase argument means `'before'`.
   */
  fault?: (op: string, name?: string, phase?: 'before' | 'after') => RemoteError | undefined;
  /**
   * Listing lag (S-B): a freshly created `lib.*` file is hidden from `list()` for this many calls,
   * as Drive listings can lag a create. `ownLib` comes from `syncMeta.files`, not the listing.
   */
  listingLag?: { ownLib: number };
  /** Awaited before every remote call: the fuzz interleaves other devices here (§11.1). */
  hook?: (op: string) => Promise<void>;
}

interface Stored {
  file: RemoteFile;
  bytes: Uint8Array;
  /** `list()` calls left during which this file stays hidden. */
  hidden: number;
}

/**
 * The operations are named `list`, `download`, `create`, `update`, `delete` and `about` for `hook`
 * and `fault`; `name` is the file name (for download/update/delete: the stored file's name).
 */
export function createMemoryRemote(o: MemoryRemoteOptions = {}): RemoteStore {
  const files = new Map<string, Stored>();
  let nextId = 1;
  let clock = 0;

  // strictly increasing, and follows `Date.now()` so tests can drive the age of a file
  const iso = (): string => new Date((clock = Math.max(clock + 1, Date.now()))).toISOString();

  async function enter(op: string, name?: string): Promise<void> {
    if (o.hook) await o.hook(op);
    const f = o.fault?.(op, name, 'before');
    if (f) throw f;
  }
  function leave(op: string, name?: string): void {
    const f = o.fault?.(op, name, 'after');
    if (f) throw f;
  }
  const missing = (id: string): RemoteError => new RemoteError('not-found', 404, `no file ${id}`);
  const copyFile = (f: RemoteFile): RemoteFile => ({ ...f, appProperties: { ...f.appProperties } });

  return {
    kind: 'memory',
    async list(opts) {
      await enter('list');
      opts?.signal?.throwIfAborted();
      const out: RemoteFile[] = [];
      for (const s of files.values()) {
        if (s.hidden > 0) {
          s.hidden--;
          continue;
        }
        out.push(copyFile(s.file));
      }
      leave('list');
      return out;
    },
    async download(id, opts) {
      const name = files.get(id)?.file.name;
      await enter('download', name);
      opts?.signal?.throwIfAborted();
      const s = files.get(id);
      if (!s) throw missing(id);
      const bytes = s.bytes.slice();
      opts?.onProgress?.(bytes.length, bytes.length);
      leave('download', name);
      return bytes;
    },
    async create(name, bytes, opts) {
      await enter('create', name);
      opts?.signal?.throwIfAborted();
      const id = `f${nextId++}`;
      const file: RemoteFile = {
        id,
        name,
        bytes: bytes.length,
        version: '1',
        modifiedTime: iso(),
        appProperties: { ...(opts?.appProperties ?? {}) },
      };
      files.set(id, {
        file,
        bytes: bytes.slice(),
        hidden: name.startsWith('lib.') ? (o.listingLag?.ownLib ?? 0) : 0,
      });
      opts?.onProgress?.(bytes.length, bytes.length);
      leave('create', name);
      return copyFile(file);
    },
    async update(id, bytes, opts) {
      const name = files.get(id)?.file.name;
      await enter('update', name);
      opts?.signal?.throwIfAborted();
      const s = files.get(id);
      if (!s) throw missing(id);
      s.bytes = bytes.slice();
      s.file = {
        ...s.file,
        bytes: bytes.length,
        version: String(Number(s.file.version) + 1),
        modifiedTime: iso(),
      };
      leave('update', name);
      return copyFile(s.file);
    },
    async delete(id, opts) {
      const name = files.get(id)?.file.name;
      await enter('delete', name);
      opts?.signal?.throwIfAborted();
      if (!files.delete(id)) throw missing(id);
      leave('delete', name);
    },
    async about() {
      await enter('about');
      let usage = 0;
      for (const s of files.values()) usage += s.bytes.length;
      leave('about');
      return {
        email: 'tester@example.com',
        displayName: 'Tester',
        accountId: 'memory-account',
        usage,
        limit: null,
      };
    },
  };
}
