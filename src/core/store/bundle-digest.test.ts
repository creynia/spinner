// encodeRunBundleWithDigest: a thin wrapper over encodeRunBundle (sync.md §4.1).
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
