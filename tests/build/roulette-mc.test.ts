// Monte-Carlo vs exact (PLAYBOOK §12): the realized edge of each preset over a large seeded run is
// within 3 SE of the analytic edge. Both come from the harness summary columns:
//   realized edge = sum(net) / sum(wagered)         analytic edge = -sum(expectedLoss) / sum(wagered)
// The round-by-round differences (net + expected loss) are martingale differences even when the
// strategy adapts, so the variance of their sum is the sum of the analytic per-round variances,
// which the harness records in `variance`. SE = sqrt(sum(variance)) / sum(wagered).
// CI-sized by default; FULL=1 runs 20,000 sessions x 500 rounds.
import { describe, expect, it, vi } from 'vitest';
import type { Json } from '@core/contracts/game';
import { PRESET_IDS, rouletteDef, runAll, type RulesInput } from './roulette-helpers';

vi.setConfig({ testTimeout: 600_000 });

const FULL = process.env.FULL === '1';
const SESSIONS = FULL ? 20_000 : 4000;
const ROUNDS = FULL ? 500 : 250;

const o = (overrides: Record<string, Json>): RulesInput => ({ preset: 'european', overrides });
const SOME = ['martingale-red', 'james-bond', 'two-dozens-martingale', 'one-three-two-six-red'];
const CASES: { rules: RulesInput; name: string; presets: readonly string[] }[] = [
  { rules: 'european', name: 'european', presets: PRESET_IDS },
  { rules: 'american', name: 'american', presets: SOME },
  { rules: 'triple-zero', name: 'triple-zero', presets: SOME },
  { rules: o({ laPartage: true }), name: 'la partage', presets: SOME },
  { rules: o({ enPrison: true }), name: 'en prison', presets: SOME },
];

describe(`realized edge within 3 SE of the analytic edge (${SESSIONS} x ${ROUNDS})`, () => {
  for (const c of CASES)
    for (const preset of c.presets)
      it(`${preset} on ${c.name}`, () => {
        const def = rouletteDef(preset, { rules: c.rules, sessions: SESSIONS, maxRounds: ROUNDS });
        let net = 0;
        let wagered = 0;
        let expected = 0;
        let variance = 0;
        runAll(def, (out) => {
          for (let i = 0; i < out.count; i++) {
            net += out.table.net[i]!;
            wagered += out.table.wagered[i]!;
            expected += out.table.expectedLoss[i]!;
            variance += out.table.variance[i]!;
          }
        });
        expect(wagered).toBeGreaterThan(0);
        const realized = net / wagered;
        const analytic = -expected / wagered;
        const se = Math.sqrt(variance) / wagered;
        const z = (realized - analytic) / se;
        console.info(
          `${preset} / ${c.name}: realized ${(realized * 100).toFixed(3)}% analytic ${(analytic * 100).toFixed(3)}% SE ${(se * 100).toFixed(3)}% z ${z.toFixed(2)}`,
        );
        expect(analytic).toBeLessThan(0);
        expect(Math.abs(realized - analytic)).toBeLessThan(3 * se);
      });
});
