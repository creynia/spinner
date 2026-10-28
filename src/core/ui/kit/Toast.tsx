// Toasts: a tiny store plus the host that renders it in a polite live region.
import { useEffect, useState } from 'preact/hooks';

export interface ToastItem {
  id: number;
  message: string;
  tone: 'info' | 'error';
  action?: { label: string; onClick: () => void };
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function dismissToast(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

/** Show a toast; it disappears after `ms` (default 6 s, 0 = until dismissed). */
export function showToast(
  message: string,
  opts: { tone?: ToastItem['tone']; action?: ToastItem['action']; ms?: number } = {},
): number {
  const id = nextId++;
  items = [...items, { id, message, tone: opts.tone ?? 'info', action: opts.action }];
  emit();
  const ms = opts.ms ?? 6000;
  if (ms > 0) setTimeout(() => dismissToast(id), ms);
  return id;
}

export function clearToasts(): void {
  items = [];
  emit();
}

export function ToastHost() {
  const [list, setList] = useState(items);
  useEffect(() => {
    const on = () => setList(items);
    listeners.add(on);
    on();
    return () => void listeners.delete(on);
  }, []);
  return (
    <div class="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div class={`toast toast-${t.tone}`} key={t.id}>
          <span>{t.message}</span>
          {t.action ? (
            <button type="button" class="btn btn-ghost" onClick={t.action.onClick}>
              {t.action.label}
            </button>
          ) : null}
          <button
            type="button"
            class="btn btn-ghost"
            aria-label="Dismiss"
            onClick={() => dismissToast(t.id)}
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
