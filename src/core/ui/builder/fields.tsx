// Small controlled inputs for the builder editors. Numbers keep their own text while typing and
// report only valid values; money is dollars in the box, integer cents out (may be negative).
import { useEffect, useState } from 'preact/hooks';
import { Field, TextInput, useId } from '../kit';

export function parseSignedMoney(text: string): number | null {
  const t = text.trim().replace(/,/g, '');
  const m = /^(-|−)?\$?(\d+)(?:\.(\d{1,2}))?$/.exec(t.replace(/^(-|−)\$/, '$1'));
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0') || 0);
  if (!Number.isSafeInteger(cents)) return null;
  return m[1] ? -cents : cents;
}
export function signedMoneyText(c: number): string {
  const a = Math.abs(c);
  const body =
    a % 100 === 0 ? String(a / 100) : `${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
  return c < 0 ? `-${body}` : body;
}

export interface NumFieldProps {
  label: string;
  value: number;
  onChange: (n: number) => void;
  integer?: boolean;
  min?: number;
  max?: number;
  hint?: string;
  /** Show the value as dollars and report cents. */
  money?: boolean;
}

export function NumField(p: NumFieldProps) {
  const id = useId('num');
  const show = (v: number) => (p.money ? signedMoneyText(v) : String(v));
  const [text, setText] = useState(show(p.value));
  const parse = (s: string): number | null => {
    if (p.money) return parseSignedMoney(s);
    if (!/^-?\d*\.?\d+$/.test(s.trim())) return null;
    return Number(s);
  };
  const v = parse(text);
  const bad =
    v === null ||
    (p.integer && !Number.isInteger(v)) ||
    (p.min !== undefined && v < p.min) ||
    (p.max !== undefined && v > p.max);
  useEffect(() => {
    if (parse(text) !== p.value) setText(show(p.value));
  }, [p.value]);
  return (
    <Field
      label={p.label}
      id={id}
      hint={p.hint}
      error={
        bad
          ? p.min !== undefined
            ? `Enter a number of at least ${p.min}.`
            : 'Enter a number.'
          : null
      }
    >
      <div class={p.money ? 'money' : undefined}>
        {p.money ? (
          <span class="money-sign" aria-hidden="true">
            $
          </span>
        ) : null}
        <input
          class={`input${p.money ? ' money-input' : ''}`}
          id={id}
          type="text"
          inputMode={p.integer ? 'numeric' : 'decimal'}
          autoComplete="off"
          value={text}
          aria-invalid={bad ? 'true' : undefined}
          aria-describedby={bad ? `${id}-err` : p.hint ? `${id}-hint` : undefined}
          onInput={(e) => {
            const t = e.currentTarget.value;
            setText(t);
            const n = parse(t);
            if (
              n !== null &&
              !(p.integer && !Number.isInteger(n)) &&
              !(p.min !== undefined && n < p.min) &&
              !(p.max !== undefined && n > p.max)
            )
              p.onChange(n);
          }}
        />
      </div>
    </Field>
  );
}

export function TextField(p: {
  label: string;
  value: string;
  onInput: (v: string) => void;
  hint?: string;
  error?: string | null;
  placeholder?: string;
}) {
  const id = useId('txt');
  return (
    <Field label={p.label} id={id} hint={p.hint} error={p.error}>
      <TextInput
        id={id}
        value={p.value}
        onInput={p.onInput}
        invalid={!!p.error}
        placeholder={p.placeholder}
        describedBy={p.error ? `${id}-err` : p.hint ? `${id}-hint` : undefined}
      />
    </Field>
  );
}

export function SelectField<T extends string>(p: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  hint?: string;
}) {
  const id = useId('sel');
  return (
    <Field label={p.label} id={id} hint={p.hint}>
      <select
        class="input"
        id={id}
        value={p.value}
        aria-describedby={p.hint ? `${id}-hint` : undefined}
        onChange={(e) => p.onChange(e.currentTarget.value as T)}
      >
        {p.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** A JSON textarea that reports parsed values only when the text parses. */
export function JsonField(p: {
  label: string;
  value: unknown;
  onChange: (v: unknown) => void;
  rows?: number;
}) {
  const id = useId('json');
  const [text, setText] = useState(() => JSON.stringify(p.value, null, 2));
  const [err, setErr] = useState<string | null>(null);
  return (
    <Field label={p.label} id={id} error={err}>
      <textarea
        class="input json-area"
        id={id}
        rows={p.rows ?? 6}
        spellcheck={false}
        value={text}
        aria-invalid={err ? 'true' : undefined}
        aria-describedby={err ? `${id}-err` : undefined}
        onInput={(e) => {
          const t = e.currentTarget.value;
          setText(t);
          try {
            p.onChange(JSON.parse(t));
            setErr(null);
          } catch (x) {
            setErr(x instanceof Error ? x.message : 'Not valid JSON');
          }
        }}
      />
    </Field>
  );
}
