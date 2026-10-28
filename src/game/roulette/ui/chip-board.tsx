// ChipBoard: the roulette tap-to-place board for the layout editor (layouts.md §4.3-§4.6, §6.2).
// The Table tab is `Board` in place mode with point hit testing (`betAt` in Auto, `betNearest` under
// a bet-type lock); the Call bets tab (European) is `CallsPanel` with steppers; a long-press or
// Enter on a number opens the bet sheet with − n + steppers. `readOnly` draws thumbnails only.
import { MAX_CHIPS_PER_SPOT } from '@core/contracts/layout';
import type { ChipBoardProps } from '@core/ui';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { betDef } from '../bets';
import { pocketLabels } from '../pockets';
import type { RouletteRules } from '../types';
import { BetSheet, CallsPanel, type ChipSteps } from './bet-picker';
import { Board, type Chip } from './board';
import { stepOf } from './chips';
import {
  LOCK_FAMILIES,
  betAt,
  betNearest,
  type Board as GeoBoard,
  type LockFamily,
  type Point,
} from './geometry';
import { useOrientation } from './hooks';
import { betName } from './names';

type Lock = LockFamily | null;

const LOCK_KEY = 'spinner:chip-lock';
const LOCK_OPTIONS: { lock: Lock; text: string; name: string; mode: string }[] = [
  { lock: null, text: 'Auto', name: 'Auto', mode: 'Auto mode' },
  { lock: 'straight', text: '1', name: '1, straight', mode: 'Straight mode' },
  { lock: 'split', text: '2', name: '2, split', mode: 'Split mode' },
  { lock: 'street', text: '3', name: '3, street', mode: 'Street mode' },
  {
    lock: 'corner',
    text: '4',
    name: '4, corner (trio and basket nearest the zero)',
    mode: 'Corner mode',
  },
  { lock: 'line', text: '6', name: '6, six line', mode: 'Six line mode' },
];

function readLock(): Lock {
  try {
    const v = localStorage.getItem(LOCK_KEY);
    return (LOCK_FAMILIES as readonly string[]).includes(v ?? '') ? (v as LockFamily) : null;
  } catch {
    return null;
  }
}
function writeLock(lock: Lock): void {
  try {
    if (lock) localStorage.setItem(LOCK_KEY, lock);
    else localStorage.removeItem(LOCK_KEY);
  } catch {
    /* private mode or blocked storage: the lock is just not remembered */
  }
}

const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const plural = (n: number): string => `${n} ${n === 1 ? 'chip' : 'chips'}`;

/** Plain chips for every spot, plus dashed ghost chips for call bets on their component spots. */
function chipsFor(
  spots: ChipBoardProps<RouletteRules>['spots'],
  wheel: RouletteRules['wheel'],
  flagged: ChipBoardProps<RouletteRules>['flagged'],
): Chip[] {
  const out: Chip[] = [];
  const ghosts = new Map<string, { count: number; from: string[]; flagged: boolean }>();
  for (const s of spots) {
    const def = betDef(s.bet, wheel);
    if (!def) continue; // not on this wheel: no chip
    if (def.components) {
      for (const c of def.components) {
        const g = ghosts.get(c.spot) ?? { count: 0, from: [], flagged: false };
        g.count += (s.chips * c.weight) / def.pieces;
        if (!g.from.includes(s.bet)) g.from.push(s.bet);
        g.flagged ||= flagged?.has(s.bet) ?? false;
        ghosts.set(c.spot, g);
      }
      continue;
    }
    const flag = flagged?.get(s.bet);
    out.push({
      key: `b:${s.bet}`,
      spot: s.bet,
      cents: 0,
      pending: false,
      count: s.chips,
      flagged: flag !== undefined,
      label: `${betName(s.bet, wheel)}, ${plural(s.chips)}${flag ? `, problem: ${flag}` : ''}`,
    });
  }
  for (const [spot, g] of ghosts) {
    out.push({
      key: `g:${spot}`,
      spot,
      cents: 0,
      pending: false,
      ghost: true,
      count: g.count,
      flagged: g.flagged,
      label: `${betName(spot, wheel)}, ${plural(g.count)} from ${g.from.map((b) => betName(b, wheel)).join(' and ')}`,
    });
  }
  return out;
}

type Tab = 'table' | 'calls';
const TAB_TEXT: Record<Tab, string> = { table: 'Table', calls: 'Call bets' };
let boardCount = 0;

export function ChipBoard(props: ChipBoardProps<RouletteRules>) {
  const { rules, spots, readOnly = false } = props;
  const wheel = rules.wheel;
  const orientation = useOrientation();
  const chips = useMemo(() => chipsFor(spots, wheel, props.flagged), [spots, wheel, props.flagged]);

  if (readOnly) {
    return (
      <section class="rl-ui rl-chipboard rl-chipboard--thumb" data-wheel={wheel}>
        <Board
          wheel={wheel}
          orientation={orientation}
          label={`Roulette layout, ${spots.length} ${spots.length === 1 ? 'spot' : 'spots'}`}
          mode="view"
          chips={chips}
        />
      </section>
    );
  }
  return <Editable {...props} orientation={orientation} chips={chips} />;
}

function Editable(
  props: ChipBoardProps<RouletteRules> & {
    orientation: ReturnType<typeof useOrientation>;
    chips: Chip[];
  },
) {
  const { rules, spots, tool, orientation, chips } = props;
  const wheel = rules.wheel;
  const [tab, setTab] = useState<Tab>('table');
  const [lock, setLock] = useState<Lock>(readLock);
  const [sheet, setSheet] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ bet: string; n: number } | null>(null);
  const opener = useRef<Element | null>(null);
  const uid = useRef(++boardCount).current;
  const tabs: Tab[] = wheel === 'european' ? ['table', 'calls'] : ['table'];
  const active = tabs.includes(tab) ? tab : 'table';

  const counts = useMemo(() => new Map(spots.map((s) => [s.bet, s.chips])), [spots]);
  const chipsOn = (bet: string): number => counts.get(bet) ?? 0;

  // The pockets of the spot changed last flash for 300 ms (kept lit under reduced motion).
  const tapCount = useRef(0);
  const still = reducedMotion();
  const shown = hover ?? flash?.bet ?? (still ? (props.last ?? null) : null);
  useEffect(() => {
    if (!flash || still) return;
    const t = setTimeout(() => setFlash(null), 300);
    return () => clearTimeout(t);
  }, [flash, still]);
  const covered = useMemo(() => {
    const def = shown ? betDef(shown, wheel) : null;
    const labels = pocketLabels(wheel);
    return new Set(def ? def.pockets.map((p) => labels[p]!) : []);
  }, [shown, wheel]);

  const say = (message: string) => props.onStatus?.(message);
  const describe = (bet: string, n: number): string => {
    const step = stepOf(bet);
    const name = betName(bet, wheel);
    return step > 1 && n > 0 ? `${name} ×${n / step} · ${plural(n)}` : `${name} · ${plural(n)}`;
  };
  /** Change a spot by ± one step of its bet and announce the result. */
  const change = (bet: string, sign: 1 | -1, delta = sign * stepOf(bet)): void => {
    const now = chipsOn(bet);
    if (delta < 0 && now === 0) {
      say(`No chips on ${betName(bet, wheel)}`);
      return;
    }
    if (delta > 0 && now + delta > MAX_CHIPS_PER_SPOT) {
      say(`At most ${MAX_CHIPS_PER_SPOT} chips on ${betName(bet, wheel)}`);
      return;
    }
    props.onAdjust(bet, delta);
    setFlash({ bet, n: ++tapCount.current });
    say(describe(bet, Math.max(0, now + delta)));
  };
  const apply = (bet: string): void => change(bet, tool === 'remove' ? -1 : 1);

  const hit = (b: GeoBoard, p: Point): string | null =>
    lock ? betNearest(b, p, lock) : betAt(b, p);

  const steps: ChipSteps = {
    chips: chipsOn,
    onAdjust: (bet, delta) => change(bet, delta < 0 ? -1 : 1, delta),
  };
  const placedNeighbours = spots.map((s) => s.bet).filter((b) => b.startsWith('neighbours:'));

  const chooseLock = (next: Lock) => {
    setLock(next);
    writeLock(next);
    say(LOCK_OPTIONS.find((o) => o.lock === next)!.mode);
  };
  const onLockKey = (e: KeyboardEvent, i: number) => {
    const n = LOCK_OPTIONS.length;
    const to =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? (i + 1) % n
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? (i + n - 1) % n
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    chooseLock(LOCK_OPTIONS[to]!.lock);
    document.getElementById(`rl-lock-${uid}-${to}`)?.focus();
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
    document.getElementById(`rl-ctab-${uid}-${tabs[to]}`)?.focus();
  };
  const closeSheet = () => {
    if (sheet === null) return;
    setSheet(null);
    const el = opener.current;
    if (el instanceof HTMLElement || el instanceof SVGElement) setTimeout(() => el.focus(), 0);
  };
  const openSheet = (label: string, el: Element) => {
    opener.current = el;
    setSheet(label);
  };

  return (
    <section class="rl-ui rl-chipboard" aria-label="Roulette chip board" data-wheel={wheel}>
      {tabs.length > 1 && (
        <div class="rl-tabs" role="tablist" aria-label="Board panels">
          {tabs.map((t, i) => (
            <button
              key={t}
              id={`rl-ctab-${uid}-${t}`}
              type="button"
              role="tab"
              class="rl-tab"
              aria-selected={active === t}
              aria-controls={`rl-cpanel-${uid}`}
              tabIndex={active === t ? 0 : -1}
              onKeyDown={(e) => onTabKey(e, i)}
              onClick={() => setTab(t)}
            >
              {TAB_TEXT[t]}
            </button>
          ))}
        </div>
      )}
      <div role="tabpanel" id={`rl-cpanel-${uid}`} aria-labelledby={`rl-ctab-${uid}-${active}`}>
        {active === 'table' && (
          <>
            <Board
              wheel={wheel}
              orientation={orientation}
              label="Roulette table: place chips"
              mode="place"
              tool={tool}
              covered={covered}
              chips={chips}
              counts={counts}
              hit={hit}
              onTap={apply}
              onOutside={apply}
              onRemove={(bet) => change(bet, -1)}
              onCell={openSheet}
              onLongPress={openSheet}
              onHover={setHover}
            />
            <div class="rl-lock">
              <span id={`rl-lock-label-${uid}`} class="rl-lock__label">
                Bet<span class="rl-sr"> type</span>
              </span>
              <div class="rl-lock__row" role="radiogroup" aria-labelledby={`rl-lock-label-${uid}`}>
                {LOCK_OPTIONS.map((o, i) => (
                  <button
                    key={o.text}
                    id={`rl-lock-${uid}-${i}`}
                    type="button"
                    role="radio"
                    class="rl-lock__opt"
                    aria-checked={lock === o.lock}
                    aria-label={o.name}
                    tabIndex={lock === o.lock ? 0 : -1}
                    onKeyDown={(e) => onLockKey(e, i)}
                    onClick={() => chooseLock(o.lock)}
                  >
                    {o.text}
                  </button>
                ))}
              </div>
            </div>
            {sheet !== null && (
              <BetSheet label={sheet} wheel={wheel} steps={steps} onClose={closeSheet} />
            )}
          </>
        )}
        {active === 'calls' && <CallsPanel wheel={wheel} steps={steps} placed={placedNeighbours} />}
      </div>
    </section>
  );
}
