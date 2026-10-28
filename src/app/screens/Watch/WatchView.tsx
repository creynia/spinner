import { useEffect, useState } from 'preact/hooks';
import type { RunData, SummaryRow } from '@core/contracts/run';
import type { SessionTrace } from '@core/contracts/strategy-trace';
import { formatMoney, representativeSessions, summaryRow } from '@core';
import { Button, Card, EmptyState, TraceReplay, isSpeedId } from '@core/ui';
import { href } from '../../router';
import type { ScreenProps } from '../types';
import { defaultDeps, type WatchDeps } from './deps';

type Source = 'sample' | 'resim' | 'truncated';
type State =
  | { s: 'loading' }
  | { s: 'norun' }
  | { s: 'badindex'; sessions: number }
  | { s: 'error'; message: string }
  | { s: 'nosim'; reason: string }
  | { s: 'resim' }
  | { s: 'ready'; trace: SessionTrace; row: SummaryRow | null; source: Source; mismatch: boolean };

const SAME_FIELDS = [
  'final',
  'net',
  'roundsPlayed',
  'roundsWagered',
  'wagered',
  'endedBy',
  'rejected',
  'deferred',
  'adjusted',
] as const;

function sameRow(a: SummaryRow, b: SummaryRow): boolean {
  return SAME_FIELDS.every((k) => a[k] === b[k]);
}

export function parseIndex(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

export function WatchView(props: ScreenProps & { deps?: WatchDeps }) {
  const deps = props.deps ?? defaultDeps;
  const runId = props.params['runId'] ?? '';
  const index = parseIndex(props.params['index']);
  const [data, setData] = useState<RunData | null | undefined>(undefined);
  const [state, setState] = useState<State>({ s: 'loading' });
  const [goto, setGoto] = useState('');

  useEffect(() => {
    let live = true;
    setData(undefined);
    setState({ s: 'loading' });
    deps
      .loadRun(runId)
      .then((d) => live && setData(d))
      .catch(
        (e: unknown) =>
          live && setState({ s: 'error', message: String(e instanceof Error ? e.message : e) }),
      );
    return () => {
      live = false;
    };
  }, [runId]);

  useEffect(() => {
    if (data === undefined) return;
    if (data === null) return setState({ s: 'norun' });
    if (index === null || index >= data.sessions)
      return setState({ s: 'badindex', sessions: data.sessions });
    let live = true;
    const stored = data.samples.find((x) => x.index === index);
    const canSim =
      data.meta.gameVersion === deps.gameVersion && data.meta.coreVersion === deps.coreVersion;
    if (stored && !stored.truncated) {
      setState({
        s: 'ready',
        trace: stored.trace,
        row: stored.row,
        source: 'sample',
        mismatch: false,
      });
      return;
    }
    if (!canSim) {
      if (stored)
        setState({
          s: 'ready',
          trace: stored.trace,
          row: stored.row,
          source: 'truncated',
          mismatch: false,
        });
      else
        setState({
          s: 'nosim',
          reason: `This run was made with game ${data.meta.gameVersion} and core ${data.meta.coreVersion}; this app has ${deps.gameVersion} and ${deps.coreVersion}, so only the stored sample sessions can be watched.`,
        });
      return;
    }
    setState({ s: 'resim' });
    deps
      .simulate(data.definition, index, data.meta.schedule)
      .then((r) => {
        if (!live) return;
        const old = summaryRow(data.summary, index, index, data.meta.labels);
        setState({
          s: 'ready',
          trace: r.trace,
          row: r.row,
          source: 'resim',
          mismatch: !sameRow(old, r.row),
        });
      })
      .catch(
        (e: unknown) =>
          live && setState({ s: 'error', message: String(e instanceof Error ? e.message : e) }),
      );
    return () => {
      live = false;
    };
  }, [data, index]);

  const back = href(`/analyze/${runId}`);
  const header = (
    <>
      <h1>Watch session{index !== null ? ` #${index}` : ''}</h1>
      <p class="muted">
        <a href={back}>Back to results</a>
        {data ? <> · {data.definition.name}</> : null}
      </p>
    </>
  );

  if (state.s === 'loading')
    return (
      <>
        {header}
        <Card>
          <p role="status" class="muted">
            Loading run
          </p>
        </Card>
      </>
    );
  if (state.s === 'norun')
    return (
      <>
        {header}
        <Card>
          <EmptyState
            title="Run not found"
            action={<Button href={href('/library?tab=runs')}>Open library</Button>}
          >
            There is no run with the id {runId} on this device.
          </EmptyState>
        </Card>
      </>
    );
  if (state.s === 'badindex')
    return (
      <>
        {header}
        <Card>
          <EmptyState title="No such session">
            This run has sessions 0 to {state.sessions - 1}. Pick one from the results.
          </EmptyState>
        </Card>
      </>
    );
  if (state.s === 'error')
    return (
      <>
        {header}
        <Card>
          <p class="error" role="alert">
            Could not load this session: {state.message}
          </p>
        </Card>
      </>
    );
  if (state.s === 'nosim')
    return (
      <>
        {header}
        <Card title="Cannot replay this session">
          <p>{state.reason}</p>
        </Card>
      </>
    );
  if (state.s === 'resim')
    return (
      <>
        {header}
        <p role="status" class="muted">
          Re-simulating session #{index} from its seed
        </p>
      </>
    );

  const d = data!;
  const rep = representativeSessions(d);
  const rules = deps.resolveRules(d.definition);
  const initial = Number(props.query.get('round'));
  const speedQ = props.query.get('speed');
  const row = state.row;
  const links = [
    ['Best', rep.best],
    ['Median', rep.median],
    ['Worst', rep.worst],
  ] as const;
  const Replay = TraceReplay as unknown as (p: Record<string, unknown>) => preact.JSX.Element;
  return (
    <>
      {header}
      {state.mismatch ? (
        <p class="banner" role="status" data-mismatch>
          This run was made with a different engine version: the re-simulated session does not match
          the stored results.
        </p>
      ) : null}
      {state.source === 'truncated' ? (
        <p class="banner" role="status">
          The stored trace is cut short and cannot be re-simulated here.
        </p>
      ) : null}
      <div class="actions watch-nav">
        {links.map(([label, i]) =>
          i >= 0 ? (
            <Button key={label} href={href(`/watch/${runId}/${i}`)}>
              {label} (#{i})
            </Button>
          ) : null,
        )}
        <form
          class="watch-goto"
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseIndex(goto.trim());
            if (n !== null && n < d.sessions) location.hash = `#/watch/${runId}/${n}`;
          }}
        >
          <label>
            <span class="muted">Session number (0 to {d.sessions - 1})</span>
            <input
              class="input"
              inputMode="numeric"
              value={goto}
              onInput={(e) => setGoto(e.currentTarget.value)}
            />
          </label>
          <Button type="submit">Go</Button>
        </form>
      </div>
      {row ? (
        <p class="watch-sum" data-summary>
          Net {formatMoney(row.net)} · final {formatMoney(row.final)} · {row.roundsPlayed} rounds ·
          ended by {row.endedBy}
          {row.rejected > 0 ? ` · ${row.rejected} rejected` : ''}
          {state.source === 'resim' ? ' · re-simulated' : ''}
        </p>
      ) : null}
      <Replay
        key={`${runId}/${index}`}
        trace={state.trace}
        bankroll={d.definition.session.bankroll}
        ui={deps.ui}
        rules={rules}
        initialRound={Number.isFinite(initial) && initial >= 1 ? initial - 1 : 0}
        initialSpeed={isSpeedId(speedQ) ? speedQ : undefined}
      />
    </>
  );
}
