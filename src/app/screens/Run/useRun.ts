// State of one run for the Run screen: stored meta, the live controller (if this page owns it),
// progress events, and live chart data throttled to about 4 Hz.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { FanChart, Histogram } from '@core/contracts/analysis';
import type { RunData, RunMeta, RunProgress } from '@core/contracts/run';
import { fanChart, histogramFD } from '@core';
import { activeRun, getController, readRunMeta } from '../../services/runs';
import { loadRunData } from '../Analyze/data';

export interface LiveCharts {
  fan: FanChart | null;
  histogram: Histogram | null;
  sessions: number;
}

/** Live charts read a bounded prefix so one refresh stays well under 50 ms at 100k sessions. */
export const LIVE_FAN_SESSIONS = 2000;
export const LIVE_HISTOGRAM_SESSIONS = 20_000;

/** The first whole chunks of `data`, at most about `max` sessions (a valid prefix, no bias). */
export function livePrefix(data: RunData, max: number): RunData {
  const size = Math.max(1, data.meta.chunkSize);
  const chunks = Math.max(1, Math.ceil(max / size));
  const k = Math.min(data.sessions, chunks * size);
  if (k >= data.sessions) return data;
  return {
    ...data,
    sessions: k,
    summary: { ...data.summary, sessions: k },
    meta: { ...data.meta, prefixSessions: k },
  };
}

/** Live fan and histogram from the controller's in-memory data. */
export function liveCharts(data: RunData): LiveCharts {
  const h = livePrefix(data, LIVE_HISTOGRAM_SESSIONS);
  return {
    fan: fanChart(livePrefix(data, LIVE_FAN_SESSIONS), { live: true }),
    histogram: histogramFD(h.summary.net.subarray(0, h.sessions), {
      integer: true,
      markers: { zero: 0 },
    }),
    sessions: data.sessions,
  };
}

const EMPTY: LiveCharts = { fan: null, histogram: null, sessions: 0 };
export const LIVE_MS = 250;

export function useRun(runId: string) {
  const [meta, setMeta] = useState<RunMeta | null | undefined>(undefined);
  const [progress, setProgress] = useState<RunProgress | null>(() => {
    const a = activeRun.get();
    return a && a.runId === runId ? a : null;
  });
  const [controller, setController] = useState(() => getController(runId));
  const [live, setLive] = useState<LiveCharts>(EMPTY);
  const refreshing = useRef(false);
  const again = useRef(false);

  // Coalescing: a call made while a read is in flight asks for one more read after it, so the
  // last request always sees the newest store state (it is never dropped).
  const refresh = useCallback(async () => {
    if (refreshing.current) {
      again.current = true;
      return;
    }
    refreshing.current = true;
    try {
      do {
        again.current = false;
        setMeta(await readRunMeta(runId));
        setController(getController(runId));
      } while (again.current);
    } catch {
      setMeta(null);
    } finally {
      refreshing.current = false;
    }
  }, [runId]);

  useEffect(() => {
    setMeta(undefined);
    setLive(EMPTY);
    void refresh();
  }, [runId, refresh]);

  // Progress events from the controller this page owns.
  useEffect(() => {
    if (!controller) return;
    const off = controller.subscribe((p) => {
      setProgress(p);
      if (p.status !== 'running' && p.status !== 'queued') void refresh();
    });
    // A quick run can settle between the first render and this effect, so its final notification
    // went out before we listened: drop the seeded (stale, "running") progress and re-read the store.
    if (controller.status !== 'running' && controller.status !== 'queued') {
      setProgress(null);
      void refresh();
    }
    return off;
  }, [controller, refresh]);

  // A run owned by another tab (or finished elsewhere): poll the store.
  useEffect(() => {
    if (controller) return;
    if (meta && meta.status !== 'running' && meta.status !== 'queued') return;
    const t = setInterval(() => void refresh(), 2000);
    return () => clearInterval(t);
  }, [controller, meta, refresh]);

  // Live charts: snapshot the controller's in-memory prefix, never faster than ~4 Hz.
  const status = progress?.status ?? controller?.status;
  const running = status === 'running';
  useEffect(() => {
    if (!controller || !running) return;
    let stop = false;
    let delay = LIVE_MS;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (stop) return;
      const t0 = performance.now();
      try {
        const data = controller.snapshot();
        if (data.sessions > 0) {
          setLive(liveCharts(data));
        }
      } catch {
        // not started yet
      }
      delay = Math.max(LIVE_MS, (performance.now() - t0) * 3);
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, 50);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [controller, running]);

  // Not running here: show what is stored (the completed prefix) once per change.
  const completed = meta?.completedSessions ?? 0;
  useEffect(() => {
    if (running || controller?.status === 'running') return;
    if (meta === undefined || meta === null || completed === 0) return;
    let on = true;
    loadRunData(runId)
      .then((data) => {
        if (!on || !data || data.sessions === 0) return;
        setLive(liveCharts(data));
      })
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, [runId, running, completed, meta, controller]);

  return { meta, progress, controller, live, refresh };
}

/**
 * Elapsed time to show: the stored total (`timing.elapsedMs`, only updated when a run segment ends)
 * plus the running segment seen by this page.
 */
export function elapsedNow(storedMs: number, segmentStart: number | null, now: number): number {
  return storedMs + (segmentStart === null ? 0 : Math.max(0, now - segmentStart));
}

/** Ticks once a second while `running`, so "Time spent" moves during a run. */
export function useElapsed(storedMs: number, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  const start = useRef<number | null>(null);
  if (running && start.current === null) start.current = Date.now();
  if (!running) start.current = null;
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return elapsedNow(storedMs, start.current, now);
}
