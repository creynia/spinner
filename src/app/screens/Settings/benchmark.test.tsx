// The Benchmark screen runs the reference definition through the real controller (in-thread
// workers here) and shows the numbers; the reference run is shrunk to keep the unit test fast.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
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

import { Benchmark } from './Benchmark';
import { benchmarkDefinition, summarize, type BenchResult } from './benchmark';

afterEach(cleanup);

describe('benchmark', () => {
  it('the reference definition is 10,000 x 500 with no session stops', () => {
    const d = benchmarkDefinition();
    expect(d.run.sessions).toBe(10_000);
    expect(d.session.maxRounds).toBe(500);
    expect(d.strategy.stages.map((s: { id: string }) => s.id)).toEqual(['warm', 'mart', 'flat']);
  });

  it('summarize derives rounds/s and the projected 10,000 x 500 time', () => {
    const r = summarize(2000, 2_500_000, 10_000, 3, 'abc');
    expect(r.roundsPerSec).toBe(1_250_000);
    expect(r.projectedMs).toBeCloseTo(4000);
  });

  it('shows idle structure, then the result card after Run', async () => {
    render(<Benchmark />);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    const btn = screen.getByRole('button', { name: 'Run benchmark' });
    expect(document.querySelector('[data-bench]')).toBeNull();
    fireEvent.click(btn);
    await waitFor(() => expect(document.querySelector('[data-bench]')).not.toBeNull(), {
      timeout: 120_000,
    });
    const b = JSON.parse(
      document.querySelector('[data-bench]')!.getAttribute('data-bench')!,
    ) as BenchResult;
    expect(b.sessions).toBe(10_000);
    expect(b.workers).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('[data-field=rps]')).not.toBeNull();
  }, 130_000);
});
