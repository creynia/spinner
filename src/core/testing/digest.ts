// A content digest of `RunData` for determinism tests: every summary column, the checkpoint
// matrix, every chunk-stats array and the samples, byte for byte (cyrb53-style, two 32-bit lanes).
// `resultsDigest` (sha256, canonical JSON) lives in core/store; this is only for comparing runs.
import type { RunData } from '../contracts/run';
import { COLUMN_ORDER } from '../harness/columns';

class Hasher {
  private h1 = 0xdeadbeef;
  private h2 = 0x41c6ce57;
  bytes(b: Uint8Array): void {
    let { h1, h2 } = this;
    for (let i = 0; i < b.length; i++) {
      const c = b[i]!;
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    this.h1 = h1;
    this.h2 = h2;
  }
  array(a: ArrayBufferView): void {
    this.bytes(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  }
  text(s: string): void {
    this.bytes(new TextEncoder().encode(s));
  }
  hex(): string {
    let { h1, h2 } = this;
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }
}

function sortedJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : x,
  );
}

export function digestRunData(data: RunData): string {
  const h = new Hasher();
  h.text(
    sortedJson({ sessions: data.sessions, labels: data.meta.labels, columns: data.meta.columns }),
  );
  h.array(data.checkpoints.schedule);
  for (const name of COLUMN_ORDER) {
    h.array((data.summary as unknown as Record<string, ArrayBufferView>)[name]!);
  }
  h.array(data.checkpoints.equity);
  const cs = data.chunkStats;
  h.text(String(cs.chunks));
  for (const a of [
    cs.expCum,
    cs.catExpected,
    cs.stageWagered,
    cs.stageNet,
    cs.stageExpected,
    cs.transitions,
  ]) {
    h.array(a);
  }
  h.text(sortedJson([cs.rejectedByReason, cs.deferredByReason, cs.errors, cs.errorCount]));
  h.text(sortedJson(data.samples));
  return h.hex();
}
