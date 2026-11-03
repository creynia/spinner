// "Place a layout" (Play mode): pick a saved or built-in layout, a chip value and whether it adds to
// or replaces the bets on the table, and see what it costs before placing. Game-agnostic: the game
// arrives through `ui`, `plugin` and `rules`. Layouts drawn for another game, or holding bets this
// table does not have (another wheel), are listed but cannot be picked.
import { useMemo, useRef, useState } from 'preact/hooks';
import type { BetId, Cents, GamePlugin } from '../../contracts/game';
import type { LayoutSpot } from '../../contracts/layout';
import type { ChipsUi, GameUi } from '../game-ui';
import { Button, Segmented, Sheet, useId } from '../kit';
import { betLabel, makeRows, money, plural, totalChips } from './adjust';
import { checkAtTable } from './check';
import { ChipRack } from './ChipRack';
import { defaultDenom, LARGE_BANKROLL } from './denoms';
import { LayoutThumb } from './LayoutThumb';
import type { LayoutChoice } from './types';
import './layout.css';

/** Add the layout's chips to what is on the table, or take those bets down first. */
export type PlaceMode = 'add' | 'replace';

export interface PlaceLayoutSheetProps<R = unknown> {
  open: boolean;
  onClose(): void;
  /** Built-in and library layouts (`layoutChoices()` in the app). */
  layouts: readonly LayoutChoice[];
  /** The thumbnails use `chips.ChipBoard` (counts); the chip rack uses `chips.denominations`. */
  ui: Pick<GameUi<R>, 'TableView'> & { chips: ChipsUi<R> };
  plugin: GamePlugin<unknown, unknown, R, unknown>;
  /** The table being played: decides which layouts fit and the table-limit warnings. */
  rules: R;
  /** Money available to place, not counting chips already on the table. */
  bankroll: Cents;
  /** Optional: chips on the table now, which "Replace bets" hands back first (default 0). */
  staked?: Cents;
  /** The layout to select first (e.g. from `#/play?layout=<id>`), when it fits this table. */
  initialId?: string;
  /** Initial mode (default 'add'). */
  initialMode?: PlaceMode;
  /** The confirm button: copies of the spots, the chip value in cents, the mode and the choice. */
  onPlace(spots: LayoutSpot[], chipValue: Cents, mode: PlaceMode, choice: LayoutChoice): void;
  /** Optional "Edit" for the selected library layout (never offered for built-ins). */
  onEdit?(choice: LayoutChoice): void;
  /** Optional "New layout". */
  onNew?(): void;
}

/** "triple-zero" → "Triple zero". */
const presetName = (id: string): string => {
  const s = id.replace(/[-_]+/g, ' ').trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : id;
};

const OFF_TABLE = new Set(['not-on-wheel', 'unknown-bet', 'not-placeable']);

/**
 * Why a layout cannot be placed at this table, or null when it fits: another game, or bets the
 * table's own `reconcile` rejects as not on it (a layout drawn for another wheel).
 */
export function layoutMisfit<R>(
  plugin: GamePlugin<unknown, unknown, R, unknown>,
  rules: R,
  choice: LayoutChoice,
  probe: Cents,
): string | null {
  const l = choice.layout;
  if (l.game !== plugin.id) return `Made for ${presetName(l.game)}, not ${plugin.name}`;
  if (l.spots.length === 0) return 'Empty layout';
  const check = checkAtTable(plugin, rules, makeRows(l.spots, probe), LARGE_BANKROLL);
  const off = check.perSpot.filter((p) => OFF_TABLE.has(p.code ?? ''));
  if (off.length === 0) return null;
  return `Drawn for the ${presetName(l.variant)} wheel: ${plural(off.length, 'bet')} not on this table`;
}

const keyOf = (c: LayoutChoice): string => `${c.builtin ? 'b' : 'u'}:${c.layout.id}`;

export function PlaceLayoutSheet<R>(props: PlaceLayoutSheetProps<R>) {
  const { layouts, ui, plugin, rules, bankroll, staked = 0 } = props;
  const denominations = ui.chips.denominations;
  const probe = denominations[0] ?? 100;
  const id = useId('pl');
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<PlaceMode>(props.initialMode ?? 'add');
  /** A chip value the user picked for the selected layout; null: its preselected one. */
  const [chip, setChip] = useState<Cents | null>(null);

  const misfit = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const c of layouts) m.set(keyOf(c), layoutMisfit(plugin, rules, c, probe));
    return m;
  }, [layouts, plugin, rules, probe]);
  const fits = (c: LayoutChoice) => misfit.get(keyOf(c)) === null;

  const [picked, setPicked] = useState<string | null>(null);
  // The selection: the user's pick, else `initialId` when it fits, else the first that fits.
  const selected = useMemo(() => {
    const byKey = picked ? layouts.find((c) => keyOf(c) === picked && fits(c)) : undefined;
    if (byKey) return byKey;
    const initial = props.initialId
      ? layouts.find((c) => c.layout.id === props.initialId && fits(c))
      : undefined;
    return initial ?? layouts.find(fits) ?? null;
  }, [picked, layouts, misfit, props.initialId]);

  const q = query.trim().toLowerCase();
  const shown = q
    ? layouts.filter((c) =>
        [c.layout.name, c.layout.id, ...(c.layout.tags ?? [])].some((t) =>
          t.toLowerCase().includes(q),
        ),
      )
    : layouts;
  const enabled = shown.filter(fits);

  const preset = useMemo(
    () =>
      selected && denominations.length
        ? defaultDenom(plugin, rules, selected.layout.spots, denominations).denom
        : null,
    [selected, plugin, rules, denominations],
  );
  const value = chip ?? preset;
  const spots = selected?.layout.spots ?? [];
  const chips = totalChips(spots);
  const cost = value === null ? 0 : chips * value;
  const check = useMemo(
    () =>
      selected && value !== null
        ? checkAtTable(plugin, rules, makeRows(spots, value), LARGE_BANKROLL)
        : null,
    [selected, value, plugin, rules],
  );
  const problems = check?.perSpot.filter((p) => p.status !== 'ok') ?? [];
  const available = bankroll + (mode === 'replace' ? staked : 0);

  const whyNot =
    selected === null
      ? 'Pick a layout'
      : value === null
        ? 'Pick a chip value'
        : cost > available
          ? `Costs ${money(cost)}; you have ${money(available)}${
              mode === 'add' && staked > 0 ? ' (Replace bets frees what is on the table)' : ''
            }`
          : null;

  const select = (c: LayoutChoice) => {
    if (!fits(c)) return;
    setPicked(keyOf(c));
    setChip(null);
  };
  const onRadioKey = (e: KeyboardEvent, c: LayoutChoice) => {
    const i = enabled.indexOf(c);
    const n = enabled.length;
    let to = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') to = (i + 1) % n;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') to = (i - 1 + n) % n;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      select(c);
      return;
    }
    if (to < 0 || n === 0) return;
    e.preventDefault();
    const next = enabled[to]!;
    select(next);
    const radios = listRef.current?.querySelectorAll<HTMLElement>('[role=radio]') ?? [];
    [...radios].find((r) => r.dataset.choice === keyOf(next))?.focus();
  };
  // One tab stop: the selected radio when it is shown, else the first enabled one.
  const tabStop = selected && enabled.includes(selected) ? selected : (enabled[0] ?? null);

  const place = () => {
    if (whyNot !== null || !selected || value === null) return;
    props.onPlace(
      selected.layout.spots.map((s) => ({ ...s })),
      value,
      mode,
      selected,
    );
  };

  const label = (bet: BetId) => betLabel(plugin.bets.catalog(rules), bet);
  const confirm = mode === 'add' ? 'Add to table' : 'Replace bets';

  return (
    <Sheet open={props.open} title="Place a layout" onClose={() => props.onClose()}>
      <div class="pl-sheet">
        {layouts.length > 0 ? (
          <div class="pl-search">
            <label class="le-label" for={`${id}-q`}>
              Search layouts
            </label>
            <input
              class="input"
              id={`${id}-q`}
              type="search"
              value={query}
              placeholder="Name or tag"
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
          </div>
        ) : null}

        {layouts.length === 0 ? (
          <p class="muted">No layouts yet. Build one to place it here.</p>
        ) : shown.length === 0 ? (
          <p class="muted" role="status">
            No layout matches “{query.trim()}”.
          </p>
        ) : (
          <div class="pl-list" role="radiogroup" aria-label="Layouts" ref={listRef}>
            {shown.map((c) => {
              const k = keyOf(c);
              const why = misfit.get(k) ?? null;
              const on = selected !== null && keyOf(selected) === k;
              const n = `${id}-${k.replace(/[^a-z0-9-]/gi, '_')}`;
              return (
                <div
                  key={k}
                  role="radio"
                  class={`pl-item${on ? ' is-on' : ''}${why ? ' is-off' : ''}`}
                  data-choice={k}
                  aria-checked={on}
                  aria-disabled={why ? 'true' : undefined}
                  aria-labelledby={`${n}-name`}
                  aria-describedby={`${n}-meta`}
                  tabIndex={!why && tabStop !== null && keyOf(tabStop) === k ? 0 : -1}
                  onClick={() => select(c)}
                  onKeyDown={(e) => onRadioKey(e, c)}
                >
                  <div class="pl-thumb" aria-hidden="true">
                    <LayoutThumb ui={ui} rules={rules} spots={c.layout.spots} chipValue={null} />
                  </div>
                  <div class="pl-info">
                    <strong id={`${n}-name`}>{c.layout.name}</strong>
                    <span id={`${n}-meta`} class="pl-meta">
                      {c.builtin ? <span class="b-pill pl-pill">Built-in</span> : null}
                      <span class="muted">
                        {plural(c.layout.spots.length, 'spot')} ·{' '}
                        {plural(totalChips(c.layout.spots), 'chip')}
                      </span>
                      {why ? <span class="pl-why">{why}</span> : null}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {props.onNew || (props.onEdit && selected && !selected.builtin) ? (
          <div class="pl-links">
            {props.onEdit && selected && !selected.builtin ? (
              <Button
                variant="ghost"
                aria-label={`Edit ${selected.layout.name}`}
                onClick={() => props.onEdit!(selected)}
              >
                Edit
              </Button>
            ) : null}
            {props.onNew ? (
              <Button variant="ghost" onClick={() => props.onNew!()}>
                New layout
              </Button>
            ) : null}
          </div>
        ) : null}

        {selected ? (
          <div class="pl-confirm">
            <div class="field">
              <span class="le-label">Chip value</span>
              <ChipRack
                denominations={denominations}
                value={value}
                onChange={(d) => setChip(d)}
                label="Chip value"
              />
            </div>
            <Segmented
              label="On the table"
              value={mode}
              options={[
                { value: 'add', label: 'Add to table' },
                { value: 'replace', label: 'Replace bets' },
              ]}
              onChange={setMode}
            />
            <p class="pl-total" aria-live="polite" aria-atomic="true">
              <span class="muted">{selected.layout.name}: </span>
              {value === null ? (
                'pick a chip value'
              ) : (
                <>
                  {plural(chips, 'chip')} × {money(value)} ={' '}
                  <strong class="le-total">{money(cost)}</strong>
                </>
              )}
            </p>
            {problems.length > 0 ? (
              <p class="pl-warn" role="note">
                {plural(problems.length, 'spot')} would not be placed as drawn at this table. First:{' '}
                {label(problems[0]!.bet)} {problems[0]!.reason ?? problems[0]!.code}.
              </p>
            ) : null}
            <div class="pl-actions">
              <button
                type="button"
                class="btn btn-primary"
                disabled={whyNot !== null}
                aria-describedby={whyNot ? `${id}-why` : undefined}
                onClick={place}
              >
                {confirm}
              </button>
              {whyNot ? (
                <span class="le-hint" id={`${id}-why`}>
                  {whyNot}
                </span>
              ) : null}
            </div>
          </div>
        ) : layouts.length > 0 ? (
          <p class="muted">None of these layouts fits this table.</p>
        ) : null}
      </div>
    </Sheet>
  );
}
