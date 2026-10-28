// BetPicker: tap a region of the felt to pick a canonical bet id (game.md §12.2). Outside boxes
// answer directly; a number opens a bet sheet listing every inside bet containing it; call bets and
// neighbours have their own tab; a text field takes any id or alias.
import type { BetPickerProps } from '@core/ui';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { betDef, familyOf, fixedBetIds, parseBet } from '../bets';
import { pocketIndexOf, pocketLabels } from '../pockets';
import type { Family, RouletteRules, WheelKind } from '../types';
import { Board } from './board';
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

function BetSheet(props: {
  label: string;
  wheel: WheelKind;
  value?: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const { label, wheel } = props;
  const ref = useRef<HTMLElement>(null);
  const items = useMemo(() => insideBetsContaining(label, wheel), [label, wheel]);
  useEffect(() => {
    ref.current?.focus();
  }, [label]);
  return (
    <>
      <div class="rl-backdrop" aria-hidden="true" onClick={props.onClose} />
      <section
        class="rl-sheet"
        role="dialog"
        aria-label={`Bets on ${label}`}
        tabIndex={-1}
        ref={ref}
        data-sheet={label}
        onKeyDown={(e) => e.key === 'Escape' && props.onClose()}
      >
        <header class="rl-sheet__head">
          <h3>Bets on {label}</h3>
          <button type="button" class="rl-btn" onClick={props.onClose}>
            Close
          </button>
        </header>
        <ul class="rl-rows">
          {items.map((id) => (
            <li key={id}>
              <button
                type="button"
                class="rl-row"
                data-bet-row={id}
                aria-pressed={props.value === id}
                onClick={() => props.onPick(id)}
              >
                <MiniDiagram id={id} wheel={wheel} />
                <span class="rl-row__text">
                  <strong>{betName(id, wheel)}</strong>
                  <code>{id}</code>
                </span>
                <span class="rl-row__pays">{paysText(id, wheel).replace('pays ', '')}</span>
              </button>
            </li>
          ))}
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

function CallsPanel({
  wheel,
  value,
  onPick,
}: {
  wheel: WheelKind;
  value?: string;
  onPick: (id: string) => void;
}) {
  const [p, setP] = useState('0');
  const [k, setK] = useState(2);
  const id = `neighbours:${p}:${k}`;
  return (
    <div class="rl-calls" role="tabpanel" aria-label="Call bets">
      <ul class="rl-rows">
        {CALLS.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              class="rl-row rl-row--call"
              data-bet={c.id}
              aria-pressed={value === c.id}
              onClick={() => onPick(c.id)}
            >
              <span class="rl-row__text">
                <strong>{betName(c.id, wheel)}</strong>
                <span class="rl-muted">
                  {c.pockets} pockets · <code>{c.id}</code>
                </span>
              </span>
            </button>
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
        <button
          type="button"
          class="rl-btn rl-btn--primary"
          data-bet={id}
          aria-pressed={value === id}
          onClick={() => onPick(id)}
        >
          Pick {betName(id, wheel)}
        </button>
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
    <div role="tabpanel" aria-label="Type a bet id">
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
  const pick = (id: string) => {
    setSheet(null);
    props.onPick(id);
  };
  const TAB_TEXT: Record<Tab, string> = { table: 'Table', calls: 'Call bets', type: 'Type an id' };
  return (
    <section class="rl-ui rl-picker" aria-label="Pick a bet" data-wheel={wheel}>
      <div class="rl-tabs" role="tablist" aria-label="How to pick">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            class="rl-tab"
            aria-selected={active === t}
            onClick={() => setTab(t)}
          >
            {TAB_TEXT[t]}
          </button>
        ))}
      </div>
      {active === 'table' && (
        <div role="tabpanel" aria-label="Table">
          <Board
            wheel={wheel}
            orientation={orientation}
            label="Roulette table: choose a bet"
            mode="pick"
            covered={covered}
            marked={shown}
            onCell={(l) => setSheet(l)}
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
              onClose={() => setSheet(null)}
            />
          )}
        </div>
      )}
      {active === 'calls' && <CallsPanel wheel={wheel} value={value} onPick={pick} />}
      {active === 'type' && <TypePanel wheel={wheel} onPick={pick} />}
    </section>
  );
}
