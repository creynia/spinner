// Define (architecture.md §6.3): four cards (Game & rules, Strategy, Session, Run), the strategy
// builder, a validation panel, and the Quick check / Dry run / Run actions.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Json } from '@core/contracts/experiment';
import type { Diagnostic, StrategyDefinition } from '@core/contracts/strategy';
import {
  decodeShareLink,
  importDefinitionFile,
  SHARE_FALLBACK_NOTICE,
  validateDefinitionName,
  experimentName,
} from '@core';
import {
  Button,
  Card,
  defaultDenom,
  Field,
  MoneyInput,
  pathToElementId,
  StrategyEditor,
  type BuilderChipsEnv,
  type BuilderEnv,
  Segmented,
  Select,
  Sheet,
  RelativeTime,
  runTimestamp,
  Toggle,
  showToast,
  useId,
} from '@core/ui';
import { rouletteUi } from '@game/roulette/ui';
import { EXTRA_TARGETS } from '@game/roulette';
import { navigate } from '../../router';
import { trackEvent } from '../../analytics';
import { game } from '../../services/game';
import { listLayoutEntries, saveLayout } from '../../services/layouts';
import { quickCheck } from '../../services/quickCheck';
import { RunBadge, stubLine } from '../../components/RunBadge';
import { listRunRows, startRun } from '../../services/runs';
import { formatVerdict, type VerdictInput } from '../../services/verdict';
import type { ScreenProps } from '../types';
import { href } from '../../router';
import { PRESET_SOURCES, sourceById } from '../../sources';
import {
  analyze,
  cardOf,
  defaultDoc,
  definitionToDoc,
  docToDefinition,
  docWithStrategy,
  getOverride,
  isSameStrategy,
  PRESET_LIST,
  presetStrategy,
  setOverride,
  strategyUnit,
  strategyWithLayout,
  withUnit,
  type DefineDoc,
} from './doc';
import {
  installQuickCheck,
  libraryRepo,
  loadDefinitionOfRun,
  measuredRate,
  QUICK_SESSIONS,
  renameDefinition,
  saveDefinition,
  saveStrategy,
  shareOf,
  startDryRun,
  type ShareResult,
} from './data';
import './define.css';

// The pool-backed Quick check runner (see data.ts); tests replace it with setQuickCheckRunner.
installQuickCheck();

const RULE_PRESETS = [
  { value: 'european', label: 'European (one zero)' },
  { value: 'american', label: 'American (00)' },
  { value: 'triple-zero', label: 'Triple zero' },
] as const;

function useWide(): boolean {
  const q = '(min-width: 768px)';
  const [wide, setWide] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(q);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/** A card that collapses on phones (the heading is the toggle) and is always open when wide. */
function Section(p: {
  id: string;
  title: string;
  wide: boolean;
  open: boolean;
  onToggle: () => void;
  summary?: string;
  children: ComponentChildren;
}) {
  const body = `${p.id}-body`;
  const open = p.wide || p.open;
  return (
    <section class="card define-card" id={p.id} aria-labelledby={`${p.id}-h`}>
      <h2 id={`${p.id}-h`} class="define-h">
        {p.wide ? (
          p.title
        ) : (
          <button
            type="button"
            class="define-toggle"
            aria-expanded={open}
            aria-controls={body}
            onClick={p.onToggle}
          >
            <span>{p.title}</span>
            <span class="define-sum">{open ? '' : p.summary}</span>
            <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          </button>
        )}
      </h2>
      <div id={body} hidden={!open}>
        {open ? p.children : null}
      </div>
    </section>
  );
}

const fmt = (n: number) => n.toLocaleString('en-US');
const dollars = (cents: number) => `$${fmt(Math.round(cents / 100))}`;

function duration(seconds: number): string {
  if (seconds < 1) return 'under a second';
  if (seconds < 90) return `about ${Math.round(seconds)} s`;
  if (seconds < 5400) return `about ${Math.round(seconds / 60)} min`;
  return `about ${(seconds / 3600).toFixed(1)} h`;
}

function DiagList(p: {
  diags: readonly Diagnostic[];
  onJump: (d: Diagnostic) => void;
  rounds: number;
}) {
  if (p.diags.length === 0) return <p class="muted">Nothing to fix.</p>;
  return (
    <ul class="define-diags" aria-label="Validation messages">
      {p.diags.map((d, i) => (
        <li key={i} class={`define-diag define-diag--${d.severity}`}>
          <span class="b-sev">{d.severity === 'error' ? 'Error' : 'Warning'}</span>{' '}
          {d.code === 'W_NO_EXIT'
            ? `This strategy never stops early. Add a stop rule, or set Stop when ahead or Stop when behind in Session; otherwise every session plays all ${fmt(p.rounds)} spins.`
            : d.message}{' '}
          <code class="b-code">{d.code}</code> <code class="b-code">{d.path || '/'}</code>
          <button type="button" class="btn btn-ghost" onClick={() => p.onJump(d)}>
            Jump to
          </button>
        </li>
      ))}
    </ul>
  );
}

function PresetSource(p: { id: string }) {
  const sid = PRESET_SOURCES[p.id];
  const src = sid ? sourceById(sid) : undefined;
  if (!src) return null;
  return (
    <p class="muted" data-preset-source>
      Source:{' '}
      {src.url ? (
        <a href={src.url} target="_blank" rel="noopener noreferrer">
          {src.title}
        </a>
      ) : (
        <>{src.title}</>
      )}{' '}
      (<a href={href('/sources')}>all sources</a>)
    </p>
  );
}

function PresetSheet(p: { onPick: (id: string) => void; onClose: () => void }) {
  return (
    <Sheet open title="Start from a preset" onClose={p.onClose}>
      <ul class="rows" aria-label="Strategy presets">
        {PRESET_LIST.map((s) => (
          <li key={s.id}>
            <button type="button" class="row-link define-row-btn" onClick={() => p.onPick(s.id)}>
              <span class="row-title">{s.name}</span>
              <span class="row-sub">{s.id}</span>
            </button>
            <PresetSource id={s.id} />
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function LibrarySheet(p: { onPick: (s: StrategyDefinition) => void; onClose: () => void }) {
  const [items, setItems] = useState<StrategyDefinition[] | null>(null);
  useEffect(() => {
    void libraryRepo()
      .then((r) => r.listStrategies())
      .then((l) => setItems(l.map((x) => x.strategy)))
      .catch(() => setItems([]));
  }, []);
  return (
    <Sheet open title="Strategies in your library" onClose={p.onClose}>
      {items === null ? (
        <p class="muted">Loading</p>
      ) : items.length === 0 ? (
        <p class="muted">Nothing saved yet. Use "Save strategy" to keep one here.</p>
      ) : (
        <ul class="rows" aria-label="Library strategies">
          {items.map((s) => (
            <li key={s.id}>
              <button type="button" class="row-link define-row-btn" onClick={() => p.onPick(s)}>
                <span class="row-title">{s.name}</span>
                <span class="row-sub">{s.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function CompareSheet(p: { onPick: (runId: string) => void; onClose: () => void }) {
  const [items, setItems] = useState<
    | { runId: string; name: string; seed: number; at: string; remote: boolean; stub: string }[]
    | null
  >(null);
  useEffect(() => {
    void (async () => {
      const repo = await libraryRepo();
      const runs = (await listRunRows()).slice(0, 20);
      const out = [];
      for (const r of runs) {
        const d = await repo.getDefinition(r.definitionId);
        // a run that is only in Drive still has its definition: picking it needs no download
        out.push({
          runId: r.runId,
          name: d ? experimentName(d) : 'Untitled experiment',
          seed: d?.definition.run.seed ?? 0,
          at: runTimestamp(r),
          remote: r.remote !== undefined,
          stub: r.remote && r.status !== 'done' ? stubLine(r) : '',
        });
      }
      setItems(out);
    })().catch(() => setItems([]));
  }, []);
  return (
    <Sheet open title="Compare with a run" onClose={p.onClose}>
      <p class="muted">Copies the seed and the session settings so both runs see the same spins.</p>
      {items === null ? (
        <p class="muted">Loading</p>
      ) : items.length === 0 ? (
        <p class="muted">No runs yet.</p>
      ) : (
        <ul class="rows" aria-label="Runs to compare with">
          {items.map((r) => (
            <li key={r.runId}>
              <button
                type="button"
                class={`row-link define-row-btn${r.stub ? ' row-stub' : ''}`}
                disabled={r.stub !== ''}
                onClick={() => p.onPick(r.runId)}
              >
                <span class="row-title">
                  {r.name}
                  {r.remote && !r.stub ? <RunBadge /> : null}
                </span>
                <span class="row-sub">
                  {r.stub ? `${r.stub} · ` : ''}
                  <RelativeTime iso={r.at} /> · seed {r.seed}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function ShareSheet(p: { share: ShareResult; onClose: () => void; name: string }) {
  const id = useId('share');
  const s = p.share;
  const download = () => {
    if (!('file' in s)) return;
    const url = URL.createObjectURL(new Blob([s.file], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'definition'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Sheet open title="Share this definition" onClose={p.onClose}>
      {'link' in s ? (
        <>
          <p class="muted">
            Anyone with this link gets your definition as an unsaved draft. It never carries
            results.
          </p>
          <Field label="Link" id={id}>
            <input
              class="input"
              id={id}
              readOnly
              value={s.link}
              onFocus={(e) => e.currentTarget.select()}
            />
          </Field>
          <Button
            variant="primary"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(s.link)
                .then(() => showToast('Link copied'))
                .catch(() => showToast('Copy failed: select the link and copy it'));
            }}
          >
            Copy link
          </Button>
        </>
      ) : (
        <>
          <p>
            This definition is {SHARE_FALLBACK_NOTICE} ({fmt(s.chars)} characters). Download the
            file and send that instead; "Open a link or file" loads it again.
          </p>
          <Button variant="primary" onClick={download}>
            Download definition file
          </Button>
        </>
      )}
    </Sheet>
  );
}

function LimitField(p: { id: string; label: string; cents: number; onCents: (c: number) => void }) {
  return (
    <Field label={p.label} id={p.id}>
      <MoneyInput id={p.id} value={p.cents} min={100} onChange={p.onCents} />
    </Field>
  );
}

function OptionalMoney(p: {
  id: string;
  label: string;
  value: number | undefined;
  fallback: number;
  onChange: (v: number | undefined) => void;
}) {
  const on = p.value !== undefined;
  return (
    <div class="define-opt" id={`define-${p.id}-wrap`}>
      <Toggle
        label={p.label}
        checked={on}
        onChange={(v) => p.onChange(v ? p.fallback : undefined)}
      />
      {on ? (
        <Field label={`${p.label}: amount`} id={p.id}>
          <MoneyInput id={p.id} value={p.value!} min={1} onChange={(c) => p.onChange(c)} />
        </Field>
      ) : null}
    </div>
  );
}

function NumInput(p: {
  id: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  decimal?: boolean;
}) {
  const [text, setText] = useState(String(p.value));
  const [bad, setBad] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Follow outside changes (hours <-> spins), but never rewrite what the person is typing.
    if (document.activeElement !== ref.current && Number(text) !== p.value) {
      setText(String(p.value));
      setBad(false);
    }
  }, [p.value]);
  const errId = `${p.id}-err`;
  return (
    <>
      <input
        ref={ref}
        class="input"
        id={p.id}
        type="text"
        inputMode={p.decimal ? 'decimal' : 'numeric'}
        autoComplete="off"
        value={text}
        aria-invalid={bad ? 'true' : undefined}
        aria-describedby={bad ? errId : undefined}
        onInput={(e) => {
          const t = e.currentTarget.value;
          setText(t);
          const raw = t.trim() === '' ? NaN : Number(t);
          const n = p.decimal ? raw : Math.round(raw);
          const ok =
            Number.isFinite(raw) &&
            (p.decimal || Number.isInteger(raw)) &&
            n >= p.min &&
            n <= p.max;
          setBad(!ok);
          if (ok) p.onChange(n);
        }}
      />
      {bad ? (
        <p class="error" id={errId} role="alert">
          Enter {p.decimal ? 'a number' : 'a whole number'} from {fmt(p.min)} to {fmt(p.max)}.
        </p>
      ) : null}
    </>
  );
}

type Verdict =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'done'; text: string; ms: number }
  | { state: 'error'; text: string };

export function Define({ params, query }: ScreenProps) {
  const [doc, setDoc] = useState<DefineDoc>(() => defaultDoc());
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState({ game: false, strategy: true, session: false, run: false });
  const [sheet, setSheet] = useState<
    null | 'preset' | 'library' | 'compare' | 'share' | 'diags' | 'open'
  >(null);
  const [share, setShare] = useState<ShareResult | null>(null);
  const [verdict, setVerdict] = useState<Verdict>({ state: 'idle' });
  const [busy, setBusy] = useState<null | 'run' | 'dry'>(null);
  const [pasted, setPasted] = useState('');
  const wide = useWide();
  const analysis = useMemo(() => analyze(doc), [doc]);
  /** The preset id the strategy was branched from by its first edit, while it is still edited. */
  const branchedFrom = useRef<string | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const patch = (p: Partial<DefineDoc>) => {
    setDoc((d) => ({ ...d, ...p }));
    setVerdict((v) => (v.state === 'idle' ? v : { state: 'idle' }));
  };

  // ---- loading from the route
  const routeKey = `${params.definitionId ?? ''}|${query.toString()}`;
  useEffect(() => {
    let live = true;
    branchedFrom.current = null;
    void (async () => {
      try {
        const defId = params.definitionId;
        if (defId) {
          const rec = await (await libraryRepo()).getDefinition(defId);
          if (!live) return;
          if (!rec) {
            setLoadError(`No saved definition ${defId.slice(0, 12)}.`);
            return;
          }
          setDoc({
            ...definitionToDoc(
              { ...rec.definition, name: experimentName(rec) },
              { kind: 'library', id: rec.id },
            ),
            derivedFrom: rec.id,
          });
          setNotice('Editing a saved definition. Changes are saved as a new definition.');
          return;
        }
        if (query.get('d')) {
          const { definition, checksumOk } = await decodeShareLink(query);
          if (!live) return;
          setDoc(definitionToDoc(definition, { kind: 'link' }));
          setNotice(
            checksumOk === false
              ? 'Loaded from a link, but the link looks damaged or edited. Check every setting.'
              : 'Loaded from a link. This is an unsaved draft.',
          );
          return;
        }
        const from = query.get('from');
        if (from) {
          const def = await loadDefinitionOfRun(from);
          if (!live) return;
          if (!def) {
            setLoadError('That run was not found on this device.');
            return;
          }
          setDoc(definitionToDoc(def, { kind: 'custom' }));
          setNotice('Copied the definition of that run.');
          return;
        }
        const cmp = query.get('compare');
        if (cmp) {
          const def = await loadDefinitionOfRun(cmp);
          if (!live) return;
          if (!def) {
            setLoadError('That run was not found on this device.');
            return;
          }
          setDoc((cur) => ({
            ...cur,
            seed: def.run.seed,
            bankroll: def.session.bankroll,
            maxRounds: def.session.maxRounds,
            stopWin: def.session.stopWin,
            stopLoss: def.session.stopLoss,
            sessions: def.run.sessions,
            preset: typeof def.game.rules === 'string' ? def.game.rules : def.game.rules.preset,
            overrides:
              typeof def.game.rules === 'string' ? {} : structuredClone(def.game.rules.overrides),
          }));
          setNotice(
            'Comparing with another run: its seed, game rules and session settings are copied, so both runs see the same spins. Pick a different strategy.',
          );
          return;
        }
        const stratId = query.get('strategy');
        if (stratId) {
          const rec = await (await libraryRepo()).getStrategy(stratId);
          if (!live) return;
          if (!rec) {
            setLoadError('That strategy was not found in your library.');
            return;
          }
          setDoc((cur) => ({
            ...docWithStrategy(cur, rec.strategy, { kind: 'library', id: rec.id }),
            name: rec.strategy.name,
          }));
          return;
        }
        const layoutId = query.get('layout');
        if (layoutId) {
          const entry = (await listLayoutEntries()).find((e) => e.id === layoutId);
          if (!live) return;
          if (!entry) {
            setLoadError('That layout was not found in your library.');
            return;
          }
          const rulesNow = analyze(defaultDoc()).rules;
          const chip = rulesNow
            ? defaultDenom(
                game.plugin as never,
                rulesNow,
                entry.layout.spots,
                rouletteUi.chips!.denominations,
              ).denom
            : 500;
          const from = {
            id: entry.id,
            hash: entry.hash,
            name: entry.layout.name,
            ...(entry.builtin ? { builtin: true as const } : {}),
          };
          const cur = docRef.current;
          const r = strategyWithLayout(
            cur.strategy,
            defaultDoc().strategy,
            entry.layout,
            from,
            chip,
          );
          setDoc({
            ...cur,
            strategy: r.strategy,
            source: { kind: 'custom' },
            name: r.appended ? cur.name : entry.layout.name,
          });
          setNotice(
            r.appended
              ? `Added a stage that plays "${entry.layout.name}". Add a rule that moves to it.`
              : `Started from the layout "${entry.layout.name}".`,
          );
          return;
        }
        const preset = query.get('preset');
        if (preset) {
          const s = presetStrategy(preset);
          if (!s) {
            setLoadError(`There is no preset called "${preset}".`);
            return;
          }
          setDoc((cur) => docWithStrategy(cur, s, { kind: 'preset', id: preset }));
        }
      } catch (e) {
        if (live)
          setLoadError(
            e instanceof Error
              ? `Not a valid link: ${e.message}.`
              : 'Could not load that definition.',
          );
      }
    })();
    return () => {
      live = false;
    };
  }, [routeKey]);

  const rules = analysis.rules;
  const unit = strategyUnit(doc.strategy);
  const rph = rules?.pace.roundsPerHour ?? 40;
  const env: BuilderEnv | null = useMemo(
    () =>
      rules
        ? {
            facts: game.plugin.facts,
            catalog: game.plugin.bets.catalog(rules),
            rules,
            ui: rouletteUi as unknown as BuilderEnv['ui'],
            roundWord: 'spin',
            unit,
            extraTargets: EXTRA_TARGETS,
            chips: {
              ui: rouletteUi as unknown as BuilderChipsEnv['ui'],
              plugin: game.plugin,
              layouts: {
                list: async () =>
                  (await listLayoutEntries()).map((e) => ({
                    layout: e.layout,
                    hash: e.hash,
                    builtin: e.builtin,
                  })),
                save: (l) => saveLayout(l),
              },
              bankroll: doc.bankroll,
            },
            // Layouts saved from a stage are drawn on this definition's wheel.
            chipsVariant: doc.preset,
          }
        : null,
    [rules, unit, doc.bankroll, doc.preset],
  );

  const setStrategy = (next: unknown) => {
    let s = next;
    let source = doc.source;
    const o = next as { id?: unknown; name?: unknown } | null;
    const sname = o?.name;
    // The first edit of a preset makes it a different strategy: new id, once.
    if (doc.source.kind === 'preset' && o && typeof o === 'object' && o.id === doc.source.id) {
      branchedFrom.current = doc.source.id ?? null;
      s = { ...o, id: `${doc.source.id}-edit`.slice(0, 40) };
      source = { kind: 'custom' };
    } else if (branchedFrom.current && o && typeof o === 'object') {
      // An edit that is undone (a cancelled editor, say) makes it the preset again, with its id,
      // so `definitionId` is the preset's.
      const original = presetStrategy(branchedFrom.current);
      const same = original && isSameStrategy({ ...o, id: original.id }, original);
      if (original && same) {
        s = { ...o, id: original.id };
        source = { kind: 'preset', id: original.id };
        branchedFrom.current = null;
      }
    }
    patch({
      strategy: s,
      name: doc.source.kind === 'preset' && typeof sname === 'string' ? sname : doc.name,
      source,
    });
  };

  // ---- rules helpers
  const ov = (path: string[]) => getOverride(doc.overrides, path);
  const setOv = (path: string[], v: Json | undefined) =>
    patch({ overrides: setOverride(doc.overrides, path, v) });
  const setPreset = (preset: string) => {
    let overrides = doc.overrides;
    if (preset !== 'european') {
      overrides = setOverride(
        setOverride(overrides, ['laPartage'], undefined),
        ['enPrison'],
        undefined,
      );
    }
    patch({ preset, overrides });
  };
  const flag = (name: 'laPartage' | 'enPrison', other: 'laPartage' | 'enPrison', v: boolean) => {
    if (doc.preset !== 'european') return;
    patch({
      overrides: setOverride(
        setOverride(doc.overrides, [name], v ? true : undefined),
        [other],
        undefined,
      ),
    });
  };
  const [customPace, setCustomPace] = useState(false);
  const paceKind = customPace ? 'custom' : (rules?.pace.label ?? 'live');

  // ---- actions
  const hasErrors = analysis.errorCount > 0;
  const jump = (d: Diagnostic) => {
    setSheet(null);
    const card = d.code === 'W_NO_EXIT' ? 'session' : cardOf(d.path);
    const target =
      d.code === 'W_NO_EXIT'
        ? 'define-stop-win-wrap'
        : card === 'strategy'
          ? pathToElementId(d.path)
          : `define-${card}`;
    setOpen((o) => ({ ...o, [card]: true }));
    setTimeout(() => {
      const el = document.getElementById(target) ?? document.getElementById(`define-${card}`);
      el?.scrollIntoView({ block: 'center', behavior: 'auto' });
      const chip = el?.querySelector<HTMLElement>('.bchip--err');
      (chip ?? el?.querySelector<HTMLElement>('button, input, select'))?.focus({
        preventScroll: true,
      });
    }, 50);
  };

  const doQuick = async () => {
    if (!analysis.normalized) return;
    setVerdict({ state: 'running' });
    const t0 = performance.now();
    try {
      const v: VerdictInput = await quickCheck(analysis.normalized);
      setVerdict({
        state: 'done',
        ms: Math.round(performance.now() - t0),
        text: formatVerdict(v, 'session', analysis.normalized.session.maxRounds, rph),
      });
    } catch (e) {
      setVerdict({ state: 'error', text: e instanceof Error ? e.message : 'Quick check failed.' });
    }
  };

  const persist = async (): Promise<string | null> => {
    if (!analysis.normalized) return null;
    return saveDefinition(
      analysis.normalized,
      doc.derivedFrom ? { derivedFrom: doc.derivedFrom } : {},
    );
  };

  const doRun = async () => {
    if (!analysis.normalized) return;
    setBusy('run');
    try {
      await persist();
      // TODO(ui-results): switch to the keyed start in services/runs once it is on main.
      const runId = await startRun(analysis.normalized);
      trackEvent('run-start');
      navigate(`/run/${runId}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not start the run.', { tone: 'error' });
      setBusy(null);
    }
  };

  /** Renames the saved definition this draft was opened from; the rest of the draft is untouched. */
  const renameSaved = async () => {
    const id = doc.derivedFrom;
    if (!id) return;
    const check = validateDefinitionName(doc.name);
    if (!check.ok) {
      showToast(check.error, { tone: 'error' });
      return;
    }
    try {
      await renameDefinition(id, check.name);
      patch({ name: check.name });
      showToast(`Renamed the saved definition to ${check.name}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not rename.', { tone: 'error' });
    }
  };

  const doDry = async () => {
    if (!analysis.normalized) return;
    setBusy('dry');
    try {
      navigate(`/watch/${await startDryRun(analysis.normalized)}/0`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not start the dry run.', { tone: 'error' });
      setBusy(null);
    }
  };

  const doShare = async () => {
    try {
      setShare(await shareOf(docToDefinition(doc)));
      setSheet('share');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not make a link.', { tone: 'error' });
    }
  };

  const doSave = async () => {
    try {
      if (await persist()) showToast('Definition saved to your library');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save.', { tone: 'error' });
    }
  };

  const doSaveStrategy = async () => {
    try {
      await saveStrategy(doc.strategy as StrategyDefinition);
      showToast('Strategy saved to your library');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save.', { tone: 'error' });
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setDoc(definitionToDoc(importDefinitionFile(await file.text()), { kind: 'link' }));
      setNotice(`Loaded ${file.name}. This is an unsaved draft.`);
      setSheet(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Not a definition file.');
      setSheet(null);
    }
  };
  const openPasted = async () => {
    try {
      const h = pasted.includes('#') ? pasted.slice(pasted.indexOf('#')) : pasted;
      const q = new URLSearchParams(h.includes('?') ? h.slice(h.indexOf('?') + 1) : h);
      const { definition, checksumOk } = await decodeShareLink(q);
      setDoc(definitionToDoc(definition, { kind: 'link' }));
      setNotice(
        checksumOk === false
          ? 'Loaded from a link, but it looks damaged or edited.'
          : 'Loaded from a link. This is an unsaved draft.',
      );
      setSheet(null);
    } catch (e) {
      setLoadError(e instanceof Error ? `Not a valid link: ${e.message}.` : 'Not a valid link.');
      setSheet(null);
    }
  };

  const rate = measuredRate();
  const estimate = rate ? duration((doc.sessions * doc.maxRounds) / rate) : null;
  const errCount = analysis.errorCount;
  const badgeText =
    errCount > 0
      ? `${errCount} ${errCount === 1 ? 'error' : 'errors'}`
      : analysis.warningCount > 0
        ? `${analysis.warningCount} ${analysis.warningCount === 1 ? 'warning' : 'warnings'}`
        : 'Valid';
  const allDiags = [...analysis.strategy, ...analysis.definition];
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const hours = doc.maxRounds / rph;

  return (
    <div class="define-screen">
      <h1>Define</h1>
      {loadError ? (
        <div class="banner" role="alert">
          <span>{loadError}</span> <Button onClick={() => setLoadError(null)}>Dismiss</Button>
        </div>
      ) : null}
      {notice ? (
        <div class="banner define-notice" role="status">
          <span>{notice}</span> <Button onClick={() => setNotice(null)}>Dismiss</Button>
        </div>
      ) : null}
      <div class="define-name">
        <Field label="Experiment name" id="exp-name">
          <input
            class="input"
            id="exp-name"
            value={doc.name}
            onInput={(e) => patch({ name: e.currentTarget.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && doc.derivedFrom) {
                e.preventDefault();
                void renameSaved();
              }
            }}
          />
        </Field>
        {doc.derivedFrom ? (
          <Button onClick={() => void renameSaved()}>Rename saved definition</Button>
        ) : null}
      </div>

      <div class="define-grid">
        <Section
          id="define-game"
          title="Game & rules"
          wide={wide}
          open={open.game}
          onToggle={() => toggle('game')}
          summary={RULE_PRESETS.find((r) => r.value === doc.preset)?.label}
        >
          <Field label="Wheel" id="rules-preset">
            <Select
              id="rules-preset"
              value={doc.preset as 'european'}
              options={RULE_PRESETS}
              onChange={setPreset}
            />
          </Field>
          <Toggle
            label="La partage"
            checked={ov(['laPartage']) === true}
            onChange={(v) => flag('laPartage', 'enPrison', v)}
            hint={
              doc.preset === 'european'
                ? 'Even-money bets lose half on a zero.'
                : 'Needs the European wheel.'
            }
          />
          <Toggle
            label="En prison"
            checked={ov(['enPrison']) === true}
            onChange={(v) => flag('enPrison', 'laPartage', v)}
            hint={
              doc.preset === 'european'
                ? 'Even-money bets are held for the next spin on a zero. Not with La partage.'
                : 'Needs the European wheel.'
            }
          />
          <div class="field">
            <span class="field-label">Pace</span>
            <Segmented
              label="Pace"
              value={paceKind}
              options={[
                { value: 'live', label: 'Live (40/h)' },
                { value: 'electronic', label: 'Electronic (100/h)' },
                { value: 'custom', label: 'Custom' },
              ]}
              onChange={(k) => {
                setCustomPace(k === 'custom');
                if (k === 'live') setOv(['pace'], undefined);
                else if (k === 'electronic') setOv(['pace', 'roundsPerHour'], 100);
                else if (rph === 40 || rph === 100) setOv(['pace', 'roundsPerHour'], 60);
              }}
            />
          </div>
          {paceKind === 'custom' ? (
            <Field label="Spins per hour" id="pace-custom">
              <NumInput
                id="pace-custom"
                value={rph}
                min={1}
                max={1000}
                onChange={(n) => setOv(['pace', 'roundsPerHour'], n)}
              />
            </Field>
          ) : null}
          <details class="define-limits" open={wide ? true : undefined}>
            <summary>Table limits</summary>
            {rules ? (
              <>
                <LimitField
                  id="lim-omin"
                  label="Outside bets, minimum"
                  cents={rules.limits.outside.min}
                  onCents={(c) => setOv(['limits', 'outside', 'min'], c)}
                />
                <LimitField
                  id="lim-omax"
                  label="Outside bets, maximum"
                  cents={rules.limits.outside.max}
                  onCents={(c) => setOv(['limits', 'outside', 'max'], c)}
                />
                <LimitField
                  id="lim-imin"
                  label="Inside bets, minimum per chip"
                  cents={rules.limits.inside.minChip}
                  onCents={(c) => setOv(['limits', 'inside', 'minChip'], c)}
                />
                <LimitField
                  id="lim-itot"
                  label="Inside bets, minimum total per spin"
                  cents={rules.limits.inside.minTotal}
                  onCents={(c) => setOv(['limits', 'inside', 'minTotal'], c)}
                />
                {(
                  [
                    ['straight', 'Straight-up, maximum', ['straight']],
                    ['split', 'Split, maximum', ['split']],
                    ['street', 'Street and trio, maximum', ['street', 'trio']],
                    ['corner', 'Corner, maximum', ['corner']],
                    ['sixline', 'Six-line, maximum', ['sixline']],
                    ['basket', 'Basket (top line), maximum', ['basket']],
                  ] as const
                ).map(([key, label, keys]) => (
                  <LimitField
                    key={key}
                    id={`lim-${key}`}
                    label={label}
                    cents={rules.limits.inside.max[key] ?? 0}
                    onCents={(c) =>
                      patch({
                        overrides: keys.reduce(
                          (o, k) => setOverride(o, ['limits', 'inside', 'max', k], c),
                          doc.overrides,
                        ),
                      })
                    }
                  />
                ))}
              </>
            ) : null}
          </details>
          {analysis.rulesError ? (
            <p class="error" role="alert">
              {analysis.rulesError}
            </p>
          ) : null}
        </Section>

        <Section
          id="define-strategy"
          title="Strategy"
          wide={wide}
          open={open.strategy}
          onToggle={() => toggle('strategy')}
          summary={doc.name}
        >
          <div class="actions define-strategy-actions">
            <Button onClick={() => setSheet('preset')}>Presets</Button>
            <Button onClick={() => setSheet('library')}>From library</Button>
            <Button
              onClick={() => void doSaveStrategy()}
              disabled={typeof doc.strategy !== 'object' || doc.strategy === null}
            >
              Save strategy
            </Button>
          </div>
          {env ? (
            <StrategyEditor
              value={doc.strategy}
              onChange={setStrategy}
              env={env}
              diagnostics={analysis.strategy}
              structural={analysis.structural}
            />
          ) : (
            <p class="error">Fix the game rules first.</p>
          )}
        </Section>

        <Section
          id="define-session"
          title="Session"
          wide={wide}
          open={open.session}
          onToggle={() => toggle('session')}
          summary={`${dollars(doc.bankroll)} · ${fmt(doc.maxRounds)} spins`}
        >
          <Field label="Bankroll" id="bankroll">
            <MoneyInput
              id="bankroll"
              value={doc.bankroll}
              min={100}
              onChange={(c) => patch({ bankroll: c })}
            />
          </Field>
          <Field label="Unit" id="unit" hint="One unit of the strategy. The table minimum is $25.">
            <MoneyInput
              id="unit"
              value={unit}
              min={100}
              describedBy="unit-hint"
              onChange={(c) => patch({ strategy: withUnit(doc.strategy, c) })}
            />
          </Field>
          <div class="define-pair">
            <Field label="Spins per session" id="rounds">
              <NumInput
                id="rounds"
                value={doc.maxRounds}
                min={1}
                max={100000}
                onChange={(n) => patch({ maxRounds: n })}
              />
            </Field>
            <Field label={`Hours at ${rph} spins/h`} id="hours">
              <NumInput
                id="hours"
                decimal
                min={0.01}
                max={100000 / rph}
                value={Number(hours.toFixed(2))}
                onChange={(h) => {
                  const n = Math.round(h * rph);
                  if (n >= 1 && n <= 100000) patch({ maxRounds: n });
                }}
              />
            </Field>
          </div>
          <OptionalMoney
            id="stop-win"
            label="Stop when ahead"
            value={doc.stopWin}
            fallback={Math.max(100, Math.round(doc.bankroll / 5))}
            onChange={(v) => patch({ stopWin: v })}
          />
          <OptionalMoney
            id="stop-loss"
            label="Stop when behind"
            value={doc.stopLoss}
            fallback={Math.max(100, Math.round(doc.bankroll / 2))}
            onChange={(v) => patch({ stopLoss: v })}
          />
        </Section>

        <Section
          id="define-run"
          title="Run"
          wide={wide}
          open={open.run}
          onToggle={() => toggle('run')}
          summary={`${fmt(doc.sessions)} sessions`}
        >
          <Field label="Sessions" id="sessions" hint="10,000 gives tight averages.">
            <NumInput
              id="sessions"
              value={doc.sessions}
              min={1}
              max={100000}
              onChange={(n) => patch({ sessions: n })}
            />
          </Field>
          <div class="define-pair">
            <Field label="Seed" id="seed">
              <NumInput
                id="seed"
                value={doc.seed}
                min={0}
                max={4294967295}
                onChange={(n) => patch({ seed: n })}
              />
            </Field>
            <div class="field define-rand">
              <Button onClick={() => patch({ seed: Math.floor(Math.random() * 4294967296) })}>
                Randomize seed
              </Button>
            </div>
          </div>
          <Field
            label="Sessions to keep in full"
            id="samples"
            hint="Sample sessions you can replay in Watch (0 to 100)."
          >
            <NumInput
              id="samples"
              value={doc.sampleSessions}
              min={0}
              max={100}
              onChange={(n) => patch({ sampleSessions: n })}
            />
          </Field>
          <p class="muted" id="estimate">
            Estimated time:{' '}
            {estimate
              ? `${estimate} (${fmt(doc.sessions * doc.maxRounds)} spins in total)`
              : 'run a Quick check to measure this device'}
            .
          </p>
          <div class="actions">
            <Button onClick={() => setSheet('compare')}>Compare with{'…'}</Button>
            <Button onClick={() => void doShare()}>Share link</Button>
            <Button onClick={() => void doSave()} disabled={!analysis.normalized}>
              Save definition
            </Button>
            <Button onClick={() => setSheet('open')}>Open a link or file</Button>
          </div>
        </Section>

        {wide ? (
          <div id="define-panel-anchor">
            <Card title="Validation" class="define-panel">
              <p class="muted">
                {errCount === 0 ? 'No errors.' : `${errCount} to fix before you can run.`}
              </p>
              <DiagList diags={allDiags} onJump={jump} rounds={doc.maxRounds} />
            </Card>
          </div>
        ) : null}
      </div>

      <div class="define-bar" role="region" aria-label="Actions">
        <p class="define-verdict" role="status" aria-live="polite">
          {verdict.state === 'running'
            ? `Checking ${QUICK_SESSIONS} sessions…`
            : verdict.state === 'done'
              ? `${verdict.text} (${QUICK_SESSIONS} sessions, ${verdict.ms} ms)`
              : verdict.state === 'error'
                ? verdict.text
                : ''}
        </p>
        <div class="define-bar-row">
          <button
            type="button"
            class={`btn define-badge define-badge--${errCount > 0 ? 'err' : analysis.warningCount > 0 ? 'warn' : 'ok'}`}
            onClick={() =>
              wide
                ? document.getElementById('define-panel-anchor')?.scrollIntoView()
                : setSheet('diags')
            }
            aria-label={`Validation: ${badgeText}`}
          >
            {badgeText}
          </button>
          <Button
            onClick={() => void doQuick()}
            disabled={hasErrors || verdict.state === 'running'}
          >
            Quick check
          </Button>
          <Button onClick={() => void doDry()} disabled={hasErrors || busy !== null}>
            Dry run
          </Button>
          <Button
            variant="primary"
            onClick={() => void doRun()}
            disabled={hasErrors || busy !== null}
          >
            Run
          </Button>
        </div>
      </div>

      {sheet === 'diags' ? (
        <Sheet open title="Validation" onClose={() => setSheet(null)}>
          <DiagList diags={allDiags} onJump={jump} rounds={doc.maxRounds} />
        </Sheet>
      ) : null}
      {sheet === 'preset' ? (
        <PresetSheet
          onClose={() => setSheet(null)}
          onPick={(id) => {
            const s = presetStrategy(id);
            if (s) {
              setDoc((cur) => docWithStrategy(cur, s, { kind: 'preset', id }));
              setVerdict({ state: 'idle' });
            }
            setSheet(null);
          }}
        />
      ) : null}
      {sheet === 'library' ? (
        <LibrarySheet
          onClose={() => setSheet(null)}
          onPick={(s) => {
            setDoc((cur) => ({
              ...docWithStrategy(cur, s, { kind: 'library', id: s.id }),
              name: s.name,
            }));
            setSheet(null);
          }}
        />
      ) : null}
      {sheet === 'compare' ? (
        <CompareSheet
          onClose={() => setSheet(null)}
          onPick={(runId) => {
            setSheet(null);
            navigate(`/define?compare=${encodeURIComponent(runId)}`);
          }}
        />
      ) : null}
      {sheet === 'share' && share ? (
        <ShareSheet share={share} name={doc.name} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'open' ? (
        <Sheet open title="Open a link or file" onClose={() => setSheet(null)}>
          <Field label="Paste a definition link" id="paste-link">
            <input
              class="input"
              id="paste-link"
              value={pasted}
              onInput={(e) => setPasted(e.currentTarget.value)}
            />
          </Field>
          <div class="actions">
            <Button variant="primary" onClick={() => void openPasted()} disabled={!pasted.trim()}>
              Open link
            </Button>
          </div>
          <Field label="Or open a definition file" id="open-file">
            <input
              class="input"
              id="open-file"
              type="file"
              accept=".json,application/json"
              onChange={(e) => void onFile(e.currentTarget.files?.[0])}
            />
          </Field>
        </Sheet>
      ) : null}
    </div>
  );
}
