// The denomination radiogroup (layouts.md §6.1): one tab stop, arrows/Home/End move and select.
import { useRef } from 'preact/hooks';
import { money } from './adjust';
import type { ChipRackProps } from './types';

export function ChipRack(props: ChipRackProps) {
  const { denominations, value, label = 'Chip value' } = props;
  const onChange = (d: number) => props.onChange(d);
  const ref = useRef<HTMLDivElement>(null);
  const n = denominations.length;
  const selected = value === null ? -1 : denominations.indexOf(value);
  const onKey = (e: KeyboardEvent, i: number) => {
    let to = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i - 1 + n) % n;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    if (to < 0) return;
    e.preventDefault();
    onChange(denominations[to]!);
    ref.current?.querySelectorAll<HTMLElement>('[role=radio]')[to]?.focus();
  };
  return (
    <div class="chip-rack" role="radiogroup" aria-label={label} ref={ref}>
      {denominations.map((d, i) => (
        <button
          type="button"
          role="radio"
          class="chip-rack-opt"
          aria-checked={i === selected}
          tabIndex={i === selected || (selected < 0 && i === 0) ? 0 : -1}
          onClick={() => onChange(d)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {money(d)}
        </button>
      ))}
    </div>
  );
}
