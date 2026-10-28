// "Chips on the table": the stage card's primary panel (layouts.md §4.7, §7.2). It shows the stage's
// `x-chips` block (thumbnail, chip value, cost, table check), opens the tap-to-place editor in a
// sheet, and edits the block through the model helpers; `toJson` regenerates the bet rows.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Cents } from '../../contracts/game';
import {
  type ChipLayout,
  type ChipValue,
  type LayoutSpot,
  type StageChips,
} from '../../contracts/layout';
import type { Diagnostic, ProgressionSpec } from '../../contracts/strategy';
import { adjustSpot, sameSpots } from '../../strategy';
import { Button, Sheet } from '../kit';
import { betLabel as catalogLabel, money, plural, totalChips } from '../layout/adjust';
import { ChipRack } from '../layout/ChipRack';
import { defaultDenom } from '../layout/denoms';
import { LayoutEditor } from '../layout/LayoutEditor';
import { LayoutThumb } from '../layout/LayoutThumb';
import type { LayoutChoice } from '../layout/types';
import { checkStageChips } from './chipsCheck';
import { ProgressionEditor } from './editors';
import { money as bmoney, type BuilderEnv } from './env';
import { NumField, SelectField, TextField } from './fields';
import { LayoutPickSheet } from './LayoutPickSheet';
import {
  forgetChips,
  freshSlug,
  generatedCount,
  liftCard,
  liftableChips,
  liftsAll,
  rebuildStale,
  setCardChips,
  withSpots,
  type BuilderModel,
  type StageCard,
} from './model';

/** Largest amount in cents anywhere (as the validator's limit). */
const MAX_CENTS = 2 ** 31 - 1;

/** What "Tap chips" lifted, so cancelling the editor can put the stage back exactly as it was. */
interface Lifted {
  layout: StageCard['layout'];
  has: StageCard['has'];
}

type Sh =
  | { t: 'edit'; spots: LayoutSpot[]; lifted?: Lifted }
  | { t: 'pick' }
  | { t: 'saveas' }
  | { t: 'custom' };
type Sub = { t: 'prog' } | null;

export interface ChipsPanelProps {
  /** An env with `chips` present. */
  env: BuilderEnv;
  /** Stage index. */
  si: number;
  model: BuilderModel;
  card: StageCard;
  diagnostics: readonly Diagnostic[];
  /** The library and built-in layouts; null while loading or unreadable. */
  choices: readonly LayoutChoice[] | null;
  /** `<stage id>|<hash>` pairs whose "changed" banner was dismissed this session. */
  dismissed: ReadonlySet<string>;
  /** Edits the model and writes it out. */
  apply: (fn: (card: StageCard, m: BuilderModel) => void) => void;
  onDismiss: (key: string) => void;
  /** Re-read the library after the panel saved to it. */
  reload: () => void;
}

/** Spots and rows a stage inherits through `extends` (parent chain, strategy.md §3.6). */
export function inheritedOf(
  model: BuilderModel,
  card: StageCard,
): { from: string; spots: number; rows: number } | null {
  if (card.extends === undefined) return null;
  let spots = 0;
  let rows = 0;
  const seen = new Set<string>([card.id]);
  let next: string | undefined = card.extends;
  while (next !== undefined && !seen.has(next)) {
    seen.add(next);
    const s: StageCard | undefined = model.stages.find((x) => x.id === next);
    if (!s) break;
    rows += s.layout.length + generatedCount(s);
    spots += generatedCount(s);
    next = s.extends;
  }
  return rows === 0 ? null : { from: card.extends, spots, rows };
}

function InheritedLine(p: { inherited: ReturnType<typeof inheritedOf> }) {
  const i = p.inherited;
  if (!i) return null;
  const others = i.rows - i.spots;
  return (
    <p class="muted">
      Inherited from <strong>{i.from}</strong>: {plural(i.spots, 'spot')}
      {others > 0 ? ` and ${plural(others, 'other bet')}` : ''}.
    </p>
  );
}

function Warnings({ diags }: { diags: readonly Diagnostic[] }) {
  if (diags.length === 0) return null;
  return (
    <ul class="b-errs">
      {diags.map((d, i) => (
        <li key={i} class={d.severity === 'error' ? 'b-err' : 'b-warn'}>
          <span class="b-sev">{d.severity === 'error' ? 'Error' : 'Warning'}</span> {d.message}{' '}
          <code class="b-code">{d.code}</code>
        </li>
      ))}
    </ul>
  );
}

export function ChipsPanel(p: ChipsPanelProps) {
  const { env, si, card, model } = p;
  const ce = env.chips!;
  const ui = ce.ui.chips;
  const chips = card.chips;
  const stale = !!chips && card.chipsStale;
  const [sheet, setSheet] = useState<Sh | null>(null);
  const [sub, setSub] = useState<Sub>(null);
  const [msg, setMsg] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const editing = sheet?.t === 'edit';
  /** Presses the editor's own Back (its unsaved-changes guard decides); set while the sheet is open. */
  const pressBack = useRef<() => void>(() => {});
  // Android Back while the editor is open: the screen remounts on every hashchange, which would
  // lose unsaved edits. A sentinel history entry with the same hash absorbs the first Back; the
  // editor's guard then asks, and the sentinel is re-pushed so a dirty editor survives it.
  useEffect(() => {
    if (!editing) return;
    let sentinel = true;
    history.pushState(history.state, '', location.href);
    const onPop = () => {
      sentinel = false;
      history.pushState(history.state, '', location.href);
      sentinel = true;
      pressBack.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (sentinel) history.back();
    };
  }, [editing]);
  const progs: Record<string, ProgressionSpec> = Object.fromEntries(
    (model.progressions ?? []).map((x) => [x.name, x.spec]),
  );
  const progNames = Object.keys(progs);
  const unit = model.head.unit;
  const variant = env.chipsVariant;
  const inherited = inheritedOf(model, card);
  const reserved = card.layout.length + (inherited?.rows ?? 0);
  const label = (bet: string) => catalogLabel(env.catalog, bet);

  const check = chips
    ? checkStageChips({
        plugin: ce.plugin,
        rules: env.rules,
        chips,
        stage: si,
        unit,
        progressions: progs,
        bankroll: ce.bankroll,
        step: (b) => ui.step(b),
        catalog: env.catalog,
      })
    : null;
  const previewValue: Cents | null = check?.value.base ?? null;

  // ---- where the block came from
  const from = chips?.from;
  const choice = from && p.choices ? p.choices.find((c) => c.layout.id === from.id) : undefined;
  const deleted = !!from && !!p.choices && !choice;
  const dismissKey = choice ? `${card.id}|${choice.hash}` : '';
  const changed = !!choice && !!from && choice.hash !== from.hash && !p.dismissed.has(dismissKey);
  const edited = !!choice && !!chips && !changed && !sameSpots(chips.spots, choice.layout.spots);
  const title = from
    ? `${from.name}${deleted ? ' (deleted)' : edited ? ' (edited)' : ''}`
    : 'Chips placed on the table';

  const fromOf = (c: LayoutChoice): NonNullable<StageChips['from']> => ({
    id: c.layout.id,
    hash: c.hash,
    name: c.layout.name,
    ...(c.builtin ? { builtin: true as const } : {}),
  });
  const newChip = (spots: readonly LayoutSpot[]): Cents =>
    defaultDenom(ce.plugin, env.rules, spots, ui.denominations).denom;

  // ---- chip value
  const chip = chips?.chip;
  const follows = chip !== undefined && typeof chip === 'object' && 'prog' in chip ? chip.prog : '';
  const setChip = (c: ChipValue) => {
    if (!chips) return;
    if (typeof c === 'number' && chips.spots.some((s) => s.chips * c > MAX_CENTS)) {
      setMsg('That chip value is too large for this layout.');
      return;
    }
    setMsg('');
    p.apply((cd) => {
      if (cd.chips) cd.chips = { ...cd.chips, chip: c };
    });
  };
  const startingChip: Cents =
    check?.value.base ?? ui.denominations[1] ?? ui.denominations[0] ?? 500;

  // ---- actions
  const tap = () => {
    if (chips) return setSheet({ t: 'edit', spots: chips.spots.map((s) => ({ ...s })) });
    const lifted = liftableChips(card);
    // The rows lift with no change to `layout` (§5.1): the editor then opens on those spots.
    // Cancelling the editor undoes the lift (`cancelEdit`), so `definitionId` is unchanged.
    if (lifted) {
      const before: Lifted = { layout: structuredClone(card.layout), has: { ...card.has } };
      p.apply((cd) => void liftCard(cd));
      setSheet({ t: 'edit', spots: lifted.spots, lifted: before });
    } else setSheet({ t: 'edit', spots: [] });
  };
  /** The editor was closed without saving: a lift made only to open it is undone. */
  const cancelEdit = (lifted: Lifted | undefined) => {
    if (lifted)
      p.apply((cd) => {
        cd.layout = structuredClone(lifted.layout);
        cd.has = { ...lifted.has };
        cd.chips = null;
        cd.chipsStale = false;
      });
    setSheet(null);
  };
  const saveEdit = (spots: LayoutSpot[]) => {
    p.apply((cd) => {
      if (cd.chips && !cd.chipsStale) cd.chips = withSpots(cd.chips, spots);
      else setCardChips(cd, { v: 1, chip: newChip(spots), spots });
    });
    setSheet(null);
  };
  const pick = (c: LayoutChoice) => {
    const spots = c.layout.spots.map((s) => ({ ...s }));
    p.apply((cd) => {
      if (cd.chips && !cd.chipsStale) cd.chips = { ...cd.chips, spots, from: fromOf(c) };
      else setCardChips(cd, { v: 1, chip: newChip(spots), spots, from: fromOf(c) });
    });
    setSheet(null);
  };
  const update = () => {
    if (!choice) return;
    const spots = choice.layout.spots.map((s) => ({ ...s }));
    p.apply((cd) => {
      if (cd.chips) cd.chips = { ...cd.chips, spots, from: fromOf(choice) };
    });
  };
  const publish = async (layout: ChipLayout) => {
    setBusy(true);
    setMsg('');
    try {
      const rec = await ce.layouts.save(layout);
      p.apply((cd) => {
        if (cd.chips)
          cd.chips = {
            ...cd.chips,
            from: { id: rec.id, hash: rec.hash, name: rec.layout.name },
          };
      });
      p.reload();
      setSheet(null);
    } catch (e) {
      setMsg(`Could not save the layout${e instanceof Error ? `: ${e.message}` : '.'}`);
    } finally {
      setBusy(false);
    }
  };
  const saveAs = (nm: string) => {
    if (!chips) return;
    const taken = (p.choices ?? []).map((c) => c.layout.id);
    const trimmed = nm.trim();
    void publish({
      schema: 1,
      id: freshSlug(trimmed.toLowerCase(), taken),
      name: trimmed,
      game: ce.plugin.id,
      variant: variant ?? 'default',
      spots: chips.spots.map((s) => ({ ...s })),
    });
  };
  const updateLayout = () => {
    if (!chips || !choice) return;
    void publish({ ...choice.layout, spots: chips.spots.map((s) => ({ ...s })) });
  };
  const nudge = (bet: string, dir: 1 | -1) => {
    if (!chips) return;
    const r = adjustSpot(chips.spots, bet, dir * ui.step(bet));
    if (r.refused || r.spots.length === 0) return;
    p.apply((cd) => {
      if (cd.chips) cd.chips = withSpots(cd.chips, r.spots);
    });
  };

  // ---- the three states
  const heading = (
    <h5 class="bsec" id={`b-chips-h-${si}`}>
      Chips on the table
    </h5>
  );
  const shapeDiags = p.diagnostics.filter(
    (d) => d.path.startsWith(`/stages/${si}/x-chips`) && d.code !== 'W_CHIPS_STALE',
  );

  let body;
  if (stale && chips) {
    body = (
      <div class="bchips-banner" role="status">
        <p>
          These chips no longer match this stage&apos;s bets (edited as JSON). The bets below are
          what runs.
        </p>
        <div class="brow">
          <Button
            onClick={() => p.apply((cd) => rebuildStale(cd))}
            aria-label="Rebuild bets from chips"
          >
            Rebuild bets from chips
          </Button>
          <Button onClick={() => p.apply((cd) => forgetChips(cd, true))}>Forget chips</Button>
        </div>
      </div>
    );
  } else if (chips && check) {
    const value = check.value;
    body = (
      <>
        <div class="bchips-main">
          <div class="bchips-thumb">
            <LayoutThumb
              ui={ce.ui}
              rules={env.rules}
              spots={chips.spots}
              chipValue={previewValue}
            />
          </div>
          <div class="bchips-info">
            <p class="bchips-title">
              <strong>{title}</strong>
              <span class="muted">
                {' '}
                · {plural(chips.spots.length, 'spot')} · {plural(totalChips(chips.spots), 'chip')}
              </span>
            </p>
            <ChipRack
              denominations={ui.denominations}
              value={typeof chip === 'number' ? chip : null}
              onChange={setChip}
              label="Chip value"
            />
            <div class="brow">
              <button type="button" class="b-add" onClick={() => setSheet({ t: 'custom' })}>
                More chip values
              </button>
              <span class="muted" data-testid="chip-value-text">
                {typeof chip === 'number'
                  ? `Chips are ${money(chip)}`
                  : chip && 'units' in chip
                    ? `Chips are the strategy unit (${money(unit)})`
                    : value.base === null
                      ? `Chips follow ${follows}, which starts at a formula`
                      : `Chips follow ${follows}, starting at ${money(value.base)}`}
              </span>
            </div>
            <SelectField
              label="Follows progression"
              value={follows}
              options={[
                { value: '', label: 'No, a fixed chip' },
                ...progNames.map((n) => ({ value: n, label: n })),
                { value: '__new', label: 'New progression…' },
              ]}
              onChange={(v) => {
                if (v === '__new') setSub({ t: 'prog' });
                else if (v === '') setChip(check.value.base ?? startingChip);
                else setChip({ prog: v });
              }}
            />
            <p class="bchips-cost" aria-live="polite">
              {value.base === null
                ? "Can't preview: the base is a formula."
                : `${follows ? 'From ' : ''}${money(check.perRound ?? 0)} a ${env.roundWord}`}
              {value.base !== null
                ? check.fits
                  ? ' · ✓ fits this table'
                  : ' · ! see below'
                : null}
            </p>
          </div>
        </div>
        {changed && choice && from ? (
          <div class="bchips-banner" role="status">
            <p>
              Layout <strong>{choice.layout.name}</strong> changed since this stage used it.
            </p>
            <div class="brow">
              <Button onClick={update}>Update</Button>
              <Button onClick={() => p.onDismiss(dismissKey)}>Keep</Button>
            </div>
          </div>
        ) : null}
        <Warnings diags={[...check.diagnostics, ...shapeDiags]} />
        {check.notes.length > 0 ? (
          <ul class="b-errs">
            {check.notes.map((n, i) => (
              <li key={i} class="b-warn">
                {n}
              </li>
            ))}
          </ul>
        ) : null}
        <InheritedLine inherited={inherited} />
        <div class="brow">
          <Button variant="primary" onClick={tap}>
            Edit chips
          </Button>
          <Button onClick={() => setSheet({ t: 'pick' })}>Use a saved layout</Button>
          <Button onClick={() => (setName(''), setSheet({ t: 'saveas' }))} disabled={busy}>
            {from && edited ? 'Save as new layout' : 'Save as layout'}
          </Button>
          {edited && choice && !choice.builtin ? (
            <Button onClick={updateLayout} disabled={busy}>
              Update layout {choice.layout.name}
            </Button>
          ) : null}
        </div>
        <details class="bchips-spots" open={shapeDiags.length > 0 ? true : undefined}>
          <summary>Spots ({chips.spots.length})</summary>
          <ul class="blist" aria-label={`Stage ${si + 1} chip spots`}>
            {chips.spots.map((s, i) => {
              const st = ui.step(s.bet);
              return (
                <li key={s.bet} id={`b-lay-${si}-${i}`} class="bchips-spot">
                  <span>
                    {label(s.bet)} · {plural(s.chips, 'chip')}
                    {value.base !== null ? ` (${money(s.chips * value.base)})` : ''}
                  </span>
                  <span class="b-tools">
                    <button
                      type="button"
                      class="b-icon"
                      aria-label={`Remove ${plural(st, 'chip')} from ${label(s.bet)}`}
                      disabled={chips.spots.length === 1 && s.chips <= st}
                      onClick={() => nudge(s.bet, -1)}
                    >
                      <span aria-hidden="true">−</span>
                    </button>
                    <button
                      type="button"
                      class="b-icon"
                      aria-label={`Add ${plural(st, 'chip')} to ${label(s.bet)}`}
                      onClick={() => nudge(s.bet, 1)}
                    >
                      <span aria-hidden="true">+</span>
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
        <details class="bchips-more">
          <summary>More chip actions</summary>
          <div class="brow">
            <Button onClick={() => p.apply((cd) => forgetChips(cd, true))}>
              Turn into plain bets
            </Button>
            <Button variant="danger" onClick={() => p.apply((cd) => forgetChips(cd, false))}>
              Remove chips
            </Button>
          </div>
        </details>
      </>
    );
  } else {
    const all = liftsAll(card) && card.layout.length >= 2;
    body = (
      <>
        <p class="muted">
          {card.layout.length === 0 && !inherited
            ? 'No chips yet. Tap the table to place them; they become this stage’s bets.'
            : 'Place these bets by tapping chips on the table instead of listing them.'}
        </p>
        <InheritedLine inherited={inherited} />
        <div class="brow">
          <Button variant="primary" onClick={tap}>
            {all ? 'Edit on the table' : 'Tap chips'}
          </Button>
          <Button onClick={() => setSheet({ t: 'pick' })}>Use a saved layout</Button>
        </div>
        <Warnings diags={shapeDiags} />
      </>
    );
  }

  // ---- sheets
  let sheetEl = null;
  if (sheet?.t === 'edit') {
    // The sheet's own Close, Escape and backdrop go through the editor's unsaved-changes guard.
    // `LayoutEditor` exposes no imperative close, so the guard presses its own Back button,
    // found inside this panel's editor wrapper (a ref, never a document-wide lookup).
    const guarded = () => {
      const back = editorRef.current?.querySelector<HTMLButtonElement>(
        '.le-head button[aria-label="Back"]',
      );
      if (back) back.click();
      else cancelEdit(sheet.lifted);
    };
    pressBack.current = guarded;
    sheetEl = (
      <Sheet open title="Chips on the table" onClose={guarded}>
        <div class="b-chips-editor" ref={editorRef}>
          <LayoutEditor
            plugin={ce.plugin}
            rules={env.rules}
            ui={ce.ui}
            initialSpots={sheet.spots}
            name={from?.name ?? `Stage ${si + 1} chips`}
            variant={variant ?? 'default'}
            chipValue={previewValue}
            bankroll={ce.bankroll}
            reservedSpots={reserved}
            onSave={(r) => saveEdit(r.spots)}
            onClose={() => cancelEdit(sheet.lifted)}
          />
        </div>
      </Sheet>
    );
  } else if (sheet?.t === 'pick') {
    sheetEl = (
      <LayoutPickSheet
        env={ce}
        rules={env.rules}
        choices={p.choices}
        {...(variant !== undefined ? { variant } : {})}
        chipValue={previewValue}
        onPick={pick}
        onClose={() => setSheet(null)}
      />
    );
  } else if (sheet?.t === 'saveas') {
    const ok = name.trim().length >= 1 && name.trim().length <= 80;
    sheetEl = (
      <Sheet open title="Save as layout" onClose={() => setSheet(null)}>
        <div class="ed">
          <TextField
            label="Layout name"
            value={name}
            onInput={setName}
            hint="Saved to your library; stages that used it keep their own copy."
            error={name !== '' && !ok ? 'Give it a name of 1 to 80 characters.' : null}
          />
          <div class="ed-actions">
            <Button variant="primary" disabled={!ok || busy} onClick={() => saveAs(name)}>
              Save layout
            </Button>
            <Button onClick={() => setSheet(null)}>Cancel</Button>
          </div>
        </div>
      </Sheet>
    );
  } else if (sheet?.t === 'custom') {
    sheetEl = (
      <CustomChip
        unit={unit}
        current={typeof chip === 'number' ? chip : startingChip}
        onUnit={() => (setChip({ units: 1 }), setSheet(null))}
        onAmount={(c) => (setChip(c), setSheet(null))}
        onClose={() => setSheet(null)}
      />
    );
  }
  if (sub?.t === 'prog') {
    const taken = progNames;
    sheetEl = (
      <ProgressionEditor
        env={env}
        name={freshSlug('prog', taken)}
        spec={
          {
            kind: 'martingale',
            track: 'round',
            base: startingChip,
            maxSteps: 6,
            onCap: 'reset',
          } as unknown as ProgressionSpec
        }
        existing={taken}
        keepBase
        onClose={() => setSub(null)}
        onSave={(nm, spec) => {
          p.apply((cd, m) => {
            m.progressions ??= [];
            m.progressions.push({ name: nm, spec });
            if (cd.chips) cd.chips = { ...cd.chips, chip: { prog: nm } };
          });
          setSub(null);
        }}
      />
    );
  }

  return (
    <div class="bchips" id={`b-chips-${si}`}>
      {heading}
      {body}
      {msg ? (
        <p class="error" role="alert">
          {msg}
        </p>
      ) : null}
      {sheetEl}
    </div>
  );
}

function CustomChip(p: {
  unit: Cents;
  current: Cents;
  onUnit: () => void;
  onAmount: (c: Cents) => void;
  onClose: () => void;
}) {
  const [cents, setCents] = useState(p.current);
  return (
    <Sheet open title="Chip value" onClose={p.onClose}>
      <div class="ed">
        <NumField label="Custom amount (dollars)" money min={1} value={cents} onChange={setCents} />
        <div class="ed-actions">
          <Button variant="primary" disabled={cents < 1} onClick={() => p.onAmount(cents)}>
            Use this amount
          </Button>
          <Button onClick={p.onUnit}>Strategy unit ({bmoney(p.unit)})</Button>
          <Button onClick={p.onClose}>Cancel</Button>
        </div>
      </div>
    </Sheet>
  );
}
