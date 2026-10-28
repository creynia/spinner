// Sweep (architecture.md §6.3): create a sweep from a definition (path + values, same seed), run the
// variants one after another, and chart metric against parameter. `#/sweep/new` is the form;
// `#/sweep/:groupId` shows a stored group.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { DefinitionRecord, ExperimentGroup } from '@core/contracts/experiment';
import type { RunData, RunMeta } from '@core/contracts/run';
import { Button, Card, Field, Select, SweepView, TextInput } from '@core/ui';
import { navigate } from '../../router';
import { getCoreRepo } from '../../services/runs';
import { settingsStore } from '../../services/settings';
import { useStore } from '../../state/store';
import { NotFoundCard, loadRunData, tableMaxFor } from '../Analyze/data';
import type { ScreenProps } from '../types';
import {
  MAX_VALUES,
  MIN_VALUES,
  buildVariants,
  createSweep,
  leafPaths,
  parseValues,
  runSweep,
  showValue,
  sweepQueue,
} from './sweep';

function NewSweep({ query }: { query: URLSearchParams }) {
  const [defs, setDefs] = useState<DefinitionRecord[] | null>(null);
  const [baseId, setBaseId] = useState(query.get('definition') ?? '');
  const [path, setPath] = useState('');
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const repo = await getCoreRepo();
      const list = await repo.listDefinitions();
      setDefs(list);
      const runId = query.get('run');
      if (!baseId && runId) {
        const m = await repo.getRun(runId);
        if (m) setBaseId(m.definitionId);
      }
    })().catch(() => setDefs([]));
  }, []);

  useEffect(() => {
    if (defs && !baseId && defs[0]) setBaseId(defs[0].id);
  }, [defs]);

  const base = defs?.find((d) => d.id === baseId) ?? null;
  const leaves = useMemo(() => (base ? leafPaths(base.definition) : []), [base]);
  const leaf = leaves.find((l) => l.path === path);

  if (defs === null) {
    return (
      <section class="card">
        <p class="muted" role="status">
          Loading the library...
        </p>
      </section>
    );
  }
  if (defs.length === 0) {
    return (
      <Card title="No definitions yet">
        <p class="muted">A sweep varies one setting of an experiment. Define one first.</p>
        <Button variant="primary" href="#/define">
          New experiment
        </Button>
      </Card>
    );
  }

  const create = async () => {
    if (!base) return;
    setBusy(true);
    setErrors([]);
    try {
      if (!leaf) {
        setErrors(['Pick a setting to vary from the list.']);
        return;
      }
      const parsed = parseValues(text, typeof leaf.value === 'number' ? 'number' : 'string');
      if (!parsed.ok) {
        setErrors([parsed.error]);
        return;
      }
      const built = buildVariants(base.definition, path, parsed.values);
      if (!built.ok) {
        setErrors(built.errors.map((e) => `${showValue(e.value)}: ${e.message}`));
        return;
      }
      const group = await createSweep(base, path, parsed.values, built.variants);
      void runSweep(group.id);
      navigate(`/sweep/${encodeURIComponent(group.id)}`);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="New sweep">
      <p class="muted">
        Runs the same experiment several times, changing one setting. Every variant keeps the seed,
        so differences are not noise.
      </p>
      <Field label="Experiment" id="sw-base">
        <Select
          id="sw-base"
          value={baseId}
          onChange={(v) => {
            setBaseId(v);
            setPath('');
          }}
          options={defs.map((d) => ({ value: d.id, label: d.definition.name }))}
        />
      </Field>
      <Field
        label="Setting to vary"
        id="sw-path"
        hint="Numbers and text settings of the definition."
      >
        <Select
          id="sw-path"
          value={path}
          onChange={setPath}
          options={[
            { value: '', label: 'Choose a setting' },
            ...leaves.map((l) => ({ value: l.path, label: `${l.path} (now ${l.value})` })),
          ]}
        />
      </Field>
      <Field
        label="Values"
        id="sw-values"
        hint={`${MIN_VALUES} to ${MAX_VALUES} values separated by commas${
          leaf && typeof leaf.value === 'number'
            ? ', increasing. Money settings are in cents.'
            : '.'
        }`}
        error={errors.length ? errors.join(' ') : null}
      >
        <TextInput
          id="sw-values"
          value={text}
          onInput={setText}
          placeholder="e.g. 1000, 2500, 5000"
        />
      </Field>
      <div class="actions">
        <Button variant="primary" disabled={busy || !base} onClick={() => void create()}>
          Create and run
        </Button>
      </div>
    </Card>
  );
}

function ShowSweep({ groupId }: { groupId: string }) {
  const framing = useStore(settingsStore, (s) => s.framing);
  const queue = useStore(sweepQueue, (q) => q[groupId]);
  const [group, setGroup] = useState<ExperimentGroup | null | undefined>(undefined);
  const [metas, setMetas] = useState<Record<string, RunMeta>>({});
  const [datas, setDatas] = useState<RunData[] | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let on = true;
    void (async () => {
      const repo = await getCoreRepo();
      const g = (await repo.listGroups()).find((x) => x.id === groupId) ?? null;
      if (!on) return;
      setGroup(g);
      if (!g) return;
      const m: Record<string, RunMeta> = {};
      for (const id of g.runIds) {
        const meta = await repo.getRun(id);
        if (meta) m[id] = meta;
      }
      if (!on) return;
      setMetas(m);
      const all = g.variantDefinitionIds?.length ?? 0;
      if (g.runIds.length === all && all > 0 && g.runIds.every((id) => m[id]?.status === 'done')) {
        const loaded = await Promise.all(g.runIds.map((id) => loadRunData(id)));
        if (on && loaded.every((d): d is RunData => d !== null)) setDatas(loaded);
      } else setDatas(null);
    })().catch(() => on && setGroup(null));
    return () => {
      on = false;
    };
  }, [groupId, tick, queue?.current, queue?.running]);

  // Follow a running sweep.
  useEffect(() => {
    if (!queue?.running) return;
    const t = setInterval(() => setTick((x) => x + 1), 1500);
    return () => clearInterval(t);
  }, [queue?.running]);

  if (group === undefined) {
    return (
      <section class="card">
        <p class="muted" role="status">
          Loading the sweep...
        </p>
      </section>
    );
  }
  if (!group || !group.sweep) return <NotFoundCard what="Sweep" />;
  const values = group.sweep.values;
  const total = values.length;
  const doneCount = group.runIds.filter((id) => metas[id]?.status === 'done').length;
  const running = queue?.running === true;
  const first = datas?.[0];
  return (
    <>
      <Card title="Progress">
        <p data-sweep-progress>
          <strong>{doneCount}</strong> of {total} variants finished
          {running && queue && queue.current >= 0 ? `; running variant ${queue.current + 1}` : ''}.
        </p>
        {queue?.error ? (
          <p class="warn-card" role="alert">
            {queue.error}
          </p>
        ) : null}
        <ul class="rows" aria-label="Variants">
          {values.map((v, i) => {
            const id = group.runIds[i];
            const m = id ? metas[id] : undefined;
            const pct = m ? Math.floor((m.completedSessions / (m.sessions || 1)) * 100) : 0;
            return (
              <li key={showValue(v)}>
                {id ? (
                  <a class="row-link" href={`#/run/${encodeURIComponent(id)}`}>
                    <span class="row-title">
                      {group.sweep!.path.split('/').pop()} = {showValue(v)}
                    </span>
                    <span class="row-sub">
                      {m ? (m.status === 'done' ? 'Done' : `${m.status}, ${pct}%`) : 'Waiting'}
                    </span>
                  </a>
                ) : (
                  <span class="row-link">
                    <span class="row-title">
                      {group.sweep!.path.split('/').pop()} = {showValue(v)}
                    </span>
                    <span class="row-sub">
                      {running && queue?.current === i ? 'Starting' : 'Waiting'}
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {doneCount < total && !running ? (
          <div class="actions">
            <Button variant="primary" onClick={() => void runSweep(groupId)}>
              {group.runIds.length ? 'Run the rest' : 'Run the variants'}
            </Button>
          </div>
        ) : null}
      </Card>
      {datas && first ? (
        <SweepView
          path={group.sweep.path}
          values={values}
          runs={datas}
          tableMax={tableMaxFor(first.definition)}
          framing={framing}
        />
      ) : null}
    </>
  );
}

export function Sweep({ params, query }: ScreenProps) {
  const groupId = params.groupId ?? '';
  return (
    <div class="results-screen">
      <h1>Sweep</h1>
      {groupId === 'new' ? <NewSweep query={query} /> : <ShowSweep groupId={groupId} />}
    </div>
  );
}
