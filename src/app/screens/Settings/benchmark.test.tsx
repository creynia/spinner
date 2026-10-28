// The Benchmark screen runs the reference strategy through the real controller (in-thread workers
// here), shows the numbers, and leaves nothing in the store. Sessions are lowered to keep it fast.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInThreadTransport, createPool } from '@core';
import { roulette } from '@game/roulette';

vi.mock('../../services/pool', () => {
  let pool: ReturnType<typeof createPool> | null = null;
  return {
    poolSize: () => 2,
    getPool: () => {
      pool ??= createPool({
        size: 2,
        spawn: () => createInThreadTransport(roulette, { hop: 'microtask' }),
      });
      return pool;
    },
  };
});

vi.mock('./benchmark', async (orig) => {
  const m = await orig<Record<string, unknown>>();
  const real = m.startBenchmark as (n: number) => unknown;
  return { ...m, startBenchmark: () => real(200) };
});

import { activeRun, getCoreRepo } from '../../services/runs';
import { Benchmark } from './Benchmark';
import { benchmarkDefinition, startBenchmark, summarize, type BenchResult } from './benchmark';

afterEach(() => {
  cleanup();
  activeRun.set(null);
});

async function storeIsEmpty(): Promise<void> {
  const repo = await getCoreRepo();
  expect(await repo.listRuns()).toEqual([]);
  expect(
    (await repo.listDefinitions()).filter((d) => d.definition.tags?.includes('dry-run')),
  ).toEqual([]);
}

describe('benchmark', () => {
  it('the reference definition is 3-stage, 500 rounds, and 10,000 sessions by default', () => {
    const d = benchmarkDefinition();
    expect(d.run.sessions).toBe(10_000);
    expect(d.session.maxRounds).toBe(500);
    expect(d.strategy.stages.map((s) => s.id)).toEqual(['warm', 'mart', 'flat']);
    expect(benchmarkDefinition(200).run.sessions).toBe(200);
  });

  it('summarize derives rounds/s and the projected 10,000 x 500 time', () => {
    const r = summarize(2000, 2_500_000, 10_000, 3, 'abc');
    expect(r.roundsPerSec).toBe(1_250_000);
    expect(r.projectedMs).toBeCloseTo(4000);
  });

  it('shows the result card after Run and deletes the run from the store', async () => {
    render(<Benchmark />);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(document.querySelector('[data-bench]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Run benchmark' }));
    await waitFor(() => expect(document.querySelector('[data-bench]')).not.toBeNull(), {
      timeout: 60_000,
    });
    const b = JSON.parse(
      document.querySelector('[data-bench]')!.getAttribute('data-bench')!,
    ) as BenchResult;
    expect(b.sessions).toBe(200);
    expect(b.workers).toBeGreaterThanOrEqual(1);
    expect(b.digest).not.toBe('');
    expect(document.querySelector('[role=status] [data-field=rps]')).not.toBeNull();
    await storeIsEmpty();
  }, 70_000);

  it('cancel rejects, frees the baton and leaves the store empty', async () => {
    const h = startBenchmark(200);
    h.cancel();
    await expect(h.result).rejects.toThrow(/cancel/);
    await storeIsEmpty();
    const again = startBenchmark(50); // not refused: the first one released the flag
    await again.result;
    await storeIsEmpty();
  }, 70_000);

  it('refuses to start while a benchmark or a user run is active', async () => {
    const h = startBenchmark(50);
    expect(() => startBenchmark(50)).toThrow(/already running/);
    await h.result;
    activeRun.set({
      runId: 'x',
      status: 'running',
      completedSessions: 0,
      prefixSessions: 0,
      sessions: 1,
      sessionsPerSec: 0,
      etaMs: null,
      workers: 1,
    });
    render(<Benchmark />);
    fireEvent.click(screen.getByRole('button', { name: 'Run benchmark' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Another run/));
  }, 70_000);

  it('unmounting mid-run cancels it, sets no state and cleans the store', async () => {
    const { unmount } = render(<Benchmark />);
    fireEvent.click(screen.getByRole('button', { name: 'Run benchmark' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy());
    unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    await waitFor(async () => storeIsEmpty(), { timeout: 30_000 });
    const next = startBenchmark(10); // the baton was released by the unmounted run
    next.cancel();
    await expect(next.result).rejects.toThrow(/cancel/);
  }, 70_000);
});
