// WP-S2c test helpers: real (tiny) runs on a device, a recording remote, and a forged lib file.
// Not exported from the barrel.
import type { RunData, RunMeta } from '../../contracts/run';
import type { RemoteFile, RemoteStore, RunStub, SyncEntry } from '../../contracts/sync';
import {
  createRepo,
  decodeRunBundle,
  encodeRunBundleWithDigest,
  writeCompacted,
} from '../../store';
import { makeRun } from '../../store/__fixtures__/synth';
import { type Dev, ISO, indexOf } from '../engine-testkit';
import { entryOf } from '../fingerprint';
import { encodeLib, LIB_NAME } from '../libfile';
import { hlcOf } from '../testkit';

/** A small finished run; `n` changes the results (and so the digest) and the run id. */
export async function tinyRun(n: number, name = `Run def ${n % 2}`): Promise<RunData> {
  const data = await makeRun({
    sessions: 12,
    maxRounds: 20,
    chunkSize: 4,
    samples: 2,
    checkpoints: 8,
    seed: 100 + n,
    name,
  });
  const runId = `${data.meta.runId}-${n}`;
  return { ...data, meta: { ...data.meta, runId } };
}

/** A device finishes a run: results and definition through the TRACKED backend (marks appear). */
export async function finishRun(d: Dev, data: RunData): Promise<RunMeta> {
  return writeCompacted(d.tracked, data, data.meta);
}

/** A device imports a file (same runId and digest on every device that imports it). */
export async function importRunFile(d: Dev, data: RunData, trimmed = false): Promise<string> {
  const enc = await encodeRunBundleWithDigest(data, {
    gzip: true,
    ...(trimmed ? { trimForGallery: true } : {}),
  });
  const dec = await decodeRunBundle(enc.bytes, 'roulette', { now: () => ISO });
  if ('error' in dec) throw new Error(dec.error);
  const res = await createRepo(d.tracked).importRun(dec.data);
  return res.runId;
}

/** A non-done run (paused, cancelled, error) written through the tracked backend. */
export async function putStubRun(d: Dev, base: RunMeta, status: RunMeta['status']): Promise<void> {
  const meta: RunMeta = {
    ...base,
    status,
    completedSessions: 5,
    prefixSessions: 5,
    ...(status === 'error' ? { error: { code: 'x', message: 'boom' } } : {}),
  };
  delete (meta as { resultsDigest?: string }).resultsDigest;
  await d.tracked.tx(['runs'], 'readwrite', (t) => t.put('runs', meta));
}

export interface Log {
  /** `op name` of every call, in order. */
  ops: string[];
  createOpts: { name: string; resumeKey: string | undefined }[];
}

/** A pass-through remote that records the calls (and the `create` options). */
export function recording(inner: RemoteStore, log: Log): RemoteStore {
  return {
    kind: inner.kind,
    list: (o) => (log.ops.push('list'), inner.list(o)),
    download: (id, o) => (log.ops.push('download'), inner.download(id, o)),
    create: (name, b, o) => (
      log.ops.push(`create ${name}`),
      log.createOpts.push({ name, resumeKey: o?.resumeKey }),
      inner.create(name, b, o)
    ),
    update: (id, b, o) => (log.ops.push('update'), inner.update(id, b, o)),
    delete: (id, o) => (log.ops.push('delete'), inner.delete(id, o)),
    about: () => inner.about(),
  };
}

export const newLog = (): Log => ({ ops: [], createOpts: [] });

export const bundleFiles = async (r: RemoteStore): Promise<RemoteFile[]> =>
  (await r.list()).filter((f) => f.name.startsWith('run.'));

export const runStubs = async (d: Dev): Promise<Map<string, RunStub>> => {
  const out = new Map<string, RunStub>();
  for (const [k, row] of await indexOf(d)) {
    if (k.startsWith('run:') && !row.entry.deleted) out.set(k.slice(4), row.entry.value as RunStub);
  }
  return out;
};

/**
 * Publishes a lib file for `device` holding `entries` (built with `entryOf`), written at
 * `writtenAt`: a peer that was never an engine in the test.
 */
export async function forgeLib(
  remote: RemoteStore,
  device: string,
  entries: SyncEntry[],
  writtenAt: string,
): Promise<RemoteFile> {
  const bytes = await encodeLib({
    format: 'spinner-sync-lib',
    version: 1,
    device: {
      id: device,
      name: `forged-${device.slice(0, 2)}`,
      appVersion: '1.0.0',
      coreVersion: '1',
    },
    hlc: entries.reduce((m, e) => (e.hlc > m ? e.hlc : m), hlcOf(1, device)),
    writtenAt,
    entries,
  });
  return remote.create(LIB_NAME(device), bytes, { appProperties: { kind: 'lib', device } });
}

export { entryOf };
