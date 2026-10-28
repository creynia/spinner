import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Ref } from 'preact';

/** Measures the container width (ResizeObserver) so charts lay out at real pixels. */
export function useElementWidth(fallback = 640): { ref: Ref<HTMLDivElement>; width: number } {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = (): void => {
      const w = el.clientWidth;
      if (w > 0) setWidth(Math.max(240, Math.round(w)));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(read);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
  return { ref, width };
}

/** Latest value at most every `ms` (live Run charts: 4 Hz). */
export function useThrottled<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const now = Date.now();
    const wait = Math.max(0, last.current + ms - now);
    const t = setTimeout(() => {
      last.current = Date.now();
      setV(value);
    }, wait);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export interface CursorApi {
  index: number | null;
  clear(): void;
  svgProps: {
    onKeyDown(e: KeyboardEvent): void;
    onBlur(): void;
  };
  hitProps: {
    onPointerDown(e: PointerEvent): void;
    onPointerMove(e: PointerEvent): void;
    onPointerLeave(e: PointerEvent): void;
  };
}

/**
 * Shared cursor: hover on a mouse, tap on a phone (a tap pins the tooltip until the next tap or
 * Escape), arrow keys when the chart has focus. `nearest` maps a pixel x to an index.
 */
export function useCursor(count: number, nearest: (px: number) => number | null): CursorApi {
  const [index, setIndex] = useState<number | null>(null);
  const at = (e: PointerEvent): number | null => {
    const el = e.currentTarget as unknown as SVGElement;
    const svg = el.ownerSVGElement ?? el;
    const box = svg.getBoundingClientRect();
    return nearest(e.clientX - box.left);
  };
  return {
    index,
    clear: () => setIndex(null),
    svgProps: {
      onKeyDown(e) {
        if (count === 0) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
          setIndex((i) => (i === null ? 0 : Math.min(count - 1, i + 1)));
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
          setIndex((i) => (i === null ? count - 1 : Math.max(0, i - 1)));
        else if (e.key === 'Home') setIndex(0);
        else if (e.key === 'End') setIndex(count - 1);
        else if (e.key === 'Escape') setIndex(null);
        else return;
        e.preventDefault();
      },
      onBlur: () => setIndex(null),
    },
    hitProps: {
      onPointerDown: (e) => setIndex(at(e)),
      onPointerMove: (e) => {
        if (e.pointerType === 'mouse') setIndex(at(e));
      },
      onPointerLeave: (e) => {
        if (e.pointerType === 'mouse') setIndex(null);
      },
    },
  };
}

/** True when the user asked for less motion (used only to skip optional transitions). */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
