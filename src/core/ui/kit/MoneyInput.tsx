// MoneyInput: dollars in the box, integer cents in and out (never floats downstream).
import { useEffect, useState } from 'preact/hooks';

const MONEY = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/** "$1,250.50" | "12" | "0.5" -> cents; null when it is not money (strict grouping, max 2 decimals). */
export function parseMoney(text: string): number | null {
  const t = text.trim().replace(/^\$/, '');
  const m = MONEY.exec(t);
  if (!m) return null;
  const [whole = ''] = t.split('.');
  const cents = Number(whole.replace(/,/g, '')) * 100 + Number((m[1] ?? '').padEnd(2, '0') || 0);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Cents -> the editable text, "1250" or "1250.50". */
export function moneyText(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rem = cents % 100;
  return rem === 0 ? String(whole) : `${whole}.${String(rem).padStart(2, '0')}`;
}

export interface MoneyInputProps {
  id: string;
  /** Cents. */
  value: number;
  /** Called only with valid amounts. */
  onChange: (cents: number) => void;
  min?: number;
  max?: number;
  describedBy?: string;
}

function problem(text: string, min?: number, max?: number): string | null {
  const c = parseMoney(text);
  if (c === null) return 'Enter an amount in dollars, like 25 or 1,250.50.';
  if (min !== undefined && c < min) return `The minimum is ${moneyText(min)} dollars.`;
  if (max !== undefined && c > max) return `The maximum is ${moneyText(max)} dollars.`;
  return null;
}

export function MoneyInput({ id, value, onChange, min, max, describedBy }: MoneyInputProps) {
  const [text, setText] = useState(moneyText(value));
  const err = problem(text, min, max);
  useEffect(() => {
    // Follow outside changes, but not while the typed text already means the same amount.
    if (parseMoney(text) !== value) setText(moneyText(value));
  }, [value]);
  const errId = `${id}-err`;
  return (
    <div class="money">
      <div class="money-box">
        <span class="money-sign" aria-hidden="true">
          $
        </span>
        <input
          class="input money-input"
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          aria-invalid={err ? 'true' : undefined}
          aria-describedby={[describedBy, err ? errId : ''].filter(Boolean).join(' ') || undefined}
          onInput={(e) => {
            const v = e.currentTarget.value;
            setText(v);
            const c = parseMoney(v);
            if (c !== null && !problem(v, min, max)) onChange(c);
          }}
          onBlur={() => {
            // Leave the field only with a valid value: revert to the last one that was accepted.
            if (problem(text, min, max)) setText(moneyText(value));
          }}
        />
      </div>
      {err ? (
        <p class="error" id={errId}>
          {err}
        </p>
      ) : null}
    </div>
  );
}
