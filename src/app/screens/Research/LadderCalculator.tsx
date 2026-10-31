// Chapter 9, "Build your own ladder": inputs, outputs and a live summary for the cycle model of
// the Levels and Curve chapters (calculator.ts). Predictions, not a simulation; European wheel only.
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatMoney } from '@core';
import { Chip, Field, Stat, moneyText, parseMoney } from '@core/ui';
import {
  CALC_DEFAULTS,
  CALC_PRESETS,
  LIMITS,
  calculate,
  validate,
  type CalcField,
  type CalcInput,
  type CalcResult,
} from './calculator';
import { money, pct1 } from './kit';
import './chapters-7-9.css';

// ---------------------------------------------------------------- fields

interface FieldProps {
  id: string;
  value: number;
  onChange: (v: number) => void;
  /** Reports whether the typed text is a usable value. */
  onValid: (ok: boolean) => void;
  describedBy?: string;
  /** Cross-field message from the committed input, shown while the text itself parses. */
  error?: string;
}

/** A whole-number field. The text can be wrong while the committed value stays the last good one. */
function IntField({
  id,
  value,
  min,
  max,
  message,
  error,
  onChange,
  onValid,
  describedBy,
}: FieldProps & { min: number; max: number; message: string }) {
  const [text, setText] = useState(String(value));
  const [bad, setBad] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Follow outside changes (a preset), but never rewrite what the person is typing.
    if (document.activeElement !== ref.current && Number(text) !== value) {
      setText(String(value));
      setBad(false);
      onValid(true);
    }
  }, [value]);
  const shown = bad ? message : error;
  return (
    <>
      <input
        ref={ref}
        class="input"
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        aria-invalid={shown ? 'true' : undefined}
        aria-describedby={
          [describedBy, shown ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined
        }
        onInput={(e) => {
          const t = e.currentTarget.value;
          setText(t);
          const n = t.trim() === '' ? NaN : Number(t);
          const ok = Number.isInteger(n) && n >= min && n <= max;
          setBad(!ok);
          onValid(ok);
          if (ok) onChange(n);
        }}
        onBlur={() => {
          if (bad) {
            setText(String(value));
            setBad(false);
            onValid(true);
          }
        }}
      />
      {shown ? (
        <p class="error" id={`${id}-err`} role="alert">
          {shown}
        </p>
      ) : null}
    </>
  );
}

/** A dollar amount in whole cents (the look of MoneyInput, but it reports bad text to the calculator). */
function AmountField({ id, value, error, onChange, onValid, describedBy }: FieldProps) {
  const [text, setText] = useState(moneyText(value));
  const [bad, setBad] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement !== ref.current && parseMoney(text) !== value) {
      setText(moneyText(value));
      setBad(null);
      onValid(true);
    }
  }, [value]);
  const shown = bad ?? error;
  return (
    <div class="money">
      <div class="money-box">
        <span class="money-sign" aria-hidden="true">
          $
        </span>
        <input
          ref={ref}
          class="input money-input"
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          aria-invalid={shown ? 'true' : undefined}
          aria-describedby={
            [describedBy, shown ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined
          }
          onInput={(e) => {
            const t = e.currentTarget.value;
            setText(t);
            const c = parseMoney(t);
            if (c === null) {
              setBad('Enter an amount in dollars, like 25 or 1,250.50.');
              onValid(false);
            } else if (c < 1) {
              setBad('The minimum is 0.01 dollars.');
              onValid(false);
            } else {
              setBad(null);
              onValid(true);
              onChange(c);
            }
          }}
          onBlur={() => {
            if (bad) {
              setText(moneyText(value));
              setBad(null);
              onValid(true);
            }
          }}
        />
      </div>
      {shown ? (
        <p class="error" id={`${id}-err`} role="alert">
          {shown}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- outputs

const WHOLE = new Intl.NumberFormat('en-US');

/** "1,117", or "more than 1,000,000" for horizons far beyond any session. */
function horizon(n: number): string {
  return !Number.isFinite(n) || n > 1_000_000 ? 'more than 1,000,000' : WHOLE.format(Math.round(n));
}

/** "about spin 1,117", or "past spin 1,000,000" for horizons far beyond any session. */
function horizonPhrase(n: number): string {
  return !Number.isFinite(n) || n > 1_000_000 ? 'past spin 1,000,000' : `about spin ${horizon(n)}`;
}

/** "$5, $10, $20 … $2,560": the first three bets and the last. */
export function amountsHint(amounts: number[]): string {
  const show = (a: number): string => formatMoney(a);
  if (amounts.length <= 4) return amounts.map(show).join(', ');
  return `${amounts.slice(0, 3).map(show).join(', ')} … ${show(amounts[amounts.length - 1]!)}`;
}

/** "0.13% (1 in 784)". */
export function runOutText(q: number): string {
  const odds = 1 / q;
  const one =
    !Number.isFinite(odds) || odds >= 1e9
      ? 'more than 1 in a billion'
      : `1 in ${WHOLE.format(Math.round(odds))}`;
  return `${(q * 100).toFixed(q < 0.0001 ? 4 : 2)}% (${one})`;
}

/** The sentence the live region announces. */
export function summarySentence(r: CalcResult): string {
  const l = r.ladder;
  return `${l.L} levels; typical session ahead until ${horizonPhrase(l.nHalf)}; chance of ending ahead ${pct1(r.pWin)}`;
}

function Outputs({ r, input, stale }: { r: CalcResult; input: CalcInput; stale: boolean }) {
  const l = r.ladder;
  if (l.L === 0) {
    return <p class="error">The first bet does not fit: raise the bankroll or the bet maximum.</p>;
  }
  const beyond = l.nHalf > input.spins;
  const cashing = input.w > 0;
  return (
    <div
      class="research-calc-outputs"
      aria-disabled={stale ? 'true' : undefined}
      data-stale={stale ? '' : undefined}
    >
      <div class="research-calc-stats">
        <Stat label="Levels that fit" value={String(l.L)} hint={amountsHint(l.amounts)} />
        <Stat label="Chance a cycle runs out" value={runOutText(l.q)} />
        <Stat
          label="Typical session stays ahead until"
          value={horizonPhrase(l.nHalf)}
          hint={beyond ? `beyond this ${WHOLE.format(input.spins)}-spin session` : undefined}
        />
        <Stat
          label={`Chance of no run-out in ${WHOLE.format(input.spins)} spins`}
          value={pct1(l.pNoCap)}
        />
        <Stat
          label="Chance of ending ahead"
          value={pct1(r.pWin)}
          hint={
            cashing ? `with a cash-out after ${WHOLE.format(input.w)} cycle wins` : 'no cash-out'
          }
        />
        <Stat
          label="Typical session (predicted)"
          value={r.typical === 'negative' ? 'below break-even' : money(r.typical)}
        />
        <Stat label="Loss when the ladder runs out" value={money(-r.capLoss)} />
        <Stat
          label="Average"
          value="-2.7 cents per dollar bet"
          hint="The wheel's edge, whatever the ladder."
        />
      </div>
      {l.firstDeficitLevel !== null ? (
        <p class="error" role="alert">
          Level {l.firstDeficitLevel + 1} does not win back the losses before it: raise the growth
          or the chip size.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- the calculator

const sameInput = (a: CalcInput, b: CalcInput): boolean =>
  (Object.keys(a) as CalcField[]).every((k) => a[k] === b[k]);

export function LadderCalculator({ initial = CALC_DEFAULTS }: { initial?: CalcInput }) {
  const [input, setInput] = useState<CalcInput>(initial);
  const [bad, setBad] = useState<Set<CalcField>>(new Set());
  const errors = validate(input);
  const ok = Object.keys(errors).length === 0 && bad.size === 0;
  const fresh = ok ? calculate(input) : null;
  const lastGood = useRef<{ r: CalcResult; input: CalcInput } | null>(null);
  if (fresh) lastGood.current = { r: fresh, input };
  const shown = lastGood.current ?? { r: calculate(CALC_DEFAULTS), input: CALC_DEFAULTS };

  // The live sentence settles 600 ms after the last change.
  const [live, setLive] = useState('');
  const firstRun = useRef(true);
  useEffect(() => {
    // Nothing is announced when the page loads, only after a change.
    if (firstRun.current) {
      firstRun.current = false;
      return undefined;
    }
    if (!fresh || fresh.ladder.L === 0) return undefined;
    const t = setTimeout(() => setLive(summarySentence(fresh)), 600);
    return () => clearTimeout(t);
  }, [fresh ? summarySentence(fresh) : null]);

  const set = (k: CalcField) => (v: number) => setInput((p) => ({ ...p, [k]: v }));
  const valid = (k: CalcField) => (isOk: boolean) =>
    setBad((p) => {
      if (isOk === !p.has(k)) return p;
      const n = new Set(p);
      if (isOk) n.delete(k);
      else n.add(k);
      return n;
    });
  const id = (k: string): string => `calc-${k}`;
  const g = 36 / (36 - input.c);
  const profitW = shown.r.ladder.profitPerCycle * input.w;

  return (
    <form class="research-calc" aria-label="Ladder calculator" onSubmit={(e) => e.preventDefault()}>
      <div class="research-calc-presets" role="group" aria-label="Starting points">
        {CALC_PRESETS.map((p) => (
          <Chip
            key={p.id}
            selected={sameInput(input, p.input)}
            onClick={() => {
              setInput(p.input);
              setBad(new Set());
            }}
          >
            {p.label}
          </Chip>
        ))}
      </div>
      <div class="research-calc-grid">
        <div class="research-calc-inputs">
          <Field
            label="Numbers covered"
            id={id('c')}
            hint={`Chance per spin: ${pct1(input.c / 37)}. Each loss raises the bet ×${g.toFixed(2)}, enough to win back every loss plus one first-bet profit.`}
          >
            <IntField
              id={id('c')}
              value={input.c}
              min={1}
              max={35}
              message="Pick 1 to 35 numbers."
              error={errors.c}
              describedBy={`${id('c')}-hint`}
              onChange={set('c')}
              onValid={valid('c')}
            />
          </Field>
          <div class="research-calc-pair">
            <Field label="First bet" id={id('base')}>
              <AmountField
                id={id('base')}
                value={input.base}
                error={errors.base}
                onChange={set('base')}
                onValid={valid('base')}
              />
            </Field>
            <Field label="Chip size" id={id('unit')} hint="Bets round up to this.">
              <AmountField
                id={id('unit')}
                value={input.unit}
                error={errors.unit}
                describedBy={`${id('unit')}-hint`}
                onChange={set('unit')}
                onValid={valid('unit')}
              />
            </Field>
            <Field label="Bet maximum" id={id('max')}>
              <AmountField
                id={id('max')}
                value={input.betMax}
                error={errors.betMax}
                onChange={set('betMax')}
                onValid={valid('betMax')}
              />
            </Field>
            <Field label="Bankroll" id={id('bankroll')}>
              <AmountField
                id={id('bankroll')}
                value={input.bankroll}
                error={errors.bankroll}
                onChange={set('bankroll')}
                onValid={valid('bankroll')}
              />
            </Field>
          </div>
          <div class="research-calc-pair">
            <Field label="Spins" id={id('spins')}>
              <IntField
                id={id('spins')}
                value={input.spins}
                min={1}
                max={LIMITS.spinsMax}
                message="Spins: 1 to 100,000."
                error={errors.spins}
                onChange={set('spins')}
                onValid={valid('spins')}
              />
            </Field>
            <Field
              label="Cash out after"
              id={id('w')}
              hint={`cycle wins; 0 = no cash-out${input.w > 0 && profitW > 0 ? `; = ${formatMoney(Math.round(profitW))}` : ''}`}
            >
              <IntField
                id={id('w')}
                value={input.w}
                min={0}
                max={LIMITS.wMax}
                message="0 to 1,000 cycle wins."
                error={errors.w}
                describedBy={`${id('w')}-hint`}
                onChange={set('w')}
                onValid={valid('w')}
              />
            </Field>
          </div>
        </div>
        <div class="research-calc-results">
          <Outputs r={shown.r} input={shown.input} stale={!ok} />
          <p class="muted research-calc-note">
            Predictions from the cycle model of the earlier chapters, not a simulation. Simulated
            typical sessions run up to 15% lower. To check a ladder, build it in Define and run it.
            European wheel only.
          </p>
        </div>
      </div>
      <p class="visually-hidden" aria-live="polite">
        {live}
      </p>
    </form>
  );
}
