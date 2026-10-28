// Tabs: WAI-ARIA tablist with arrow/Home/End keys. The strip scrolls on its own (never the page).
import type { ComponentChildren } from 'preact';

export interface TabDef {
  id: string;
  label: string;
}

export interface TabsProps {
  tabs: readonly TabDef[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  /** Content of the selected tab. */
  children?: ComponentChildren;
  idPrefix?: string;
}

export function Tabs({ tabs, value, onChange, label, children, idPrefix = 'tabs' }: TabsProps) {
  const onKey = (e: KeyboardEvent, i: number) => {
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = tabs.length - 1;
    if (n < 0) return;
    e.preventDefault();
    onChange(tabs[n]!.id);
    queueMicrotask(() => document.getElementById(`${idPrefix}-tab-${tabs[n]!.id}`)?.focus());
  };
  return (
    <div class="tabs">
      <div class="tablist" role="tablist" aria-label={label}>
        {tabs.map((t, i) => (
          <button
            type="button"
            role="tab"
            class="tab"
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={t.id === value}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={t.id === value ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${idPrefix}-panel`}
        aria-labelledby={`${idPrefix}-tab-${value}`}
        tabIndex={0}
        class="tabpanel"
      >
        {children}
      </div>
    </div>
  );
}
