// A run that settles between the first render and the subscribe effect must not leave the Run
// screen on its seeded "running" progress, and overlapping refreshes must not drop the last one.
import { cleanup, renderHook, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunMeta, RunProgress, RunStatus } from '@core/contracts/run';

const h = vi.hoisted(() => ({
  active: null as object | null,
  controller: undefined as object | undefined,
  readRunMeta: vi.fn(),
}));

vi.mock('../../services/runs', () => ({
  activeRun: { get: () => h.active },
  getController: () => h.controller,
  readRunMeta: (id: string) => h.readRunMeta(id) as unknown,
}));
vi.mock('../Analyze/data', () => ({ loadRunData: () => Promise.resolve(null) }));

import { useRun } from './useRun';

const meta = (status: RunStatus) => ({ runId: 'r1', status, completedSessions: 30 }) as RunMeta;
const running = {
  runId: 'r1',
  status: 'running',
  completedSessions: 30,
  totalSessions: 30,
} as unknown as RunProgress;

/** A controller whose run already settled: its `done` notification went out before anyone listened. */
function settledController(status: RunStatus) {
  return { runId: 'r1', status, subscribe: () => () => undefined, snapshot: () => ({}) };
}

beforeEach(() => {
  h.active = running;
  h.controller = settledController('done');
  h.readRunMeta.mockReset();
  h.readRunMeta.mockResolvedValue(meta('done'));
});
afterEach(cleanup);

describe('useRun: late subscriber', () => {
  it('drops the seeded running progress when the controller already settled', async () => {
    const { result } = renderHook(() => useRun('r1'));
    await waitFor(() => expect(result.current.meta?.status).toBe('done'));
    // The screen shows `progress.status` while a controller is present: it must not say running.
    expect(result.current.progress?.status ?? result.current.meta?.status).toBe('done');
  });

  it('keeps the seeded progress while the controller is still running', async () => {
    h.controller = settledController('running');
    h.readRunMeta.mockResolvedValue(meta('running'));
    const { result } = renderHook(() => useRun('r1'));
    await waitFor(() => expect(result.current.meta?.status).toBe('running'));
    expect(result.current.progress?.status).toBe('running');
  });
});

describe('useRun: refresh coalesces', () => {
  it('re-reads once more when called during a read, so meta is not stale', async () => {
    h.controller = undefined;
    let release: (m: RunMeta) => void = () => undefined;
    h.readRunMeta
      .mockImplementationOnce(() => new Promise<RunMeta>((r) => (release = r)))
      .mockResolvedValue(meta('done'));
    const { result } = renderHook(() => useRun('r1'));
    await waitFor(() => expect(h.readRunMeta).toHaveBeenCalledTimes(1));
    void result.current.refresh(); // arrives while the first read is in flight
    release(meta('running')); // the first read returns the stale value
    await waitFor(() => expect(result.current.meta?.status).toBe('done'));
    expect(h.readRunMeta).toHaveBeenCalledTimes(2);
  });
});
