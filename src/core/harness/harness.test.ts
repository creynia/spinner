import { describe, expect, it } from 'vitest';
import { CORE_VERSION } from '../contracts/version';
import { SIM_PROTOCOL, type FromSim } from '../contracts/protocol';
import { coin } from '../testing';
import { createWorkerHandler } from './index';

describe('worker handler (WP0: ping only)', () => {
  const handle = createWorkerHandler(coin);
  const collect = (msg: Parameters<typeof handle>[0]): FromSim[] => {
    const out: FromSim[] = [];
    handle(msg, (m) => out.push(m));
    return out;
  };

  it('answers ping with pong carrying the protocol, core and game versions', () => {
    expect(collect({ t: 'ping' })).toEqual([
      {
        t: 'pong',
        protocol: SIM_PROTOCOL,
        coreVersion: CORE_VERSION,
        game: { id: 'coin', version: coin.version },
      },
    ]);
  });
  it('answers everything else with a not-implemented error, dispose with nothing', () => {
    expect(collect({ t: 'dispose' })).toEqual([]);
    const [err] = collect({
      t: 'batch',
      runKey: 'k',
      batchId: 1,
      firstChunk: 0,
      chunkCount: 1,
      traceIndices: [],
    });
    expect(err).toMatchObject({ t: 'error', code: 'not-implemented' });
  });
});
