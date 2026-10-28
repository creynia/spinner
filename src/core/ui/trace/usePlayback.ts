import { useEffect, useRef, useState } from 'preact/hooks';

export const SPEEDS = [
  { id: '1', label: '1 round/s', ms: 1000 },
  { id: '2', label: '2 rounds/s', ms: 500 },
  { id: '5', label: '5 rounds/s', ms: 200 },
  { id: '20', label: '20 rounds/s', ms: 50 },
  { id: 'instant', label: 'Instant', ms: 0 },
] as const;
export type SpeedId = (typeof SPEEDS)[number]['id'];

export function isSpeedId(x: string | null | undefined): x is SpeedId {
  return SPEEDS.some((s) => s.id === x);
}

/** True when the user asks the system for less motion. Never throws (no matchMedia in tests). */
export function prefersReducedMotion(): boolean {
  try {
    return (
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

export function useReducedMotion(): boolean {
  const [r, setR] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setR(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return r;
}

/**
 * Timer-driven stepping. `step()` returns false at the end, which stops playback. With reduced
 * motion, autoplay is refused (the caller shows why); stepping by hand always works.
 */
export function usePlayback(opts: { speed: SpeedId; reducedMotion: boolean; step: () => boolean }) {
  const [playing, setPlaying] = useState(false);
  const stepRef = useRef(opts.step);
  stepRef.current = opts.step;
  const ms = SPEEDS.find((s) => s.id === opts.speed)?.ms ?? 1000;
  useEffect(() => {
    if (!playing) return;
    if (opts.reducedMotion) {
      setPlaying(false);
      return;
    }
    if (ms === 0) {
      while (stepRef.current()) {
        /* run to the end */
      }
      setPlaying(false);
      return;
    }
    const t = setInterval(() => {
      if (!stepRef.current()) setPlaying(false);
    }, ms);
    return () => clearInterval(t);
  }, [playing, ms, opts.reducedMotion]);
  return { playing, setPlaying };
}
