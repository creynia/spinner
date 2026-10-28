// MoneyInput: dollars in the box, integer cents in and out (never floats downstream).
import { useEffect, useState } from 'preact/hooks';

/** "$1,250.50" | "12" | "0.5" -> cents; null when it is not a money amount (max 2 decimals). */
export function parseMoney(text: string): number | null {
  const t = text.trim().replace(/^\$/, '').replace(/,/g, '');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
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

export function MoneyInput({ id, value, onChange, min, max, describedBy }: MoneyInputProps) {
  const [text, setText] = useState(moneyText(value));
  const parsed = parseMoney(text);
  const bad =
    parsed === null || (min !== undefined && parsed < min) || (max !== undefined && parsed > max);
  useEffect(() => {
    // Follow outside changes, but not while the typed text already means the same amount.
    if (parseMoney(text) !== value) setText(moneyText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div class="money">
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
        aria-invalid={bad ? 'true' : undefined}
        aria-describedby={describedBy}
        onInput={(e) => {
          const v = (e.currentTarget as HTMLInputElement).value;
          setText(v);
          const c = parseMoney(v);
          if (c !== null && (min === undefined || c >= min) && (max === undefined || c <= max)) {
            onChange(c);
          }
        }}
      />
    </div>
  );
}
