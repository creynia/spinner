// Drives a real small roulette run (in-thread workers) through the Run and Analyze screens.
import { cleanup, render, waitFor } from '@testing-library/preact';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createInThreadTransport,
  createPool,
  normalizeDefinition,
  type NormalizedDefinition,
} from '@core';
import { roulette } from '@game/roulette';
import { Analyze } from '@app/screens/Analyze';
import { Run } from '@app/screens/Run';
import { setPoolForTests } from '@app/services/pool';
import { getController, startRun } from '@app/services/runs';
import { onRunActive } from '../../src/pwa/register';

const strategy = JSON.parse(
  readFileSync('src/game/roulette/presets/martingale-red.json', 'utf8'),
) as unknown;

let definition: NormalizedDefinition;
beforeAll(() => {
  const res = normalizeDefinition(
    {
      schema: 1,
      name: 'Martingale test',
      game: { id: 'roulette', rules: 'european' },
      strategy: strategy as never,
      session: { bankroll: 500_000, maxRounds: 60 },
      run: { sessions: 400, seed: 11 },
    },
    { plugin: roulette, resolveStrategyRef: () => undefined },
  );
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  definition = res.definition;
  setPoolForTests(
    createPool({
      size: 2,
      spawn: () => createInThreadTransport(roulette, { hop: 'timeout' }),
    }),
  );
});
afterEach(cleanup);

describe('Run to Analyze with a real roulette run', () => {
  it('shows progress and live charts, finishes, then analyzes', async () => {
    const active: boolean[] = [];
    const off = onRunActive((a) => active.push(a));
    const runId = await startRun(definition);
    const run = render(<Run params={{ runId }} query={new URLSearchParams()} />);
    await waitFor(() => expect(run.container.querySelector('[role=progressbar]')).not.toBeNull());
    await waitFor(
      () => expect(run.container.querySelector('[data-status="done"]')).not.toBeNull(),
      { timeout: 30_000 },
    );
    expect(run.container.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe(
      '100',
    );
    const analyze = run.container.querySelector('a[href^="#/analyze/"]');
    expect(analyze?.textContent).toBe('Analyze');
    expect(getController(runId)?.status).toBe('done');
    expect(active).toContain(true);
    await waitFor(() => expect(active[active.length - 1]).toBe(false));
    off();
    cleanup();

    const an = render(<Analyze params={{ runId }} query={new URLSearchParams()} />);
    await waitFor(() => expect(an.container.querySelector('[data-verdict]')).not.toBeNull());
    expect(an.container.querySelector('h1')?.textContent).toContain('Martingale test');
    expect(an.container.querySelectorAll('[role=tab]')).toHaveLength(7);
    expect(an.container.querySelector('[data-verdict]')?.textContent).toMatch(/P\(ahead\)/);
    expect(an.container.querySelector('[data-metric="p-bust"]')).not.toBeNull();
  }, 60_000);

  it('a run id that does not exist shows a not-found card, not a crash', async () => {
    const r = render(<Run params={{ runId: 'nope-nope' }} query={new URLSearchParams()} />);
    await waitFor(() => expect(r.container.querySelector('[role=alert]')).not.toBeNull());
    expect(r.container.querySelectorAll('h1')).toHaveLength(1);
  });
});
