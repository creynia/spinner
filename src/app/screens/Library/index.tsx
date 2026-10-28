// Library (architecture.md §6.3): Strategies | Definitions | Runs, with search and tag filters,
// open, duplicate and delete (with confirm). Built-in presets are listed with the strategies.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { DefinitionRecord, StrategyRecord } from '@core/contracts/experiment';
import type { RunMeta } from '@core/contracts/run';

import { Button, Card, Chip, EmptyState, Field, Sheet, Tabs, TextInput, showToast } from '@core/ui';
import { STRATEGY_PRESETS } from '@game/roulette';
import { href, navigate } from '../../router';
import { useStore } from '../../state/store';
import type { ScreenProps } from '../types';
import {
  deleteDefinition,
  deleteStrategy,
  isDryRun,
  libraryRepo,
  libraryVersion,
  saveDefinition,
  saveStrategy,
} from '../Define/data';
import './library.css';

type TabId = 'strategies' | 'definitions' | 'runs';
const TABS = [
  { id: 'strategies', label: 'Strategies' },
  { id: 'definitions', label: 'Definitions' },
  { id: 'runs', label: 'Runs' },
] as const;

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { dateStyle: 'medium' });
}

interface Pending {
  kind: 'strategy' | 'definition' | 'run';
  id: string;
  name: string;
}

export function Library({ query }: ScreenProps) {
  const tabParam = query.get('tab');
  const tab: TabId = tabParam === 'definitions' || tabParam === 'runs' ? tabParam : 'strategies';
  const [text, setText] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<StrategyRecord[] | null>(null);
  const [definitions, setDefinitions] = useState<DefinitionRecord[] | null>(null);
  const [runs, setRuns] = useState<RunMeta[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const version = useStore(libraryVersion, (v) => v);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const repo = await libraryRepo();
        const [s, d, r] = await Promise.all([
          repo.listStrategies(),
          repo.listDefinitions(),
          repo.listRuns(),
        ]);
        if (!live) return;
        setStrategies(s);
        const dryIds = new Set(d.filter((x) => isDryRun(x.definition)).map((x) => x.id));
        setDefinitions(d.filter((x) => !dryIds.has(x.id)));
        setRuns(r.filter((x) => !dryIds.has(x.definitionId)));
      } catch {
        if (live) {
          setStrategies([]);
          setDefinitions([]);
          setRuns([]);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [version]);

  const q = text.trim().toLowerCase();
  const matches = (...parts: (string | undefined)[]) =>
    q === '' || parts.some((p) => p?.toLowerCase().includes(q));

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of strategies ?? []) for (const t of s.strategy.tags ?? []) set.add(t);
    for (const d of definitions ?? []) for (const t of d.definition.tags ?? []) set.add(t);
    return [...set].sort();
  }, [strategies, definitions]);

  const shownStrategies = (strategies ?? []).filter(
    (s) =>
      matches(s.strategy.name, s.id, ...(s.strategy.tags ?? [])) &&
      (tag === null || (s.strategy.tags ?? []).includes(tag)),
  );
  const shownPresets = STRATEGY_PRESETS.filter(
    (p) => tag === null && matches(p.name, p.id, 'built-in preset'),
  );
  const shownDefs = (definitions ?? []).filter(
    (d) =>
      matches(d.definition.name, d.id, ...(d.definition.tags ?? [])) &&
      (tag === null || (d.definition.tags ?? []).includes(tag)),
  );
  const defName = new Map((definitions ?? []).map((d) => [d.id, d.definition.name]));
  const shownRuns = (runs ?? []).filter((r) =>
    matches(defName.get(r.definitionId), r.runId, r.status),
  );

  const duplicateStrategy = async (s: StrategyRecord) => {
    const id = `${s.id}-copy`.slice(0, 40);
    const copy = { ...s.strategy, id, name: `Copy of ${s.strategy.name}`.slice(0, 80) };
    await saveStrategy(copy);
    showToast('Strategy duplicated');
  };
  const duplicateDefinition = async (d: DefinitionRecord) => {
    const copy = { ...d.definition, name: `Copy of ${d.definition.name}`.slice(0, 120) };
    await saveDefinition(copy, { derivedFrom: d.id });
    showToast('Definition duplicated');
  };
  const confirmDelete = async () => {
    if (!pending) return;
    try {
      if (pending.kind === 'strategy') await deleteStrategy(pending.id);
      else if (pending.kind === 'definition') await deleteDefinition(pending.id);
      else {
        await (await libraryRepo()).deleteRun(pending.id);
        libraryVersion.update((v) => v + 1);
      }
      showToast(`Deleted ${pending.name}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not delete.', { tone: 'error' });
    }
    setPending(null);
  };

  const setTab = (id: string) => navigate(`/library?tab=${id}`);
  const loading = strategies === null;

  return (
    <>
      <h1>Library</h1>
      <Card>
        <Field label="Search" id="lib-search">
          <TextInput
            id="lib-search"
            type="search"
            value={text}
            onInput={setText}
            placeholder="Name, id or tag"
          />
        </Field>
        {allTags.length > 0 && tab !== 'runs' ? (
          <ul class="chips" aria-label="Filter by tag">
            {allTags.map((t) => (
              <li key={t}>
                <Chip selected={tag === t} onClick={() => setTag(tag === t ? null : t)}>
                  {t}
                </Chip>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Library sections" idPrefix="lib">
        {loading ? (
          <p class="muted">Loading</p>
        ) : tab === 'strategies' ? (
          <>
            <Card title="Your strategies">
              {shownStrategies.length === 0 ? (
                <EmptyState
                  title={strategies.length === 0 ? 'No saved strategies yet' : 'No match'}
                  action={
                    <Button variant="primary" href={href('/define')}>
                      Build one in Define
                    </Button>
                  }
                >
                  {strategies.length === 0
                    ? 'Use "Save strategy" in Define to keep one here.'
                    : 'Try another search or tag.'}
                </EmptyState>
              ) : (
                <ul class="rows lib-rows" aria-label="Saved strategies">
                  {shownStrategies.map((s) => (
                    <li key={s.id} class="lib-row">
                      <a
                        class="row-link"
                        href={href(`/define?strategy=${encodeURIComponent(s.id)}`)}
                      >
                        <span class="row-title">{s.strategy.name}</span>
                        <span class="row-sub">
                          {s.id}
                          {s.strategy.tags?.length ? ` · ${s.strategy.tags.join(', ')}` : ''} ·{' '}
                          {when(s.updatedAt)}
                        </span>
                      </a>
                      <div class="lib-actions">
                        <Button
                          onClick={() => void duplicateStrategy(s)}
                          aria-label={`Duplicate ${s.strategy.name}`}
                        >
                          Duplicate
                        </Button>
                        <Button
                          variant="danger"
                          aria-label={`Delete ${s.strategy.name}`}
                          onClick={() =>
                            setPending({ kind: 'strategy', id: s.id, name: s.strategy.name })
                          }
                        >
                          Delete
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Built-in presets">
              <ul class="rows lib-rows" aria-label="Built-in presets">
                {shownPresets.map((p) => (
                  <li key={p.id} class="lib-row">
                    <a class="row-link" href={href(`/define?preset=${p.id}`)}>
                      <span class="row-title">{p.name}</span>
                      <span class="row-sub">{p.id} · built in</span>
                    </a>
                  </li>
                ))}
              </ul>
              {shownPresets.length === 0 ? <p class="muted">No preset matches.</p> : null}
            </Card>
          </>
        ) : tab === 'definitions' ? (
          <Card title="Definitions">
            {shownDefs.length === 0 ? (
              <EmptyState title={definitions!.length === 0 ? 'No definitions yet' : 'No match'}>
                {definitions!.length === 0
                  ? 'A definition is saved when you press Run or "Save definition".'
                  : 'Try another search or tag.'}
              </EmptyState>
            ) : (
              <ul class="rows lib-rows" aria-label="Saved definitions">
                {shownDefs.map((d) => (
                  <li key={d.id} class="lib-row">
                    <a class="row-link" href={href(`/define/${d.id}`)}>
                      <span class="row-title">{d.definition.name}</span>
                      <span class="row-sub">
                        {d.definition.strategy.name} ·{' '}
                        {d.definition.run.sessions.toLocaleString('en-US')} sessions ·{' '}
                        {d.runIds.length} {d.runIds.length === 1 ? 'run' : 'runs'} ·{' '}
                        {when(d.updatedAt)}
                      </span>
                    </a>
                    <div class="lib-actions">
                      <Button
                        onClick={() => void duplicateDefinition(d)}
                        aria-label={`Duplicate ${d.definition.name}`}
                      >
                        Duplicate
                      </Button>
                      <Button
                        variant="danger"
                        aria-label={`Delete ${d.definition.name}`}
                        onClick={() =>
                          setPending({ kind: 'definition', id: d.id, name: d.definition.name })
                        }
                      >
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : (
          <Card title="Runs">
            {shownRuns.length === 0 ? (
              <EmptyState title={runs!.length === 0 ? 'No runs yet' : 'No match'} />
            ) : (
              <ul class="rows lib-rows" aria-label="Runs">
                {shownRuns.map((r) => (
                  <li key={r.runId} class="lib-row">
                    <a
                      class="row-link"
                      href={href(r.status === 'done' ? `/analyze/${r.runId}` : `/run/${r.runId}`)}
                    >
                      <span class="row-title">
                        {defName.get(r.definitionId) ?? 'Untitled experiment'}
                      </span>
                      <span class="row-sub">
                        {r.status} · {r.completedSessions.toLocaleString('en-US')} of{' '}
                        {r.sessions.toLocaleString('en-US')} sessions · {when(r.createdAt)}
                      </span>
                    </a>
                    <div class="lib-actions">
                      <Button
                        variant="danger"
                        aria-label={`Delete run ${defName.get(r.definitionId) ?? r.runId}`}
                        onClick={() =>
                          setPending({
                            kind: 'run',
                            id: r.runId,
                            name: defName.get(r.definitionId) ?? r.runId,
                          })
                        }
                      >
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </Tabs>

      {pending ? (
        <Sheet open title={`Delete ${pending.kind}?`} onClose={() => setPending(null)}>
          <p>
            Delete <strong>{pending.name}</strong>? This cannot be undone.
          </p>
          <div class="actions">
            <Button variant="danger" onClick={() => void confirmDelete()}>
              Delete
            </Button>
            <Button onClick={() => setPending(null)}>Cancel</Button>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}
