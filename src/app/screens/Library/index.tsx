// Library (architecture.md §6.3): Strategies | Definitions | Runs, with search and tag filters,
// open, duplicate and delete (with confirm). Built-in presets are listed with the strategies.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { DefinitionRecord, StrategyRecord } from '@core/contracts/experiment';
import type { RunMeta } from '@core/contracts/run';

import { definitionId, experimentName } from '@core';
import { Button, Card, Chip, EmptyState, Field, Sheet, Tabs, TextInput, showToast } from '@core/ui';
import { STRATEGY_PRESETS } from '@game/roulette';
import { href, navigate } from '../../router';
import { useStore } from '../../state/store';
import type { ScreenProps } from '../types';
import {
  deleteDefinition,
  deleteStrategy,
  isDryRunId,
  libraryRepo,
  libraryVersion,
  saveDefinition,
  saveStrategy,
} from '../Define/data';
import { RenameExperiment } from '../RenameExperiment';
import { Layouts, editHref } from './Layouts';
import { LayoutPage } from './LayoutPage';
import './library.css';

type TabId = 'strategies' | 'definitions' | 'layouts' | 'runs';
const TABS = [
  { id: 'strategies', label: 'Strategies' },
  { id: 'definitions', label: 'Definitions' },
  { id: 'layouts', label: 'Layouts' },
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

/**
 * The editor page opens at `?tab=layouts&edit=<id|new>`. The shell remounts a screen on every
 * hashchange, so Back must never change the hash while edits are open. On open a sentinel entry
 * with the SAME address is pushed; Android Back then pops to an identical URL (no hashchange, no
 * remount) and `popstate` re-pushes the sentinel and presses the editor's own Back, so its
 * unsaved-changes guard decides. Leaving (Back pressed, Discard, or a clean close) consumes the
 * sentinel and the edit entry together.
 */
interface EditState {
  layoutEdit: true;
  fromList: boolean;
}
let openFromList = false;
const LIST = '#/library?tab=layouts';

function useEditPage(tab: TabId, query: URLSearchParams) {
  const param = tab === 'layouts' ? query.get('edit') : null;
  const [closed, setClosed] = useState(false);
  const exiting = useRef(false);
  const fromList = useRef(false);
  useEffect(() => {
    if (!param) return;
    setClosed(false);
    exiting.current = false;
    const st = history.state as Partial<EditState> | null;
    if (st?.layoutEdit) fromList.current = st.fromList === true;
    else {
      fromList.current = openFromList;
      history.pushState({ layoutEdit: true, fromList: openFromList }, '', location.href);
    }
    openFromList = false;
    const on = () => {
      if (exiting.current || (history.state as Partial<EditState> | null)?.layoutEdit) return;
      history.pushState({ layoutEdit: true, fromList: fromList.current }, '', location.href);
      setTimeout(
        () =>
          document
            .querySelector<HTMLButtonElement>('.layout-editor .le-head button[aria-label="Back"]')
            ?.click(),
        0,
      );
    };
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, [param]);
  const open = (id: string) => {
    openFromList = true;
    navigate(editHref(id));
  };
  const close = () => {
    exiting.current = true;
    setClosed(true);
    if (!(history.state as Partial<EditState> | null)?.layoutEdit) {
      location.replace(LIST);
    } else if (fromList.current) {
      history.go(-2);
    } else {
      window.addEventListener('popstate', () => location.replace(LIST), { once: true });
      history.go(-1);
    }
  };
  return { editing: closed ? null : param, open, close };
}

export function Library({ query }: ScreenProps) {
  const tabParam = query.get('tab');
  const tab: TabId =
    tabParam === 'definitions' || tabParam === 'layouts' || tabParam === 'runs'
      ? tabParam
      : 'strategies';
  const [text, setText] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<StrategyRecord[] | null>(null);
  const [definitions, setDefinitions] = useState<DefinitionRecord[] | null>(null);
  const [runs, setRuns] = useState<RunMeta[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  // A rename bumps `updatedAt`, so the row can move when the list reloads; moving it drops focus.
  // Put focus back on that row's Rename button once the reloaded list renders.
  const refocus = useRef<{ id: string; name: string } | null>(null);
  const version = useStore(libraryVersion, (v) => v);
  const edit = useEditPage(tab, query);

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
        const dryDefs = new Set(
          d.filter((x) => x.definition.tags?.includes('dry-run') === true).map((x) => x.id),
        );
        setDefinitions(d.filter((x) => !dryDefs.has(x.id)));
        setRuns(r.filter((x) => !isDryRunId(x.runId) && !dryDefs.has(x.definitionId)));
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

  useEffect(() => {
    const want = refocus.current;
    const rec = want && definitions?.find((d) => d.id === want.id);
    // Wait for the reload that carries the new name; the list before it is stale.
    if (renaming || !want || !rec || experimentName(rec) !== want.name) return;
    const btn = document.getElementById(`rename-${want.id}`);
    if (!btn) return;
    refocus.current = null;
    if (document.activeElement === document.body || document.activeElement === null) btn.focus();
  }, [definitions, renaming]);

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
      matches(experimentName(d), d.id, ...(d.definition.tags ?? [])) &&
      (tag === null || (d.definition.tags ?? []).includes(tag)),
  );
  const defName = new Map((definitions ?? []).map((d) => [d.id, experimentName(d)]));
  const shownRuns = (runs ?? []).filter((r) =>
    matches(defName.get(r.definitionId), r.runId, r.status),
  );

  const duplicateStrategy = async (s: StrategyRecord) => {
    const taken = new Set((strategies ?? []).map((x) => x.id));
    const base = s.id.replace(/-copy(-\d+)?$/, '').slice(0, 33);
    let n = 1;
    let id = `${base}-copy`;
    while (taken.has(id)) id = `${base}-copy-${++n}`;
    const name = `Copy${n > 1 ? ` ${n}` : ''} of ${s.strategy.name}`.slice(0, 80);
    await saveStrategy({ ...s.strategy, id, name });
    showToast(`Strategy duplicated as ${name}`);
  };
  const duplicateDefinition = async (d: DefinitionRecord) => {
    const taken = new Set((definitions ?? []).map((x) => x.id));
    let n = 1;
    const shown = experimentName(d);
    let copy = { ...d.definition, name: `Copy of ${shown}`.slice(0, 120) };
    while (taken.has(await definitionId(copy))) {
      n++;
      copy = { ...d.definition, name: `Copy ${n} of ${shown}`.slice(0, 120) };
    }
    await saveDefinition(copy, { derivedFrom: d.id });
    showToast(`Definition duplicated as ${copy.name}`);
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

  if (edit.editing !== null) {
    return (
      <>
        <h1 class="visually-hidden">Edit layout</h1>
        <LayoutPage id={edit.editing} onClose={edit.close} />
      </>
    );
  }

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
        {allTags.length > 0 && (tab === 'strategies' || tab === 'definitions') ? (
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
        ) : tab === 'layouts' ? (
          <Layouts matches={matches} onOpen={edit.open} />
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
                      <span class="row-title">{experimentName(d)}</span>
                      <span class="row-sub">
                        {d.definition.strategy.name} ·{' '}
                        {d.definition.run.sessions.toLocaleString('en-US')} sessions ·{' '}
                        {d.runIds.length} {d.runIds.length === 1 ? 'run' : 'runs'} ·{' '}
                        {when(d.updatedAt)}
                      </span>
                    </a>
                    <div class="lib-actions">
                      <Button
                        onClick={() => setRenaming({ id: d.id, name: experimentName(d) })}
                        aria-label={`Rename ${experimentName(d)}`}
                        id={`rename-${d.id}`}
                      >
                        Rename
                      </Button>
                      <Button
                        onClick={() => void duplicateDefinition(d)}
                        aria-label={`Duplicate ${experimentName(d)}`}
                      >
                        Duplicate
                      </Button>
                      <Button
                        variant="danger"
                        aria-label={`Delete ${experimentName(d)}`}
                        onClick={() =>
                          setPending({ kind: 'definition', id: d.id, name: experimentName(d) })
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

      {renaming ? (
        <RenameExperiment
          id={renaming.id}
          name={renaming.name}
          onClose={() => setRenaming(null)}
          onRenamed={(name) => (refocus.current = { id: renaming.id, name })}
        />
      ) : null}
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
