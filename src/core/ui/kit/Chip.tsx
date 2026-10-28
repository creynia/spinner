// Chip: a tappable pill (link or button), used for presets and filters.
import type { ComponentChildren } from 'preact';

export interface ChipProps {
  children: ComponentChildren;
  href?: string;
  onClick?: () => void;
  selected?: boolean;
}

export function Chip({ children, href, onClick, selected }: ChipProps) {
  if (href !== undefined) {
    return (
      <a class="chip" href={href}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" class="chip" aria-pressed={selected ?? false} onClick={onClick}>
      {children}
    </button>
  );
}
