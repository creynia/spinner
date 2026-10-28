// Settings -> Benchmark this device (harness-data-analysis.md §14.2): runs the reference experiment
// through the real worker pool and store, then shows elapsed time, rounds/s and workers. The card
// carries the result as `data-bench` JSON for the perf spec and for phone runs. The run is deleted
// from the store once the numbers are read.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '@core/ui';
import { startBenchmark, type BenchHandle, type BenchResult } from './benchmark';

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

export function Benchmark() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<BenchResult | null>(null);
  const [error, setError] = useState('');
  const handle = useRef<BenchHandle | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      handle.current?.cancel();
    };
  }, []);

  const run = async (): Promise<void> => {
    setError('');
    let h: BenchHandle;
    try {
      h = startBenchmark();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('error');
      return;
    }
    handle.current = h;
    setState('running');
    try {
      const r = await h.result;
      if (!mounted.current) return;
      setResult(r);
      setState('done');
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setState('error');
    } finally {
      if (handle.current === h) handle.current = null;
    }
  };

  return (
    <>
      <h1>Benchmark</h1>
      <section
        class="card"
        data-state={state}
        data-bench={result && state === 'done' ? JSON.stringify(result) : undefined}
      >
        <h2>Reference run</h2>
        <p class="muted">
          10,000 sessions of 500 spins (three stages, no stops) through the real worker pool and
          store.
        </p>
        <Button onClick={() => void run()} disabled={state === 'running'}>
          Run benchmark
        </Button>
        {state === 'running' && <Button onClick={() => handle.current?.cancel()}>Cancel</Button>}
        <div role="status" aria-live="polite">
          {state === 'running' && <p>Running...</p>}
          {state === 'error' && <p>{error}</p>}
          {result && state === 'done' && (
            <dl>
              <dt>Elapsed</dt>
              <dd data-field="ms">
                {Math.round(result.ms)} ms ({formatSeconds(result.ms)})
              </dd>
              <dt>Rounds per second</dt>
              <dd data-field="rps">{Math.round(result.roundsPerSec).toLocaleString('en-US')}</dd>
              <dt>Workers</dt>
              <dd data-field="workers">{result.workers}</dd>
              <dt>Projected 10,000 x 500</dt>
              <dd data-field="projected">{formatSeconds(result.projectedMs)}</dd>
            </dl>
          )}
        </div>
      </section>
    </>
  );
}
