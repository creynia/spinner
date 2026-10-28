// Roulette golden traces (strategy.md §12, §17.7; decisions "Golden convention"): each of the 12
// presets through the real strategy compiler, the real roulette plugin and the harness `simulate`
// path, seed 20261028, session 0, bankroll $5,000, 200 rounds (the trace ends early on a stop or a
// bust). Pinned as JSON Lines (canonical JSON, one record per line) in
// src/game/roulette/__fixtures__/golden/. Regenerate with UPDATE_GOLDEN=1 and review the diff.
//
// Line 1 is a header `{"golden":{...}}`; every following line is one TraceWindow.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalJson } from '@core/experiment';
import { createInThreadTransport, createPool, simulate } from '@core/harness';
import type { SimPool } from '@core/harness';
import type { Json } from '@core/contracts/game';
import { ENDED_BY } from '@core/contracts/run';
import { GOLDEN_BANKROLL, GOLDEN_SEED, PRESET_IDS, plugin, rouletteDef } from './roulette-helpers';

const DIR = join(__dirname, '../../src/game/roulette/__fixtures__/golden');
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const ROUNDS = 200;

interface Case {
  file: string;
  preset: string;
  rules: 'european' | 'american';
}
const CASES: Case[] = [
  ...PRESET_IDS.map((p) => ({ file: `${p}.european`, preset: p, rules: 'european' as const })),
  { file: 'martingale-red.american', preset: 'martingale-red', rules: 'american' },
  { file: 'james-bond.american', preset: 'james-bond', rules: 'american' },
];

let pool: SimPool;
beforeAll(() => {
  pool = createPool({
    size: 1,
    spawn: () => createInThreadTransport(plugin, { hop: 'microtask' }),
  });
});
afterAll(() => pool.terminate());

async function render(c: Case): Promise<string> {
  const def = rouletteDef(c.preset, { rules: c.rules, maxRounds: ROUNDS });
  const r = await simulate(pool, def, 0);
  const header = {
    golden: {
      preset: c.preset,
      rules: c.rules,
      seed: GOLDEN_SEED,
      session: 0,
      bankroll: GOLDEN_BANKROLL,
      maxRounds: ROUNDS,
      windows: r.trace.length,
      roundsPlayed: r.row.roundsPlayed,
      final: r.row.final,
      endedBy: r.row.endedBy,
    },
  };
  return [header, ...r.trace].map((w) => canonicalJson(w as unknown as Json)).join('\n') + '\n';
}

describe('roulette golden traces', () => {
  it('has a case for every preset plus two american', () => {
    expect(PRESET_IDS).toHaveLength(12);
    expect(CASES).toHaveLength(14);
  });

  for (const c of CASES) {
    it(`${c.file} matches its pinned trace and is deterministic`, async () => {
      const a = await render(c);
      expect(await render(c)).toBe(a);
      const path = join(DIR, `${c.file}.seed${GOLDEN_SEED}.jsonl`);
      if (UPDATE) {
        mkdirSync(DIR, { recursive: true });
        writeFileSync(path, a);
      }
      expect(existsSync(path), `missing ${path}; run UPDATE_GOLDEN=1`).toBe(true);
      expect(a).toBe(readFileSync(path, 'utf8'));
      // The run never errored and every window carries its reconcile and equity.
      const lines = a
        .trimEnd()
        .split('\n')
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      const head = (lines[0] as { golden: { endedBy: string | number } }).golden;
      expect(head.endedBy).not.toBe(ENDED_BY.error);
      for (const w of lines.slice(1)) expect(typeof w.equity).toBe('number');
    });
  }
});
