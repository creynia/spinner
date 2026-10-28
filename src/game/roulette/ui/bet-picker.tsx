// BetPicker: tap a region of the felt to pick a canonical bet id (game.md §12.2). Outside boxes
// answer directly; a number opens a bet sheet listing every inside bet containing it; call bets and
// neighbours have their own tab; a text field takes any id or alias.
import type { BetPickerProps } from '@core/ui';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { betDef, familyOf, fixedBetIds, parseBet } from '../bets';
import { pocketIndexOf, pocketLabels } from '../pockets';
import type { Family, RouletteRules, WheelKind } from '../types';
import { MAX_CHIPS_PER_SPOT } from '@core/contracts/layout';
import { Board } from './board';
import { stepOf } from './chips';
import { buildBoard, type Rect } from './geometry';
import { useOrientation } from './hooks';
import { betName, paysText } from './names';

const SHEET_ORDER: Family[] = [
  'straight',
  'split',
  'street',
  'trio',
  'basket',
  'corner',
  'sixline',
];
const CALLS = [
  { id: 'voisins', pockets: 17 },
  { id: 'tiers', pockets: 12 },
  { id: 'orphelins', pockets: 8 },
  { id: 'jeu-zero', pockets: 7 },
] as const;

/** `parseBet`, plus bare pocket lists: `17-20` is a split, `13-14-16-17` a corner. */
export function parseTyped(text: string, wheel: WheelKind): string | null {
  const direct = parseBet(text);
  if (direct !== null) return direct;
  const t = text.trim();
  if (!/^\d+(-\d+)+$/.test(t)) return null;
  const families: Record<number, string[]> = {
    2: ['split'],
    3: ['street', 'trio'],
    4: ['corner'],
    6: ['sixline'],
  };
  for (const fam of families[t.split('-').length] ?? []) {
    const id = parseBet(`${fam}:${t}`);
    if (id !== null && betDef(id, wheel)) return id;
  }
  return null;
}

type Tab = 'table' | 'calls' | 'type';

/** Chip steppers (layout editor): chips per bet and a way to change them by ± the bet's step. */
export interface ChipSteps {
  chips(bet: string): number;
  onAdjust(bet: string, delta: number): void;
}

/** "− n +" for one bet: buttons move by the bet's step (call bets: their pieces). */
export function ChipStepper({
  bet,
  wheel,
  steps,
}: {
  bet: string;
  wheel: WheelKind;
  steps: ChipSteps;
}) {
  const n = steps.chips(bet);
  const step = stepOf(bet);
  const name = betName(bet, wheel);
  const unit = step === 1 ? '1 chip' : `${step} chips`;
  return (
    <span class="rl-step" data-stepper={bet}>
      <button
        type="button"
        class="rl-btn rl-step__btn"
        aria-label={`Remove ${unit} from ${name}`}
        disabled={n < step}
        onClick={() => steps.onAdjust(bet, -step)}
      >
        −
      </button>
      <output class="rl-step__n" aria-label={`${n} ${n === 1 ? 'chip' : 'chips'} on ${name}`}>
        {n}
      </output>
      <button
        type="button"
        class="rl-btn rl-step__btn"
        aria-label={`Add ${unit} to ${name}`}
        disabled={n + step > MAX_CHIPS_PER_SPOT}
        onClick={() => steps.onAdjust(bet, step)}
      >
        +
      </button>
    </span>
  );
}

/** Every inside bet that covers this pocket, in sheet order (straight, splits, street, ...). */
export function insideBetsContaining(label: string, wheel: WheelKind): string[] {
  const p = pocketIndexOf(label);
  return fixedBetIds(wheel)
    .filter((id) => {
      const fam = familyOf(id);
      return fam !== null && SHEET_ORDER.includes(fam) && betDef(id, wheel)?.pockets.includes(p);
    })
    .sort((a, b) => SHEET_ORDER.indexOf(familyOf(a)!) - SHEET_ORDER.indexOf(familyOf(b)!));
}

/** A few cells of the table with the covered ones filled. */
function MiniDiagram({ id, wheel }: { id: string; wheel: WheelKind }) {
  const board = buildBoard(wheel, 'portrait');
  const labels = pocketLabels(wheel);
  const covered = new Set<string>((betDef(id, wheel)?.pockets ?? []).map((p) => labels[p]!));
  const rects = [...covered].map((l) => board.pockets.get(l)).filter((r): r is Rect => !!r);
  const y0 = Math.max(0, Math.min(...rects.map((r) => r.y)) - 48);
  const y1 = Math.min(624, Math.max(...rects.map((r) => r.y + r.h)) + 48);
  const view = [...board.pockets.entries()].filter(([, r]) => r.y + r.h > y0 && r.y < y1);
  const xs = view.map(([, r]) => r.x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...view.map(([, r]) => r.x + r.w));
  return (
    <svg
      class="rl-mini"
      viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`}
      width={Math.round((x1 - x0) / 5)}
      height={Math.round((y1 - y0) / 5)}
      aria-hidden="true"
      focusable="false"
    >
      {view.map(([l, r]) => (
        <rect
          key={l}
          class={covered.has(l) ? 'rl-mini__on' : 'rl-mini__off'}
          x={r.x + 2}
          y={r.y + 2}
          width={r.w - 4}
          height={r.h - 4}
        />
      ))}
    </svg>
  );
}

export function BetSheet(props: {
  label: string;
  wheel: WheelKind;
  value?: string;
  onPick?: (id: string) => void;
  onClose: () => void;
  /** Layout editor: each row gets a − n + stepper instead of picking the bet. */
  steps?: ChipSteps;
  /** Always a bottom sheet over a backdrop (never the inline card of wide screens). */
  modal?: boolean;
}) {
  const { label, wheel } = props;
  const ref = useRef<HTMLElement>(null);
  // A long-press opens the sheet under the finger: the release's click must not hit the backdrop.
  const openedAt = useRef(Date.now());
  const items = useMemo(() => insideBetsContaining(label, wheel), [label, wheel]);
  useEffect(() => {
    ref.current?.focus();
  }, [label]);
  return (
    <>
      <div
        class={`rl-backdrop${props.modal ? ' rl-backdrop--modal' : ''}`}
        aria-hidden="true"
        onClick={() => {
          if (props.steps && Date.now() - openedAt.current < 500) return;
          props.onClose();
        }}
      />
      <section
        class={`rl-sheet${props.modal ? ' rl-sheet--modal' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Bets on ${label}`}
        tabIndex={-1}
        ref={ref}
        data-sheet={label}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onClose();
          if (e.key !== 'Tab') return;
          // Trap Tab inside the sheet (the table behind it is covered by the backdrop).
          const items = [...(ref.current?.querySelectorAll<HTMLElement>('button') ?? [])];
          const first = items[0];
          const last = items.at(-1);
          const at = document.activeElement;
          if (e.shiftKey && (at === first || at === ref.current)) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && at === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
      >
        <header class="rl-sheet__head">
          <h3>Bets on {label}</h3>
          <button type="button" class="rl-btn" onClick={props.onClose}>
            Close
          </button>
        </header>
        <ul class="rl-rows">
          {items.map((id) =>
            props.steps ? (
              <li key={id} class="rl-row rl-row--steps" data-bet-row={id}>
                <MiniDiagram id={id} wheel={wheel} />
                <span class="rl-row__text">
                  <strong>{betName(id, wheel)}</strong>
                  <span class="rl-muted">{paysText(id, wheel).replace('pays ', '')}</span>
                </span>
                <ChipStepper bet={id} wheel={wheel} steps={props.steps} />
              </li>
            ) : (
              <li key={id}>
                <button
                  type="button"
                  class="rl-row"
                  data-bet-row={id}
                  aria-pressed={props.value === id}
                  onClick={() => props.onPick?.(id)}
                >
                  <MiniDiagram id={id} wheel={wheel} />
                  <span class="rl-row__text">
                    <strong>{betName(id, wheel)}</strong>
                    <code>{id}</code>
                  </span>
                  <span class="rl-row__pays">{paysText(id, wheel).replace('pays ', '')}</span>
                </button>
              </li>
            ),
          )}
        </ul>
      </section>
    </>
  );
}

function Components({ id, wheel }: { id: string; wheel: WheelKind }) {
  const def = betDef(id, wheel);
  return (
    <ul class="rl-comps" aria-label={`Chips of ${betName(id, wheel)}`}>
      {(def?.components ?? []).map((c, i) => (
        <li key={i} class="rl-comp" data-comp={c.spot}>
          {c.spot.startsWith('straight:') ? c.spot.slice(9) : c.spot.replace(':', ' ')}
          {c.weight > 1 && <span> ×{c.weight}</span>}
        </li>
      ))}
    </ul>
  );
}

export function CallsPanel({
  wheel,
  value,
  onPick,
  steps,
  placed = [],
}: {
  wheel: WheelKind;
  value?: string;
  onPick?: (id: string) => void;
  /** Layout editor: sector rows get steppers, and "Add" places the neighbours (2k+1 chips). */
  steps?: ChipSteps;
  /** Layout editor: neighbours bets already on the layout, listed with steppers. */
  placed?: readonly string[];
}) {
  const [p, setP] = useState('0');
  const [k, setK] = useState(2);
  const id = `neighbours:${p}:${k}`;
  return (
    <div class="rl-calls">
      <ul class="rl-rows">
        {CALLS.map((c) => (
          <li key={c.id}>
            {steps ? (
              <div class="rl-row rl-row--call rl-row--steps" data-bet={c.id}>
                <span class="rl-row__text">
                  <strong>{betName(c.id, wheel)}</strong>
                  <span class="rl-muted">
                    {c.pockets} pockets · {stepOf(c.id)} chips a time
                  </span>
                </span>
                <ChipStepper bet={c.id} wheel={wheel} steps={steps} />
              </div>
            ) : (
              <button
                type="button"
                class="rl-row rl-row--call"
                data-bet={c.id}
                aria-pressed={value === c.id}
                onClick={() => onPick?.(c.id)}
              >
                <span class="rl-row__text">
                  <strong>{betName(c.id, wheel)}</strong>
                  <span class="rl-muted">
                    {c.pockets} pockets · <code>{c.id}</code>
                  </span>
                </span>
              </button>
            )}
            <Components id={c.id} wheel={wheel} />
          </li>
        ))}
      </ul>
      <fieldset class="rl-neighbours">
        <legend>Neighbours</legend>
        <div class="rl-pgrid" role="group" aria-label="Centre pocket">
          {pocketLabels('european').map((l) => (
            <button
              key={l}
              type="button"
              class="rl-pbtn"
              data-centre={l}
              aria-pressed={p === l}
              onClick={() => setP(l)}
            >
              {l}
            </button>
          ))}
        </div>
        <div class="rl-stepper">
          <button
            type="button"
            class="rl-btn"
            aria-label="Fewer neighbours"
            disabled={k <= 1}
            onClick={() => setK(k - 1)}
          >
            −
          </button>
          <output aria-live="polite">±{k} each side</output>
          <button
            type="button"
            class="rl-btn"
            aria-label="More neighbours"
            disabled={k >= 9}
            onClick={() => setK(k + 1)}
          >
            +
          </button>
        </div>
        <Components id={id} wheel={wheel} />
        {steps ? (
          <button
            type="button"
            class="rl-btn rl-btn--primary"
            data-add-neighbours={id}
            onClick={() => steps.onAdjust(id, stepOf(id))}
          >
            Add {betName(id, wheel)} ({stepOf(id)} chips)
          </button>
        ) : (
          <button
            type="button"
            class="rl-btn rl-btn--primary"
            data-bet={id}
            aria-pressed={value === id}
            onClick={() => onPick?.(id)}
          >
            Pick {betName(id, wheel)}
          </button>
        )}
        {steps && placed.length > 0 && (
          <ul class="rl-rows" aria-label="Neighbours on the layout">
            {placed.map((b) => (
              <li key={b} class="rl-row rl-row--steps" data-bet={b}>
                <span class="rl-row__text">
                  <strong>{betName(b, wheel)}</strong>
                </span>
                <ChipStepper bet={b} wheel={wheel} steps={steps} />
              </li>
            ))}
          </ul>
        )}
      </fieldset>
    </div>
  );
}

function TypePanel({ wheel, onPick }: { wheel: WheelKind; onPick: (id: string) => void }) {
  const [text, setText] = useState('');
  const canonical = text.trim() === '' ? null : parseTyped(text, wheel);
  const def = canonical ? betDef(canonical, wheel) : null;
  const submit = () => def && canonical && onPick(canonical);
  return (
    <div>
      <form
        class="rl-type"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label>
          Bet id or alias
          <input
            class="rl-input"
            type="text"
            value={text}
            autoCapitalize="none"
            autoComplete="off"
            spellcheck={false}
            placeholder="17-20, voisins, noir"
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
          />
        </label>
        <p class="rl-echo" role="status">
          {text.trim() === ''
            ? 'Try 17, 17-20, corner:13-14-16-17 or voisins.'
            : def && canonical
              ? `${canonical}: ${betName(canonical, wheel)}, ${paysText(canonical, wheel)}`
              : canonical
                ? `${canonical} is not on the ${wheel} wheel`
                : 'Not a bet id'}
        </p>
        <button type="submit" class="rl-btn rl-btn--primary" disabled={!def}>
          Use this bet
        </button>
      </form>
    </div>
  );
}

let pickerCount = 0;

export function BetPicker(props: BetPickerProps<RouletteRules>) {
  const { rules, value } = props;
  const wheel = rules.wheel;
  const orientation = useOrientation();
  const [tab, setTab] = useState<Tab>('table');
  const [sheet, setSheet] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const tabs: Tab[] = wheel === 'european' ? ['table', 'calls', 'type'] : ['table', 'type'];
  const active = tabs.includes(tab) ? tab : 'table';
  const shown = hover ?? value ?? null;
  const covered = useMemo(() => {
    const def = shown ? betDef(shown, wheel) : null;
    const labels = pocketLabels(wheel);
    return new Set(def ? def.pockets.map((p) => labels[p]!) : []);
  }, [shown, wheel]);
  const opener = useRef<Element | null>(null);
  const uid = useRef(++pickerCount).current;
  const closeSheet = () => {
    if (sheet === null) return;
    setSheet(null);
    // Give focus back to the number that opened the sheet.
    const el = opener.current;
    if (el instanceof HTMLElement || el instanceof SVGElement) setTimeout(() => el.focus(), 0);
  };
  const pick = (id: string) => {
    closeSheet();
    props.onPick(id);
  };
  const onTabKey = (e: KeyboardEvent, i: number) => {
    const to =
      e.key === 'ArrowRight'
        ? (i + 1) % tabs.length
        : e.key === 'ArrowLeft'
          ? (i + tabs.length - 1) % tabs.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? tabs.length - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    setTab(tabs[to]!);
    document.getElementById(`rl-tab-${uid}-${tabs[to]}`)?.focus();
  };
  const TAB_TEXT: Record<Tab, string> = { table: 'Table', calls: 'Call bets', type: 'Type an id' };
  return (
    <section class="rl-ui rl-picker" aria-label="Pick a bet" data-wheel={wheel}>
      <div class="rl-tabs" role="tablist" aria-label="How to pick">
        {tabs.map((t, i) => (
          <button
            key={t}
            id={`rl-tab-${uid}-${t}`}
            type="button"
            role="tab"
            class="rl-tab"
            aria-selected={active === t}
            aria-controls={`rl-panel-${uid}`}
            tabIndex={active === t ? 0 : -1}
            onKeyDown={(e) => onTabKey(e, i)}
            onClick={() => setTab(t)}
          >
            {TAB_TEXT[t]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`rl-panel-${uid}`} aria-labelledby={`rl-tab-${uid}-${active}`}>
        {active === 'table' && (
          <>
            <Board
              wheel={wheel}
              orientation={orientation}
              label="Roulette table: choose a bet"
              mode="pick"
              covered={covered}
              marked={shown}
              onCell={(l, el) => {
                opener.current = el;
                setSheet(l);
              }}
              onOutside={pick}
              onZone={pick}
              onHover={setHover}
            />
            <p class="rl-hint rl-muted">
              Tap a number for every bet that includes it, or an outside box to pick it.
            </p>
            {sheet !== null && (
              <BetSheet
                label={sheet}
                wheel={wheel}
                value={value}
                onPick={pick}
                onClose={closeSheet}
              />
            )}
          </>
        )}
        {active === 'calls' && <CallsPanel wheel={wheel} value={value} onPick={pick} />}
        {active === 'type' && <TypePanel wheel={wheel} onPick={pick} />}
      </div>
    </section>
  );
}
