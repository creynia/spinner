// Play (`#/play`): hand-play a roulette session at a real table with a bankroll. Pick a chip, tap
// the board, spin. Rebet and double are one tap (R, D); "Rebet & spin" is one tap when the felt is
// empty. Saved chip layouts (Library → Layouts) go on the table from the Layouts sheet or
// `#/play?layout=<id>`. The session lives in localStorage (usePlaySession).
import type { BetId, Cents } from '@core/contracts/game';
import type { LayoutSpot } from '@core/contracts/layout';
import { formatMoney } from '@core/money';
import {
  addChipEach,
  betsTotal,
  checkBets,
  clearBets,
  doubleBets,
  equityOf,
  luckOf,
  placeSpots,
  rebet,
  undoBets,
  type PlayResult,
  type PlaySession,
} from '@core/play';
import {
  Button,
  Card,
  ChipRack,
  PlaceLayoutSheet,
  Segmented,
  Sheet,
  layoutMisfit,
  showToast,
} from '@core/ui';
import type { LayoutChoice } from '@core/ui';
import { rouletteUi } from '@game/roulette/ui';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { navigate } from '../../router';
import { layoutChoices, variantLabel } from '../../services/layouts';
import type { ScreenProps } from '../types';
import { isVariant, type RouletteEnv } from './env';
import { ResultPanel, pocketOf, resultText } from './ResultPanel';
import { SaveLayoutSheet } from './SaveLayoutSheet';
import { SessionSheet } from './SessionSheet';
import { StatsPanel } from './StatsPanel';
import { limitsLine } from './LimitsSection';
import { adjustBet, carriedBets, cashOf, netOf, onTableOf, spotsOfBets } from './store';
import { usePlaySession } from './usePlaySession';
import './play.css';

const chipsUi = rouletteUi.chips!;
const DENOMS = chipsUi.denominations;
const DENOM_KEY = 'spinner:play:denom';

function readDenom(): Cents {
  try {
    const v = Number(localStorage.getItem(DENOM_KEY));
    if (DENOMS.includes(v)) return v;
  } catch {
    /* not remembered */
  }
  return DENOMS[1] ?? DENOMS[0]!;
}
function writeDenom(v: Cents): void {
  try {
    localStorage.setItem(DENOM_KEY, String(v));
  } catch {
    /* not remembered */
  }
}

type SheetId = 'session' | 'layouts' | 'save' | 'menu' | null;

/** Keys typed into a field, or pressed while a sheet is open, are not shortcuts. */
function ignoreKey(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.altKey) return true;
  if (document.querySelector('.sheet')) return true;
  const t = e.target as HTMLElement | null;
  if (!t || !t.closest) return false;
  return !!t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

const INTERACTIVE = 'button, a[href], [role=button], [role=radio], [role=tab], [tabindex]';

const betLabel = (bet: string): string => bet.charAt(0).toUpperCase() + bet.slice(1);

export function Play({ query }: ScreenProps) {
  const ctl = usePlaySession();
  const s = ctl.session;
  const env = ctl.env;
  const rules = env.rules;
  const chipUnit = rules.limits.chipUnit;
  const [denom, setDenomState] = useState<Cents>(readDenom);
  const [tool, setTool] = useState<'add' | 'remove'>('add');
  const [last, setLast] = useState<BetId | null>(null);
  const [sheet, setSheet] = useState<SheetId>(null);
  const [status, setStatus] = useState('');
  const [statsOpen, setStatsOpen] = useState(false);
  const [layouts, setLayouts] = useState<LayoutChoice[]>([]);

  const setDenom = (v: Cents) => {
    setDenomState(v);
    writeDenom(v);
  };

  const spots = useMemo(() => spotsOfBets(s.bets, chipUnit), [s.bets, chipUnit]);
  const problems = useMemo(() => (s.endedAt ? [] : checkBets(env, s)), [env, s]);
  const flagged = useMemo(
    () => new Map(problems.filter((p) => p.bet).map((p) => [p.bet, p.message])),
    [problems],
  );
  const prison = carriedBets(s);
  const ended = !!s.endedAt;
  const equity = equityOf(s);
  // The smallest stake the table takes at all; below it (with nothing on the felt) play is stuck.
  const minStake = Math.min(rules.limits.outside.min, rules.limits.inside.minTotal);
  const busted = !ended && onTableOf(s) === 0 && cashOf(s) < minStake;
  const hasBets = s.bets.length > 0;
  const rebetSpin = !hasBets && s.lastBets.length > 0;
  const lastTotal = betsTotal(s.lastBets);

  const refuse = (message: string) => {
    setStatus(message);
    showToast(message, { tone: 'error' });
  };
  const act = (op: (env: RouletteEnv, s: PlaySession) => PlayResult, done?: string): boolean => {
    const r = ctl.apply(op);
    if (!r.ok) {
      refuse(r.message);
      return false;
    }
    if (done) setStatus(done);
    return true;
  };

  const onAdjust = (bet: BetId, delta: number) => {
    if (act((e, cur) => adjustBet(e, cur, bet, delta, denom))) setLast(bet);
  };

  const doRebet = () => act(rebet, `Rebet ${formatMoney(lastTotal)}`);
  const doDouble = () =>
    act(
      doubleBets,
      `Bets doubled to ${formatMoney(2 * betsTotal(ctl.current().bets.length ? ctl.current().bets : ctl.current().lastBets))}`,
    );
  const doAddEach = () => {
    const base = ctl.current().bets.length ? ctl.current().bets : ctl.current().lastBets;
    act(
      (e, cur) => addChipEach(e, cur, denom, (b) => chipsUi.step(b)),
      `Added a ${formatMoney(denom)} chip to ${base.length === 1 ? 'the bet' : `each of ${base.length} bets`}`,
    );
  };
  const doUndo = () => act((_, cur) => undoBets(cur), 'Undone');
  const doClear = () => act((_, cur) => clearBets(cur), 'Bets cleared');
  const doSpin = () => {
    const cur = ctl.current();
    if (cur.endedAt) return refuse('This session has ended');
    if (cur.bets.length === 0 && cur.lastBets.length > 0 && !act(rebet)) return;
    const r = ctl.spin();
    if (!r.ok) return refuse(r.message);
    const p = pocketOf(r.spin);
    setStatus(`${p.label} ${p.color}. ${resultText(r.spin)}.`);
  };

  const placeLayout = (sp: LayoutSpot[], chipValue: Cents, mode: 'add' | 'replace') => {
    const total = sp.reduce((t, x) => t + x.chips, 0) * chipValue;
    act(
      (e, cur) => placeSpots(e, cur, sp, chipValue, mode),
      `Placed ${formatMoney(total)} at ${formatMoney(chipValue)} a chip`,
    );
  };

  // Keyboard shortcuts; the handlers are read through a ref so the listener is added once.
  const keys = useRef({ doSpin, doRebet, doDouble, doAddEach, doUndo, doClear, setDenom });
  keys.current = { doSpin, doRebet, doDouble, doAddEach, doUndo, doClear, setDenom };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ignoreKey(e)) return;
      const k = keys.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod) {
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          k.doUndo();
        }
        return;
      }
      if (e.key === ' ') {
        // Space always spins, even with a board cell focused after a tap (otherwise it would
        // re-place chips there). Captured so the focused control never sees it; Enter still
        // activates the focused control for keyboard placement.
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) k.doSpin();
      } else if (e.key === 'Enter') {
        const t = e.target as HTMLElement | null;
        // A focused control does its own thing (the Spin button spins by itself).
        if (t && t !== document.body && t.closest?.(INTERACTIVE)) return;
        e.preventDefault();
        k.doSpin();
      } else if (key === 'r') k.doRebet();
      else if (key === 'd') k.doDouble();
      else if (key === 'a') k.doAddEach();
      else if (key === 'u') k.doUndo();
      else if (key === 'c') k.doClear();
      else if (/^[1-9]$/.test(e.key)) {
        const d = DENOMS[Number(e.key) - 1];
        if (d !== undefined) k.setDenom(d);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  // Layouts for the sheet. `#/play?layout=<id>` opens it with that layout selected.
  const linked = query.get('layout');
  const [initialId, setInitialId] = useState<string | undefined>(linked ?? undefined);
  useEffect(() => {
    if (linked) setSheet('layouts');
  }, [linked]);
  useEffect(() => {
    if (sheet !== 'layouts') return;
    let live = true;
    layoutChoices().then(
      (list) => live && setLayouts(list),
      () => live && refuse('Could not load the layouts'),
    );
    return () => {
      live = false;
    };
  }, [sheet]);
  const [noticeSeen, setNoticeSeen] = useState(false);
  const linkedChoice =
    initialId !== undefined ? layouts.find((c) => c.layout.id === initialId) : undefined;
  const linkedMisfit =
    linkedChoice && linkedChoice.layout.game === env.plugin.id
      ? layoutMisfit(env.plugin, rules, linkedChoice, DENOMS[0] ?? 100)
      : null;
  const wrongWheel =
    !noticeSeen && linkedChoice && linkedMisfit && isVariant(linkedChoice.layout.variant)
      ? linkedChoice.layout
      : null;
  const closeSheet = () => {
    setSheet(null);
    if (initialId !== undefined) {
      setInitialId(undefined);
      try {
        history.replaceState(history.state, '', '#/play');
      } catch {
        /* keep the address */
      }
    }
  };

  const net = netOf(s);
  const spinLabel = rebetSpin ? 'Rebet & spin' : 'Spin';
  const spinBlocked = ended
    ? 'Session ended'
    : busted && !hasBets
      ? equity > 0
        ? 'Not enough to bet'
        : 'Out of money'
      : (problems[0]?.message ?? null);

  return (
    <div class="play">
      <div class="play-top">
        <h1>Play</h1>
      </div>

      <dl class="play-head" aria-label="Session">
        <div>
          <dt>Bankroll</dt>
          <dd>{formatMoney(cashOf(s))}</dd>
        </div>
        <div>
          <dt>On table</dt>
          <dd>{formatMoney(onTableOf(s))}</dd>
        </div>
        <div>
          <dt>Net</dt>
          <dd class={net > 0 ? 'play-tone-good' : net < 0 ? 'play-tone-bad' : undefined}>
            {formatMoney(net, { sign: true })}
          </dd>
        </div>
        <div>
          <dt>Spins</dt>
          <dd>{s.stats.spins.toLocaleString('en-US')}</dd>
        </div>
      </dl>

      <div class="play-grid">
        <div class="play-main">
          <ResultPanel log={s.log} />
          <p class="visually-hidden" role="status" aria-live="polite">
            {status}
          </p>

          {ended ? (
            <Card title="Session ended" class="play-summary">
              <EndSummary session={s} />
              <div class="actions">
                <Button
                  variant="primary"
                  onClick={() =>
                    ctl.start({
                      variant: s.variant,
                      bankroll: s.startBankroll,
                      rng: { kind: 'crypto' },
                      ...(s.rulesOverrides ? { rulesOverrides: s.rulesOverrides } : {}),
                    })
                  }
                >
                  New session ({formatMoney(s.startBankroll)})
                </Button>
                <Button onClick={() => setSheet('session')}>Session options</Button>
              </div>
            </Card>
          ) : busted ? (
            <Card title={equity > 0 ? 'Not enough to bet' : 'Out of money'} class="play-summary">
              <p>
                {equity > 0
                  ? `${formatMoney(cashOf(s))} is below the table minimum of ${formatMoney(minStake)}. Rebuy to keep playing, or start over.`
                  : 'The bankroll is gone. Rebuy to keep playing, or start over.'}
              </p>
              <div class="actions">
                <Button variant="primary" onClick={() => ctl.topUp(s.startBankroll)}>
                  Rebuy {formatMoney(s.startBankroll)}
                </Button>
                <Button onClick={() => setSheet('session')}>New session</Button>
              </div>
            </Card>
          ) : null}

          <section class="card play-table" aria-label="Table">
            <p
              class={problems.length > 0 && !ended ? 'play-note play-problem' : 'play-note muted'}
              role={problems.length > 0 && !ended ? 'alert' : undefined}
              title={problems.length > 0 && !ended ? problems[0]!.message : undefined}
            >
              {problems.length > 0 && !ended
                ? `${problems[0]!.message}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ''}`
                : `${variantLabel(s.variant)} · ${limitsLine(rules)}`}
            </p>
            <div class="play-table-head">
              <Segmented
                label="Tap to"
                value={tool}
                options={[
                  { value: 'add', label: 'Add' },
                  { value: 'remove', label: 'Remove' },
                ]}
                onChange={setTool}
              />
              <div class="play-top-actions">
                <Button variant="ghost" onClick={() => setSheet('layouts')} disabled={ended}>
                  Layouts
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setSheet('menu')}
                  aria-label="More play actions"
                >
                  More
                </Button>
              </div>
            </div>
            <div class={ended ? 'play-board is-off' : 'play-board'} inert={ended}>
              <chipsUi.ChipBoard
                rules={rules}
                spots={spots}
                tool={tool}
                chipValue={chipUnit}
                onAdjust={onAdjust}
                last={last}
                flagged={flagged}
                maxChips={Infinity}
                tapValue={denom}
              />
            </div>
            {prison.length > 0 ? (
              <p class="play-prison">
                Imprisoned:{' '}
                {prison.map((b) => `${betLabel(b.bet)} ${formatMoney(b.amount)}`).join(', ')}
              </p>
            ) : null}
            <ChipRack denominations={DENOMS} value={denom} onChange={setDenom} label="Chip" />
          </section>

          <div class="play-bar" role="toolbar" aria-label="Bet actions">
            <div class="play-bar-row">
              <button
                type="button"
                class="btn play-act"
                onClick={doUndo}
                disabled={ended || s.undo.length === 0}
                aria-keyshortcuts="U Control+Z"
              >
                Undo
              </button>
              <button
                type="button"
                class="btn play-act"
                onClick={doClear}
                disabled={ended || !hasBets}
                aria-keyshortcuts="C"
              >
                Clear
              </button>
              <button
                type="button"
                class="btn play-act"
                onClick={doRebet}
                disabled={ended || s.lastBets.length === 0}
                aria-keyshortcuts="R"
                aria-label={
                  s.lastBets.length ? `Rebet ${formatMoney(lastTotal)}` : 'Rebet, no previous bets'
                }
              >
                Rebet
              </button>
              <button
                type="button"
                class="btn play-act"
                onClick={doDouble}
                disabled={ended || (!hasBets && s.lastBets.length === 0)}
                aria-keyshortcuts="D"
                aria-label="Double bets"
              >
                ×2
              </button>
              <button
                type="button"
                class="btn play-act"
                onClick={doAddEach}
                disabled={ended || (!hasBets && s.lastBets.length === 0)}
                aria-keyshortcuts="A"
                aria-label={`Add one ${formatMoney(denom)} chip to every bet`}
                title={`Add one ${formatMoney(denom)} chip to every bet`}
              >
                +1
              </button>
              <button
                type="button"
                class="btn btn-primary play-act play-spin"
                onClick={doSpin}
                disabled={spinBlocked !== null}
                aria-keyshortcuts="Space Enter"
                title={spinBlocked ?? undefined}
              >
                {spinLabel}
              </button>
            </div>
          </div>
        </div>

        <aside class="card play-side" aria-labelledby="play-stats-h">
          <div class="play-side-head">
            <h2 id="play-stats-h">Stats</h2>
            <button
              type="button"
              class="btn btn-ghost play-stats-toggle"
              aria-expanded={statsOpen}
              aria-controls="play-stats-body"
              onClick={() => setStatsOpen((o) => !o)}
            >
              {statsOpen ? 'Hide' : 'Show'}
            </button>
          </div>
          <div
            id="play-stats-body"
            class={statsOpen ? 'play-stats-body' : 'play-stats-body is-closed'}
          >
            <StatsPanel session={s} />
          </div>
        </aside>
      </div>

      <Sheet open={sheet === 'menu'} title="Play" onClose={closeSheet}>
        <div class="play-menu">
          <Button onClick={() => setSheet('session')}>Session: limits, top up, end, new</Button>
          <Button onClick={() => setSheet('save')} disabled={!hasBets}>
            Save bets as layout
          </Button>
          <Button onClick={() => setSheet('layouts')} disabled={ended}>
            Place a layout
          </Button>
          <p class="muted play-keys">
            Keys: Space spins (Enter too, off the board) · R rebet · D double · A add a chip to
            every bet · U or Ctrl+Z undo · C clear · 1–
            {DENOMS.length} chip
          </p>
        </div>
      </Sheet>
      {sheet === 'session' ? (
        <SessionSheet
          open
          onClose={closeSheet}
          session={s}
          history={ctl.history}
          onStart={ctl.start}
          onTopUp={ctl.topUp}
          onEnd={ctl.end}
          rules={rules}
          onSetRules={(ov) => {
            ctl.setRules(ov);
            setStatus('Table limits updated');
          }}
        />
      ) : null}
      <SaveLayoutSheet
        open={sheet === 'save'}
        onClose={closeSheet}
        bets={s.bets}
        variant={s.variant}
      />
      {sheet === 'layouts' && wrongWheel ? (
        <Sheet open title="Layout for another wheel" onClose={closeSheet}>
          <div class="play-menu">
            <p role="status">
              {wrongWheel.name} was drawn for the {variantLabel(wrongWheel.variant)} wheel; this
              session is {variantLabel(s.variant)}.
            </p>
            <Button
              variant="primary"
              onClick={() =>
                ctl.start({
                  variant: wrongWheel.variant,
                  bankroll: s.startBankroll,
                  rng: { kind: 'crypto' },
                })
              }
            >
              Start a {variantLabel(wrongWheel.variant)} session
            </Button>
            <Button onClick={() => setNoticeSeen(true)}>Choose another layout</Button>
          </div>
        </Sheet>
      ) : null}
      {sheet === 'layouts' && !wrongWheel ? (
        <PlaceLayoutSheet
          open
          onClose={closeSheet}
          layouts={layouts}
          ui={{ TableView: rouletteUi.TableView, chips: chipsUi }}
          plugin={env.plugin}
          rules={rules}
          bankroll={cashOf(s)}
          staked={betsTotal(s.bets)}
          initialId={initialId}
          initialMode={hasBets ? 'add' : 'replace'}
          onPlace={(sp, value, mode) => {
            placeLayout(sp, value, mode);
            closeSheet();
          }}
          onEdit={(c) => navigate(`/library?tab=layouts&edit=${encodeURIComponent(c.layout.id)}`)}
          onNew={() => navigate('/library?tab=layouts&edit=new')}
        />
      ) : null}
    </div>
  );
}

function EndSummary({ session: s }: { session: PlaySession }) {
  const net = netOf(s);
  const { luck } = luckOf(s.stats);
  return (
    <dl class="play-stat-grid">
      <div class="play-stat">
        <dt>Result</dt>
        <dd class={net > 0 ? 'play-tone-good' : net < 0 ? 'play-tone-bad' : undefined}>
          {formatMoney(net, { sign: true })}
        </dd>
      </div>
      <div class="play-stat">
        <dt>Spins</dt>
        <dd>{s.stats.spins}</dd>
      </div>
      <div class="play-stat">
        <dt>Wagered</dt>
        <dd>{formatMoney(s.stats.wagered)}</dd>
      </div>
      <div class="play-stat">
        <dt>Expected</dt>
        <dd>{formatMoney(-Math.round(s.stats.expectedLoss), { sign: true })}</dd>
      </div>
      <div class="play-stat">
        <dt>Luck</dt>
        <dd>{formatMoney(Math.round(luck), { sign: true })}</dd>
      </div>
      <div class="play-stat">
        <dt>Bought in</dt>
        <dd>{formatMoney(s.bankIn)}</dd>
      </div>
    </dl>
  );
}
