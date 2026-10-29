// Home (architecture.md §6.3): New experiment, resumable runs, recent runs with one-line verdicts,
// recent definitions, presets, Import. No disclaimer here (decisions #11).
import { experimentName } from '@core';
import { useEffect } from 'preact/hooks';
import { Button, Card, Chip, EmptyState } from '@core/ui';
import { STRATEGY_PRESETS } from '@game/roulette';
import { href } from '../../router';
import { isResumable, recentRuns, type RunListItem } from '../../services/runs';
import { settingsStore } from '../../services/settings';
import { formatVerdict } from '../../services/verdict';
import { libraryLoaded, recentDefinitions, refreshLibrary } from '../../state/library';
import { useStore } from '../../state/store';

function runLine(r: RunListItem, framing: 'session' | 'hour' | 'per100'): string {
  if (r.verdict) {
    return formatVerdict(r.verdict, framing, r.verdict.roundsPerSession, r.verdict.roundsPerHour);
  }
  const pct = r.sessions ? Math.floor((r.completedSessions / r.sessions) * 100) : 0;
  if (r.status === 'done') return `${r.sessions.toLocaleString('en-US')} sessions`;
  if (isResumable(r)) return `Paused at ${pct}%`;
  if (r.status === 'error') return 'Stopped by an error';
  if (r.status === 'cancelled') return 'Cancelled';
  return `Running ${pct}%`;
}

function RunItem({ r, framing }: { r: RunListItem; framing: 'session' | 'hour' | 'per100' }) {
  const target = r.status === 'done' ? `/analyze/${r.runId}` : `/run/${r.runId}`;
  return (
    <li>
      <a class="row-link" href={href(target)}>
        <span class="row-title">{r.name}</span>
        <span class="row-sub">{runLine(r, framing)}</span>
      </a>
    </li>
  );
}

export function Home() {
  const runs = useStore(recentRuns, (v) => v);
  const defs = useStore(recentDefinitions, (v) => v);
  const loaded = useStore(libraryLoaded, (v) => v);
  const framing = useStore(settingsStore, (s) => s.framing);
  useEffect(() => {
    void refreshLibrary();
  }, []);
  const resumable = runs.filter(isResumable);

  return (
    <>
      <h1>spinner</h1>
      <p class="lead">
        Roulette strategy lab: pick a betting system, simulate thousands of sessions, see the risk.
      </p>
      <div class="actions">
        <Button variant="primary" href={href('/define')}>
          New experiment
        </Button>
        <Button href={href('/import')}>Import</Button>
      </div>

      <div class="home-grid">
        <div class="home-main">
          {resumable.map((r) => (
            <Card title={`Resume: ${r.name}`} class="resume-card">
              <p class="muted">{runLine(r, framing)}</p>
              <Button variant="primary" href={href(`/run/${r.runId}`)}>
                Resume
              </Button>
            </Card>
          ))}
          <Card title="Recent runs">
            {!loaded ? (
              <p class="muted">Loading</p>
            ) : runs.length === 0 ? (
              <EmptyState
                title="No runs yet"
                action={
                  <Button variant="primary" href={href('/define')}>
                    Start your first experiment
                  </Button>
                }
              >
                Results of your simulations appear here, each with a one-line verdict.
              </EmptyState>
            ) : (
              <ul class="rows" aria-label="Recent runs">
                {runs.map((r) => (
                  <RunItem r={r} framing={framing} />
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div class="home-side">
          <Card title="Recent definitions">
            {!loaded ? (
              <p class="muted">Loading</p>
            ) : defs.length === 0 ? (
              <EmptyState title="No saved definitions">
                Definitions you create are kept here so you can run them again.
              </EmptyState>
            ) : (
              <ul class="rows" aria-label="Recent definitions">
                {defs.map((d) => (
                  <li>
                    <a class="row-link" href={href(`/define/${d.id}`)}>
                      <span class="row-title">{experimentName(d)}</span>
                      <span class="row-sub">
                        {d.definition.session.maxRounds.toLocaleString('en-US')} rounds ·{' '}
                        {d.definition.run.sessions.toLocaleString('en-US')} sessions
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Presets">
            <ul class="chips" aria-label="Strategy presets">
              {STRATEGY_PRESETS.map((p) => (
                <li>
                  <Chip href={`#/define?preset=${encodeURIComponent(p.id)}`}>{p.name}</Chip>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
