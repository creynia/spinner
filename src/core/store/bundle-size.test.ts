// Reconciliation A2: measure a realistic gallery bundle (10,000 x 500, 12 bet categories) and keep
// it under the 2 MB gallery limit with the gallery trim (48 checkpoints, <= 6 samples).
import { describe, expect, it } from 'vitest';
import { makeRun } from './__fixtures__/synth';
import { decodeRunBundle, encodeRunBundle, GALLERY_MAX_BUNDLE_BYTES, resultsDigest } from './index';

const CASES: [string, Parameters<typeof makeRun>[0]][] = [
  [
    'martingale, no stop-win (sessions play to the cap or bust)',
    { sessions: 10_000, maxRounds: 500, samples: 24, stopWin: 0 },
  ],
  [
    'pessimistic: every round also bets a random category (all 24 category columns noisy)',
    { sessions: 10_000, maxRounds: 500, samples: 24, stopWin: 0, allCategories: true },
  ],
];

describe('gallery bundle size', () => {
  it.each(CASES)(
    '10,000 x 500, 12 categories, trimmed, is at most 2 MB: %s',
    async (label, opts) => {
      const run = await makeRun({ ...opts, chunkSize: 32, checkpoints: 128 });
      expect(run.meta.labels.categories).toHaveLength(12);
      expect(run.meta.schedule).toHaveLength(128);
      const trimmed = await encodeRunBundle(run, { gzip: true, trimForGallery: true });
      const untrimmed = await encodeRunBundle(run, { gzip: true });
      const plain = await encodeRunBundle(run, { gzip: false, trimForGallery: true });
      console.info(
        `bundle sizes [${label}]: trimmed.gz ${trimmed.length} B (${(trimmed.length / 1048576).toFixed(3)} MiB), ` +
          `trimmed json ${plain.length} B, untrimmed.gz ${untrimmed.length} B, limit ${GALLERY_MAX_BUNDLE_BYTES} B`,
      );
      expect(trimmed.length).toBeLessThanOrEqual(GALLERY_MAX_BUNDLE_BYTES);
      const back = await decodeRunBundle(trimmed, 'roulette');
      if ('error' in back) throw new Error(back.error);
      expect(back.data.sessions).toBe(10_000);
      expect(back.data.samples.length).toBeLessThanOrEqual(6);
      expect(back.data.checkpoints.schedule).toHaveLength(48);
      expect(back.data.meta.resultsDigest).toBe(await resultsDigest(run));
    },
    120_000,
  );
});
