// Form pieces: Field (label, hint, error), TextInput, Select, Toggle (switch), Segmented (radio group).
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';

let seq = 0;
/** A stable unique id per component instance, to link a label to its control. */
export function useId(prefix: string): string {
  const [id] = useState(() => `${prefix}-${++seq}`);
  return id;
}

export interface FieldProps {
  label: string;
  id: string;
  hint?: string;
  error?: string | null;
  children: ComponentChildren;
}

export function Field({ label, id, hint, error, children }: FieldProps) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      {children}
      {hint ? (
        <p class="hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p class="error" id={`${id}-err`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface TextInputProps {
  id: string;
  value: string;
  onInput: (v: string) => void;
  type?: 'text' | 'search' | 'number';
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  inputMode?: 'text' | 'decimal' | 'numeric';
}

export function TextInput(p: TextInputProps) {
  return (
    <input
      class="input"
      id={p.id}
      type={p.type ?? 'text'}
      value={p.value}
      placeholder={p.placeholder}
      inputMode={p.inputMode}
      aria-invalid={p.invalid ? 'true' : undefined}
      aria-describedby={p.describedBy}
      onInput={(e) => p.onInput(e.currentTarget.value)}
    />
  );
}

export interface SelectProps<T extends string> {
  id: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}

export function Select<T extends string>(p: SelectProps<T>) {
  return (
    <select
      class="input"
      id={p.id}
      value={p.value}
      onChange={(e) => p.onChange(e.currentTarget.value as T)}
    >
      {p.options.map((o) => (
        <option value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}

/** A switch: one button with role=switch; the visible label is its accessible name. */
export function Toggle({ label, checked, onChange, hint }: ToggleProps) {
  return (
    <div class="toggle-row">
      <button
        type="button"
        role="switch"
        class="toggle"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
      >
        <span class="toggle-track" aria-hidden="true">
          <span class="toggle-thumb" />
        </span>
        <span>{label}</span>
      </button>
      {hint ? <p class="hint">{hint}</p> : null}
    </div>
  );
}

export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}

/** A radio group drawn as joined buttons: one tab stop, arrows/Home/End move and select. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = options.length;
    let to = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i - 1 + n) % n;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    if (to < 0) return;
    e.preventDefault();
    onChange(options[to]!.value);
    ref.current?.querySelectorAll<HTMLElement>('[role=radio]')[to]?.focus();
  };
  return (
    <div class="segmented" role="radiogroup" aria-label={label} ref={ref}>
      {options.map((o, i) => (
        <button
          type="button"
          role="radio"
          class="seg"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
