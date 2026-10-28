// State of one run for the Run screen: stored meta, the live controller (if this page owns it),
// progress events, and live chart data throttled to about 4 Hz.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { FanChart, Histogram } from '@core/contracts/analysis';
import type { RunMeta, RunProgress } from '@core/contracts/run';
import { fanChart, histogramFD } from '@core';
import { activeRun, getController, readRunMeta } from '../../services/runs';
import { loadRunData } from '../Analyze/data';

export interface LiveCharts {
  fan: FanChart | null;
  histogram: Histogram | null;
  sessions: number;
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
          const net = data.summary.net.subarray(0, data.sessions);
          const histogram = histogramFD(net, { integer: true, markers: { zero: 0 } });
          setLive({ fan: fanChart(data, { live: true }), histogram, sessions: data.sessions });
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
        const net = data.summary.net.subarray(0, data.sessions);
        setLive({
          fan: fanChart(data, { live: true }),
          histogram: histogramFD(net, { integer: true, markers: { zero: 0 } }),
          sessions: data.sessions,
        });
      })
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, [runId, running, completed, meta, controller]);

  return { meta, progress, controller, live, refresh };
}
