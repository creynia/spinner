import { useEffect, useState } from 'preact/hooks';

/** `matchMedia` as state; false when unavailable (tests, SSR). */
export function useMediaQuery(query: string): boolean {
  const get = (): boolean => {
    try {
      return typeof matchMedia === 'function' && matchMedia(query).matches;
    } catch {
      return false;
    }
  };
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(query);
    const fn = () => setOn(mq.matches);
    fn();
    mq.addEventListener?.('change', fn);
    return () => mq.removeEventListener?.('change', fn);
  }, [query]);
  return on;
}

/** A value that follows `value` at most every `ms` (trailing edge kept). */
export function useThrottled<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
