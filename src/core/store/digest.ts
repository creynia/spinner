import type { Json } from '../contracts/game';
import type { RunData } from '../contracts/run';
import { canonicalJson, sha256Hex } from '../experiment';
import { columnsOf, leBytes } from './columns';

/**
 * `resultsDigest` (harness-data-analysis.md §2 rule 6): SHA-256 over, in order,
 *  1. the canonical JSON of `{ definitionId, gameVersion, coreVersion, sessions, chunkSize,
 *     schedule, columns: [name, dtype, width] }`;
 *  2. the little-endian bytes of every summary column in column order, then the checkpoint matrix;
 *  3. the chunk-stats arrays in the fixed order `expCum, catExpected, stageWagered, stageNet,
 *     stageExpected, transitions`, then the canonical JSON of
 *     `{ chunks, errorCount, errors, rejectedByReason, deferredByReason }`;
 *  4. the canonical JSON of `samples`.
 * Every part is preceded by its byte length (u32 LE, high word then low word) so the
 * concatenation is unambiguous. The digest depends on results only, never on timings or storage.
 */
export async function resultsDigest(data: RunData): Promise<string> {
  const { meta } = data;
  const enc = new TextEncoder();
  const header = canonicalJson({
    definitionId: meta.definitionId,
    gameVersion: meta.gameVersion,
    coreVersion: meta.coreVersion,
    sessions: data.sessions,
    chunkSize: meta.chunkSize,
    schedule: Array.from(data.checkpoints.schedule),
    columns: meta.columns.map((c) => [c.name, c.dtype, c.width]),
  });
  const cs = data.chunkStats;
  const tail = canonicalJson({
    chunks: cs.chunks,
    errorCount: cs.errorCount,
    errors: cs.errors,
    rejectedByReason: cs.rejectedByReason,
    deferredByReason: cs.deferredByReason,
  } as unknown as Json);
  const cols = columnsOf(data.summary);
  const parts: Uint8Array[] = [enc.encode(header)];
  for (const spec of meta.columns) parts.push(leBytes(cols[spec.name]));
  parts.push(leBytes(data.checkpoints.equity));
  parts.push(
    leBytes(cs.expCum),
    leBytes(cs.catExpected),
    leBytes(cs.stageWagered),
    leBytes(cs.stageNet),
    leBytes(cs.stageExpected),
    leBytes(cs.transitions),
    enc.encode(tail),
    enc.encode(canonicalJson(data.samples as unknown as Json)),
  );
  let total = 0;
  for (const p of parts) total += p.length + 8;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  let o = 0;
  for (const p of parts) {
    dv.setUint32(o, Math.floor(p.length / 4294967296), true);
    dv.setUint32(o + 4, p.length >>> 0, true);
    buf.set(p, o + 8);
    o += 8 + p.length;
  }
  return sha256Hex(buf);
}
