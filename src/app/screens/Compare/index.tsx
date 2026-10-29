// Compare (architecture.md §6.3): 2 to 6 runs of the same game, side by side, with differences.
import { experimentName } from '@core';
import { useEffect, useState } from 'preact/hooks';
import type { DefinitionRecord } from '@core/contracts/experiment';
import type { RunData } from '@core/contracts/run';
import {
  Button,
  Card,
  CompareView,
  Field,
  relativeTime,
  runTimestamp,
  Select,
  useNow,
  type CompareRun,
} from '@core/ui';
import { navigate } from '../../router';
import { getCoreRepo, listRunRows, type RunRow } from '../../services/runs';
import * as sync from '../../services/sync';
import { settingsStore } from '../../services/settings';
import { useStore } from '../../state/store';
import { pickerLabels } from '../pickerLabels';
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
  const [library, setLibrary] = useState<RunRow[]>([]);
  const [downloading, setDownloading] = useState(0);
  const [defs, setDefs] = useState<Map<string, DefinitionRecord>>(new Map());
  const now = useNow();
  const [add, setAdd] = useState('');

  useEffect(() => {
    let on = true;
    setDatas(null);
    // A run that is only in Drive downloads first, inline; then the runs compare (sync.md §8.4).
    void (async () => {
      const first = await Promise.all(ids.map((id) => loadRunData(id).catch(() => null)));
      const need: number[] = [];
      for (let i = 0; i < ids.length; i++) {
        if (first[i] !== null) continue;
        const stub = await sync.remoteRun(ids[i]!).catch(() => null);
        if (stub?.status === 'done' && stub.bundle) need.push(i);
      }
      if (need.length > 0) {
        if (on) setDownloading(need.length);
        const got = await Promise.all(
          need.map((i) => sync.downloadRun(ids[i]!).catch(() => 'missing' as const)),
        );
        need.forEach((i, k) => {
          if (got[k] !== 'ok') first[i] = null;
        });
        const again = await Promise.all(
          need.map((i, k) => (got[k] === 'ok' ? loadRunData(ids[i]!).catch(() => null) : null)),
        );
        need.forEach((i, k) => (first[i] = again[k] ?? null));
      }
      if (on) {
        setDownloading(0);
        setDatas(first);
      }
    })();
    return () => {
      on = false;
    };
  }, [key]);
  useEffect(() => {
    void Promise.all([listRunRows(), getCoreRepo().then((r) => r.listDefinitions())])
      .then(([l, d]) => {
        setDefs(new Map(d.map((x) => [x.id, x])));
        setLibrary(l.filter((m) => m.status === 'done'));
      })
      .catch(() => undefined);
  }, []);

  const loaded = (datas ?? []).filter((d): d is RunData => d !== null);
  const missing = datas ? ids.filter((_, i) => datas[i] === null) : [];
  const labels = loaded.map((d) => experimentName(d));
  const runs: CompareRun[] = loaded.map((d, i) => {
    const same = loaded.filter((_, k) => labels[k] === labels[i]);
    const sameSessions = same.filter((o) => o.meta.sessions === d.meta.sessions);
    return {
      id: d.meta.runId,
      label:
        same.length <= 1
          ? labels[i]!
          : sameSessions.length <= 1
            ? `${labels[i]} (${d.meta.sessions.toLocaleString('en-US')} sessions)`
            : `${labels[i]} (${d.meta.sessions.toLocaleString('en-US')} sessions, seed ${d.definition.run.seed})`,
      data: d,
    };
  });
  const candidates = library.filter((m) => !ids.includes(m.runId));
  const optionLabels = pickerLabels(
    candidates.map((m) => {
      const rec = defs.get(m.definitionId);
      return {
        name: `${rec ? experimentName(rec) : 'Untitled experiment'}${m.remote ? ' ☁' : ''}`,
        when: relativeTime(runTimestamp(m), now),
        sessions: m.sessions,
        seed: rec?.definition.run.seed,
      };
    }),
  );
  const sameGame = loaded.every((d) => d.meta.gameId === loaded[0]?.meta.gameId);

  return (
    <div class="results-screen">
      <h1>Compare</h1>
      <ul class="chip-row" aria-label="Runs being compared">
        {ids.map((id, i) => (
          <li key={id} class="run-chip">
            <span>{runs.find((r) => r.id === id)?.label ?? 'Run'}</span>
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
                    ...candidates.map((m, k) => ({ value: m.runId, label: optionLabels[k]! })),
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
          {downloading > 0
            ? `Downloading ${downloading} ${downloading === 1 ? 'run' : 'runs'}…`
            : 'Loading the runs...'}
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
