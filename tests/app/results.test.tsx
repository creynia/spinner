// Drives a real small roulette run (in-thread workers) through the Run and Analyze screens.
import { cleanup, render, waitFor } from '@testing-library/preact';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createInThreadTransport,
  decodeRunBundle,
  definitionId,
  encodeRunBundle,
  resultsDigest,
  createPool,
  normalizeDefinition,
  type NormalizedDefinition,
} from '@core';
import { roulette } from '@game/roulette';
import { Analyze } from '@app/screens/Analyze';
import { Run } from '@app/screens/Run';
import { liveCharts, livePrefix } from '@app/screens/Run/useRun';
import { setPoolForTests } from '@app/services/pool';
import {
  describeRun,
  dryRunDefinitionIds,
  getController,
  isActive,
  getCoreRepo,
  isDryRunDefinition,
  listRecentRuns,
  startRun,
} from '@app/services/runs';
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

  it('describeRun gives the stub verdict of a done run, and isActive is false once it ends', async () => {
    const runId = await startRun(definition);
    const c = getController(runId)!;
    expect(isActive(runId)).toBe(true);
    while (c.status !== 'done') await c.settled();
    await waitFor(() => expect(isActive()).toBe(false));
    const meta = (await (await getCoreRepo()).getRun(runId))!;
    const v = await describeRun(meta);
    const listed = (await listRecentRuns(50)).find((r) => r.runId === runId)!.verdict!;
    expect(v).toEqual(listed);
    expect(v?.n).toBe(meta.completedSessions);
    expect(await describeRun({ ...meta, status: 'paused' })).toBeUndefined();
  }, 60_000);

  it('a run id that does not exist shows a not-found card, not a crash', async () => {
    const r = render(<Run params={{ runId: 'nope-nope' }} query={new URLSearchParams()} />);
    await waitFor(() => expect(r.container.querySelector('[role=alert]')).not.toBeNull());
    expect(r.container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('a run started by services/runs.startRun exports (json and gz) and imports back', async () => {
    const runId = await startRun(definition);
    const c = getController(runId)!;
    while (c.status !== 'done') await c.settled();
    const repo = await getCoreRepo();
    const data = (await repo.loadRun(runId))!;
    expect(data.meta.definitionId).toBe(await definitionId(definition));
    expect(data.meta.resultsDigest).toBe(await resultsDigest(data));
    for (const gzip of [false, true]) {
      const bytes = await encodeRunBundle(data, { gzip });
      expect(gzip ? bytes[0] === 0x1f && bytes[1] === 0x8b : bytes[0] === 0x7b).toBe(true);
      const back = await decodeRunBundle(bytes, 'roulette');
      if ('error' in back) throw new Error(back.error);
      expect(back.data.meta.definitionId).toBe(data.meta.definitionId);
      expect(await resultsDigest(back.data)).toBe(data.meta.resultsDigest);
      expect(back.data.sessions).toBe(data.sessions);
    }
  }, 60_000);

  it('dry-run runs stay out of the recent list and the pickers', async () => {
    const dry = { ...definition, name: 'Dry', tags: ['dry-run'] };
    const runId = await startRun(dry);
    const c = getController(runId)!;
    while (c.status !== 'done') await c.settled();
    expect((await listRecentRuns(50)).some((r) => r.runId === runId)).toBe(false);
    expect((await dryRunDefinitionIds()).size).toBeGreaterThan(0);
    const defs = await (await getCoreRepo()).listDefinitions();
    expect(defs.filter(isDryRunDefinition).map((d) => d.definition.name)).toEqual(['Dry']);
    expect((await (await getCoreRepo()).loadRun(runId))?.meta.status).toBe('done');
  }, 60_000);

  it('live charts read a bounded whole-chunk prefix', async () => {
    const runId = await startRun(definition);
    const c = getController(runId)!;
    while (c.status !== 'done') await c.settled();
    const data = (await (await getCoreRepo()).loadRun(runId))!;
    const p = livePrefix(data, 10);
    expect(p.sessions).toBeLessThan(data.sessions);
    expect(p.sessions % data.meta.chunkSize).toBe(0);
    const t0 = performance.now();
    const live = liveCharts(data);
    expect(live.fan?.rounds.length).toBeGreaterThan(1);
    expect(performance.now() - t0).toBeLessThan(500);
  }, 60_000);
});
