// encodeRunBundleWithDigest: a thin wrapper over encodeRunBundle (sync.md §4.1).
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { makeRun } from './__fixtures__/synth';
import { encodeRunBundle, encodeRunBundleWithDigest, resultsDigest } from './index';

const run = await makeRun({
  sessions: 20,
  maxRounds: 40,
  chunkSize: 8,
  samples: 3,
  checkpoints: 12,
});

describe('encodeRunBundleWithDigest', () => {
  it.each([false, true])('returns the same bytes as encodeRunBundle (gzip %s)', async (gzip) => {
    const a = await encodeRunBundle(run, { gzip });
    const b = await encodeRunBundleWithDigest(run, { gzip });
    expect(b.bytes.length).toBe(a.length);
    expect(Buffer.from(b.bytes).equals(Buffer.from(a))).toBe(true); // not toEqual: multi-MB safe
  });
  it('reports the digest written into the bundle', async () => {
    const { bytes, resultsDigest: d } = await encodeRunBundleWithDigest(run, { gzip: true });
    const bundle = JSON.parse(gunzipSync(bytes).toString('utf8')) as {
      meta: { resultsDigest: string };
    };
    expect(d).toBe(bundle.meta.resultsDigest);
    expect(d).toBe(run.meta.resultsDigest ?? (await resultsDigest(run)));
  });
});

describe('encodeRunBundle bytes are pinned', () => {
  // Computed from origin/main's encoder before the WithDigest refactor: the sync swarm must not
  // change a single byte of the run bundle format.
  it('gzip-off bytes of the synthetic run', async () => {
    const b = await encodeRunBundle(run, { gzip: false });
    expect(b.length).toBe(37659);
    expect(createHash('sha256').update(b).digest('hex')).toBe(
      '6be79bda3f9682c7f12488ed07130ce5a62f710febfb069a75a743873f4ef9b8',
    );
  });
});
