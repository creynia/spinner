// Sheet: a modal dialog; a bottom sheet (max 85 vh) on phones, a centred panel from 768 px.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children?: ComponentChildren;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

export function Sheet({ open, title, onClose, children }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Tab' && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div class="sheet-head">
          <h2>{title}</h2>
          <button type="button" class="btn btn-ghost" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}
