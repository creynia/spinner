// The generic tap-to-place editor shell (layouts.md §4, §6.1): header, tool row, tabs (Table hosts
// the game's `ChipBoard`; List is generic), status line and live region, keyboard shortcuts and the
// unsaved-changes guard. Game-agnostic: everything game-specific arrives through props.
import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { BetId, Cents } from '../../contracts/game';
import { MAX_CHIPS_PER_SPOT, MAX_LAYOUT_SPOTS } from '../../contracts/layout';
import { Button, Field, Select, Sheet, Tabs, TextInput, useId } from '../kit';
import { ChipRack } from './ChipRack';
import { SpotList } from './SpotList';
import {
  adjustSpots,
  betLabel,
  makeRows,
  money,
  plural,
  sameSpotsInOrder,
  totalChips,
} from './adjust';
import { checkAtTable } from './check';
import { useChipHistory } from './history';
import type { ChipTool, LayoutEditorProps } from './types';
import './layout.css';

/** Phones are up to 600 px wide (game.md §12.1); the permanent list needs a desktop. */
const WIDE = 600;
const DESKTOP = 1024;

function useWidth(): number {
  const read = () => (typeof window === 'undefined' ? DESKTOP : window.innerWidth);
  const [w, setW] = useState(read);
  useEffect(() => {
    const on = () => setW(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

const editable = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable === true
  );
};

function Icon({ children }: { children: ComponentChildren }) {
  return (
    <span class="le-icon" aria-hidden="true">
      {children}
    </span>
  );
}

export function LayoutEditor<R>(props: LayoutEditorProps<R>) {
  const { plugin, rules, ui, bankroll, reservedSpots = 0, variants } = props;
  const { ChipBoard, denominations } = ui.chips;
  const step = (b: BetId) => ui.chips.step(b);
  const catalog = useMemo(() => plugin.bets.catalog(rules), [plugin, rules]);
  const maxSpots = Math.max(0, MAX_LAYOUT_SPOTS - reservedSpots);

  const hist = useChipHistory(props.initialSpots);
  const spots = hist.spots;
  const [tool, setTool] = useState<ChipTool>('add');
  const [tab, setTab] = useState('table');
  const [value, setValue] = useState<Cents | null>(props.chipValue);
  const [last, setLast] = useState<BetId | null>(null);
  const [name, setName] = useState(props.name);
  const [notes, setNotes] = useState(props.notes ?? '');
  const [saved, setSaved] = useState({
    spots: props.initialSpots,
    name: props.name,
    notes: props.notes ?? '',
    variant: props.variant,
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [guardOpen, setGuardOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const flip = useRef(false);
  const id = useId('le');
  const width = useWidth();
  const wide = width > WIDE;
  const desktop = width >= DESKTOP;

  const say = useCallback((text: string) => {
    // A repeated message must still be announced: alternate a trailing no-break space.
    flip.current = !flip.current;
    setMessage(flip.current ? text : `${text}\u00a0`);
  }, []);

  const label = useCallback((bet: BetId) => betLabel(catalog, bet), [catalog]);

  const nameOk = name.trim().length >= 1 && name.length <= 80;
  const dirty =
    !sameSpotsInOrder(spots, saved.spots) ||
    name !== saved.name ||
    notes !== saved.notes ||
    props.variant !== saved.variant;

  const check = useMemo(
    () => (value === null ? null : checkAtTable(plugin, rules, makeRows(spots, value), bankroll)),
    [plugin, rules, spots, value, bankroll],
  );
  const flagged = useMemo(() => {
    const m = new Map<BetId, string>();
    for (const p of check?.perSpot ?? [])
      if (p.status !== 'ok') m.set(p.bet, p.reason ?? p.code ?? 'problem');
    return m;
  }, [check]);

  const adjust = useCallback(
    (bet: BetId, delta: number) => {
      const name_ = label(bet);
      const r = adjustSpots(spots, bet, delta, { maxSpots });
      if (r.refused === 'max-spots') {
        say(`A layout holds at most ${plural(maxSpots, 'spot')}`);
        return;
      }
      if (r.refused === 'max-chips') {
        say(`A spot holds at most ${MAX_CHIPS_PER_SPOT} chips`);
        return;
      }
      if (r.refused === 'none-to-remove') {
        say(`No chips on ${name_}`);
        return;
      }
      const n = r.spots.find((s) => s.bet === bet)?.chips ?? 0;
      if (delta > 0) {
        hist.push(r.spots, `${name_}, ${plural(n, 'chip')}`);
        say(`${name_} · ${plural(n, 'chip')}`);
        setLast(bet);
      } else {
        hist.push(r.spots, n === 0 ? `Removed ${name_}` : `${name_}, ${plural(n, 'chip')}`);
        say(n === 0 ? `${name_} removed` : `${name_} · ${plural(n, 'chip')}`);
        setLast(n === 0 ? null : bet);
      }
    },
    [spots, maxSpots, hist, label, say],
  );

  const remove = (bet: BetId) => {
    hist.push(
      spots.filter((s) => s.bet !== bet),
      `Removed ${label(bet)}`,
    );
    say(`${label(bet)} removed`);
    setLast(null);
  };
  const move = (bet: BetId, dir: -1 | 1) => {
    const i = spots.findIndex((s) => s.bet === bet);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= spots.length) return;
    const next = [...spots];
    [next[i], next[j]] = [next[j]!, next[i]!];
    hist.push(next, `Moved ${label(bet)} ${dir < 0 ? 'up' : 'down'}`);
    say(`${label(bet)} moved ${dir < 0 ? 'up' : 'down'}, now ${j + 1} of ${spots.length}`);
  };
  const undo = () => {
    if (!hist.canUndo) return;
    say(`Undid: ${hist.undoLabel}`);
    hist.undo();
    setLast(null);
  };
  const redo = () => {
    if (!hist.canRedo) return;
    say(`Redid: ${hist.redoLabel}`);
    hist.redo();
    setLast(null);
  };
  const clear = () => {
    if (spots.length === 0) return;
    hist.clear();
    say('Cleared all chips');
    setLast(null);
  };
  const chooseTool = (t: ChipTool) => {
    setTool(t);
    say(t === 'add' ? 'Add mode' : 'Remove mode');
  };

  const save = async () => {
    if (spots.length === 0 || !nameOk || saving) return;
    setSaving(true);
    try {
      const trimmed = notes.trim();
      await props.onSave({
        spots: spots.map((s) => ({ ...s })),
        name: name.trim(),
        variant: props.variant,
        ...(trimmed ? { notes: trimmed } : {}),
      });
      setSaved({ spots, name, notes, variant: props.variant });
      say('Saved');
    } catch {
      say('Could not save');
    } finally {
      setSaving(false);
    }
  };
  const close = () => (dirty ? setGuardOpen(true) : props.onClose());

  // Shortcuts act on the document while the editor is mounted; typing in a field is left alone.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (editable(e.target) || document.querySelector('.sheet')) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && k === 'y' && !e.metaKey) {
      e.preventDefault();
      redo();
    } else if (!mod && !e.altKey && k === 'e') {
      e.preventDefault();
      chooseTool(tool === 'add' ? 'remove' : 'add');
    }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, []);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const on = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', on);
    return () => window.removeEventListener('beforeunload', on);
  }, []);

  const toolKey = (e: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const to: ChipTool =
      e.key === 'Home' || e.key === 'ArrowLeft' || e.key === 'ArrowUp'
        ? e.key === 'Home'
          ? 'add'
          : tool === 'add'
            ? 'remove'
            : 'add'
        : e.key === 'End'
          ? 'remove'
          : tool === 'add'
            ? 'remove'
            : 'add';
    chooseTool(to);
    const group = (e.currentTarget as HTMLElement).parentElement;
    queueMicrotask(() => group?.querySelector<HTMLElement>(`[data-tool="${to}"]`)?.focus());
  };

  const showTool = wide || tab === 'table';
  const tools = (
    <div class="le-tools">
      {showTool ? (
        <div class="le-tool-group" role="radiogroup" aria-label="Tool">
          {(['add', 'remove'] as const).map((t) => (
            <button
              type="button"
              role="radio"
              class="le-btn"
              data-tool={t}
              aria-checked={tool === t}
              aria-label={t === 'add' ? 'Add chips' : 'Remove chips'}
              title={t === 'add' ? 'Add chips' : 'Remove chips'}
              tabIndex={tool === t ? 0 : -1}
              onClick={() => chooseTool(t)}
              onKeyDown={toolKey}
            >
              <Icon>{t === 'add' ? '+' : '−'}</Icon>
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        class="le-btn"
        aria-label="Undo"
        title="Undo"
        disabled={!hist.canUndo}
        onClick={undo}
      >
        <Icon>↶</Icon>
      </button>
      <button
        type="button"
        class="le-btn"
        aria-label="Redo"
        title="Redo"
        disabled={!hist.canRedo}
        onClick={redo}
      >
        <Icon>↷</Icon>
      </button>
      <button
        type="button"
        class="le-btn"
        aria-label="Clear"
        title="Clear"
        disabled={spots.length === 0}
        onClick={clear}
      >
        <Icon>⌫</Icon>
      </button>
      <button
        type="button"
        class="le-btn"
        aria-label="More"
        title="More"
        aria-haspopup="dialog"
        onClick={() => setMoreOpen(true)}
      >
        <Icon>⋯</Icon>
      </button>
    </div>
  );

  const saveBtn = (
    <Button
      variant="primary"
      disabled={spots.length === 0 || !nameOk || saving}
      onClick={() => void save()}
    >
      Save
    </Button>
  );

  const board = (
    <div class="le-board" data-tool={tool}>
      <ChipBoard
        rules={rules}
        spots={spots}
        tool={tool}
        chipValue={value}
        onAdjust={adjust}
        last={last}
        flagged={flagged}
        onStatus={say}
      />
    </div>
  );
  const list = (
    <SpotList
      rules={rules}
      catalog={catalog}
      spots={spots}
      BetPicker={ui.BetPicker}
      step={step}
      chipValue={value}
      check={check}
      onAdjust={adjust}
      onRemove={remove}
      onMove={move}
      maxSpots={maxSpots}
    />
  );

  const chips = totalChips(spots);
  const problems = check?.perSpot.filter((p) => p.status !== 'ok') ?? [];
  const summary =
    spots.length === 0
      ? 'Empty: tap the table to add chips'
      : `${plural(chips, 'chip')} · ${plural(spots.length, 'spot')}` +
        (check && value !== null
          ? ` · at ${money(value)}: ${money(check.total)} ${problems.length ? '!' : '✓'}`
          : '');

  return (
    <div class={`layout-editor${wide ? ' is-wide' : ''}`}>
      <header class="le-head">
        <button type="button" class="le-btn" aria-label="Back" title="Back" onClick={close}>
          <Icon>←</Icon>
        </button>
        <h2 class="le-title">{name || 'Untitled layout'}</h2>
        {wide ? null : saveBtn}
      </header>

      {wide ? (
        <div class="le-wide">
          {board}
          <aside class="le-rail" aria-label="Tools">
            {saveBtn}
            {tools}
            {desktop ? (
              <div class="le-rail-list">{list}</div>
            ) : (
              <Button onClick={() => setListOpen(true)}>List</Button>
            )}
          </aside>
        </div>
      ) : (
        <Tabs
          tabs={[
            { id: 'table', label: 'Table' },
            { id: 'list', label: 'List' },
          ]}
          value={tab}
          onChange={setTab}
          label="Editor view"
          idPrefix="le"
        >
          {tools}
          {tab === 'table' ? board : list}
        </Tabs>
      )}

      {problems.length ? (
        <div class="le-problems" role="status">
          <span aria-hidden="true">! </span>
          {plural(problems.length, 'spot')} would not be placed as drawn. First:{' '}
          {label(problems[0]!.bet)} {problems[0]!.reason ?? problems[0]!.code}.
        </div>
      ) : null}

      <div class="le-status">
        <span class="le-summary">{summary}</span>
        <span class="le-live" aria-live="polite" aria-atomic="true">
          {message}
        </span>
      </div>

      <Sheet open={moreOpen} title="Layout details" onClose={() => setMoreOpen(false)}>
        <div class="le-more">
          <Field
            label="Name"
            id={`${id}-name`}
            error={nameOk ? null : 'Give it a name (1 to 80 characters)'}
          >
            <TextInput id={`${id}-name`} value={name} onInput={setName} invalid={!nameOk} />
          </Field>
          {variants && props.onVariantChange ? (
            <Field label="Wheel" id={`${id}-variant`}>
              <Select
                id={`${id}-variant`}
                value={props.variant}
                options={variants.map((v) => ({ value: v.id, label: v.label }))}
                onChange={(v) => props.onVariantChange?.(v)}
              />
            </Field>
          ) : null}
          <Field label="Notes" id={`${id}-notes`}>
            <textarea
              class="input"
              id={`${id}-notes`}
              rows={3}
              maxLength={4000}
              value={notes}
              onInput={(e) => setNotes(e.currentTarget.value)}
            />
          </Field>
          <div class="field">
            <span class="le-label" id={`${id}-preview`}>
              Preview chip value
            </span>
            <ChipRack
              denominations={denominations}
              value={value}
              onChange={setValue}
              label="Preview chip value"
            />
            <Button variant="ghost" disabled={value === null} onClick={() => setValue(null)}>
              Show chip counts
            </Button>
          </div>
        </div>
      </Sheet>

      <Sheet open={listOpen && !desktop} title="Spots" onClose={() => setListOpen(false)}>
        {list}
      </Sheet>

      <Sheet open={guardOpen} title="Discard changes?" onClose={() => setGuardOpen(false)}>
        <p>You have unsaved changes to this layout.</p>
        <div class="le-guard">
          <Button autoFocus onClick={() => setGuardOpen(false)}>
            Keep editing
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setGuardOpen(false);
              props.onClose();
            }}
          >
            Discard
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
