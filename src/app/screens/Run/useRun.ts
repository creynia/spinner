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

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      setMeta(await readRunMeta(runId));
      setController(getController(runId));
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
    return controller.subscribe((p) => {
      setProgress(p);
      if (p.status !== 'running' && p.status !== 'queued') void refresh();
    });
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
