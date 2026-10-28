// Settings -> Benchmark this device (harness-data-analysis.md §14.2): runs the reference experiment
// through the real worker pool and store, then shows elapsed time, rounds/s and workers. The card
// carries the result as `data-bench` JSON for the perf spec and for phone runs.
import { useState } from 'preact/hooks';
import { Button } from '@core/ui';
import { runBenchmark, type BenchResult } from './benchmark';

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

export function Benchmark() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<BenchResult | null>(null);
  const [error, setError] = useState('');

  const run = async (): Promise<void> => {
    setState('running');
    setError('');
    try {
      setResult(await runBenchmark());
      setState('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('error');
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
          {state === 'running' ? 'Running...' : 'Run benchmark'}
        </Button>
        {state === 'error' && <p role="alert">{error}</p>}
        {result && state === 'done' && (
          <dl>
            <dt>Elapsed</dt>
            <dd data-field="ms">{Math.round(result.ms)} ms</dd>
            <dt>Rounds per second</dt>
            <dd data-field="rps">{Math.round(result.roundsPerSec).toLocaleString('en-US')}</dd>
            <dt>Workers</dt>
            <dd data-field="workers">{result.workers}</dd>
            <dt>Projected 10,000 x 500</dt>
            <dd data-field="projected">{formatSeconds(result.projectedMs)}</dd>
          </dl>
        )}
      </section>
    </>
  );
}
