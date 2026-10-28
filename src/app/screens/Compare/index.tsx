// Compare (architecture.md §6.3): 2 to 6 runs of the same game, side by side, with differences.
import { useEffect, useState } from 'preact/hooks';
import type { RunData, RunMeta } from '@core/contracts/run';
import { Button, Card, CompareView, Field, Select, type CompareRun } from '@core/ui';
import { navigate } from '../../router';
import { dryRunDefinitionIds, getCoreRepo } from '../../services/runs';
import { settingsStore } from '../../services/settings';
import { useStore } from '../../state/store';
import { NotFoundCard, loadRunData, tableMaxFor } from '../Analyze/data';
import type { ScreenProps } from '../types';

const MIN_RUNS = 2;
const MAX_RUNS = 6;

export function parseRuns(q: URLSearchParams): string[] {
  const ids = (q.get('runs') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(ids)].slice(0, MAX_RUNS);
}

const go = (ids: string[]) =>
  navigate(`/compare${ids.length ? `?runs=${ids.map(encodeURIComponent).join(',')}` : ''}`);

export function Compare({ query }: ScreenProps) {
  const ids = parseRuns(query);
  const key = ids.join(',');
  const framing = useStore(settingsStore, (s) => s.framing);
  const [datas, setDatas] = useState<(RunData | null)[] | null>(null);
  const [library, setLibrary] = useState<RunMeta[]>([]);
  const [add, setAdd] = useState('');

  useEffect(() => {
    let on = true;
    setDatas(null);
    void Promise.all(ids.map((id) => loadRunData(id).catch(() => null))).then(
      (d) => on && setDatas(d),
    );
    return () => {
      on = false;
    };
  }, [key]);
  useEffect(() => {
    void Promise.all([getCoreRepo().then((r) => r.listRuns()), dryRunDefinitionIds()])
      .then(([l, dry]) =>
        setLibrary(l.filter((m) => m.status === 'done' && !dry.has(m.definitionId))),
      )
      .catch(() => undefined);
  }, []);

  const loaded = (datas ?? []).filter((d): d is RunData => d !== null);
  const missing = datas ? ids.filter((_, i) => datas[i] === null) : [];
  const labels = loaded.map((d) => d.definition.name);
  const runs: CompareRun[] = loaded.map((d, i) => ({
    id: d.meta.runId,
    label:
      labels.filter((l) => l === labels[i]).length > 1
        ? `${labels[i]} (${d.meta.runId.slice(-8)})`
        : labels[i]!,
    data: d,
  }));
  const candidates = library.filter((m) => !ids.includes(m.runId));
  const sameGame = loaded.every((d) => d.meta.gameId === loaded[0]?.meta.gameId);

  return (
    <div class="results-screen">
      <h1>Compare</h1>
      <ul class="chip-row" aria-label="Runs being compared">
        {ids.map((id, i) => (
          <li key={id} class="run-chip">
            <span>{runs.find((r) => r.id === id)?.label ?? id.slice(-8)}</span>
            <button
              type="button"
              aria-label={`Remove ${runs.find((r) => r.id === id)?.label ?? id}`}
              onClick={() => go(ids.filter((x) => x !== id))}
            >
              <span aria-hidden="true">×</span>
              {i === 0 ? <span class="visually-hidden"> (baseline)</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {ids.length < MAX_RUNS ? (
        <Card title="Add a run" level={2}>
          {candidates.length ? (
            <>
              <Field label="Finished runs" id="cmp-add">
                <Select
                  id="cmp-add"
                  value={add}
                  onChange={setAdd}
                  options={[
                    { value: '', label: 'Choose a run' },
                    ...candidates.map((m) => ({
                      value: m.runId,
                      label: `${m.runId.slice(-8)} · ${m.createdAt.slice(0, 10)} · ${m.sessions.toLocaleString('en-US')} sessions`,
                    })),
                  ]}
                />
              </Field>
              <div class="actions">
                <Button disabled={!add} onClick={() => go([...ids, add])}>
                  Add to comparison
                </Button>
              </div>
            </>
          ) : (
            <p class="muted">No other finished runs in this browser.</p>
          )}
        </Card>
      ) : null}
      {missing.length ? (
        <NotFoundCard what="Run" message={`${missing.join(', ')} is not in this browser.`} />
      ) : null}
      {ids.length < MIN_RUNS ? (
        <p class="muted">
          Pick at least {MIN_RUNS} runs (up to {MAX_RUNS}). The first is the baseline.
        </p>
      ) : datas === null ? (
        <p class="muted" role="status">
          Loading the runs...
        </p>
      ) : runs.length >= MIN_RUNS && sameGame ? (
        <CompareView
          runs={runs}
          framing={framing}
          tableMax={tableMaxFor(runs[0]!.data.definition)}
        />
      ) : runs.length >= MIN_RUNS ? (
        <p class="warn-card" role="alert">
          These runs are of different games and cannot be compared.
        </p>
      ) : null}
    </div>
  );
}
