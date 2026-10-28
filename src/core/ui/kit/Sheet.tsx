// Sheet: a modal dialog; a bottom sheet (max 85 vh) on phones, a centred panel from 768 px.
// While open the rest of the page is inert and the body does not scroll. Focus goes to the
// `data-autofocus` control (pass `autoFocus` to a Button), else the first control (Close).
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

/** Make everything outside `el` inert; returns the undo. */
function isolate(el: HTMLElement): () => void {
  const changed: HTMLElement[] = [];
  for (
    let node: HTMLElement | null = el;
    node && node !== document.body;
    node = node.parentElement
  ) {
    for (const sib of node.parentElement?.children ?? []) {
      if (sib !== node && sib instanceof HTMLElement && !sib.inert) {
        sib.inert = true;
        changed.push(sib);
      }
    }
  }
  return () => changed.forEach((n) => (n.inert = false));
}

export function Sheet({ open, title, onClose, children }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dlg = ref.current;
    if (!open || !dlg) return;
    const before = document.activeElement as HTMLElement | null;
    const unisolate = isolate(dlg.parentElement ?? dlg);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (
      dlg.querySelector<HTMLElement>('[data-autofocus]') ??
      dlg.querySelector<HTMLElement>(FOCUSABLE)
    )?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeRef.current();
      } else if (e.key === 'Tab') {
        const items = [...dlg.querySelectorAll<HTMLElement>(FOCUSABLE)];
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
      unisolate();
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div class="sheet-head">
          <h2>{title}</h2>
          <button type="button" class="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}
