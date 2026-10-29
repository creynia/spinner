// "10 seconds ago", "36 minutes ago", "2 hours ago", then (24 h or older) just the date.
// One shared 30 s timer feeds every mounted label and stops while the page is hidden.
import { useEffect, useState } from 'preact/hooks';

const dateOf = (iso: string): Date | null => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'} ago`;

/**
 * Under 5 s (and any future time, from clock skew): "just now"; under 60 s: seconds; under 60 min:
 * minutes; under 24 h: hours; otherwise the date alone (`dateStyle: 'medium'`, user locale).
 */
export function relativeTime(iso: string, now: number = Date.now(), locale?: string): string {
  const d = dateOf(iso);
  if (!d) return '';
  const s = Math.floor((now - d.getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return plural(s, 'second');
  if (s < 3600) return plural(Math.floor(s / 60), 'minute');
  if (s < 86_400) return plural(Math.floor(s / 3600), 'hour');
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
}

/** The full local date and time, for a hover title. */
export function fullTime(iso: string, locale?: string): string {
  const d = dateOf(iso);
  return d
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'medium' }).format(d)
    : '';
}

/** When a run finished, else started, else was created. */
export function runTimestamp(meta: {
  createdAt: string;
  timing?: { startedAt?: string; finishedAt?: string };
}): string {
  return meta.timing?.finishedAt ?? meta.timing?.startedAt ?? meta.createdAt;
}

const TICK_MS = 30_000;
const subs = new Set<(now: number) => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function onVisible(): void {
  if (document.visibilityState === 'visible') for (const f of subs) f(Date.now());
}
function subscribe(fn: (now: number) => void): () => void {
  subs.add(fn);
  if (subs.size === 1) {
    timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        const now = Date.now();
        for (const f of subs) f(now);
      }
    }, TICK_MS);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  }
  return () => {
    subs.delete(fn);
    if (subs.size === 0) {
      clearInterval(timer);
      if (typeof document !== 'undefined')
        document.removeEventListener('visibilitychange', onVisible);
    }
  };
}

/** The current time, refreshed about every 30 s while the page is visible (one shared timer). */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    return subscribe(setNow);
  }, []);
  return now;
}

export function RelativeTime({ iso }: { iso: string }) {
  const now = useNow();
  return (
    <time dateTime={iso} title={fullTime(iso)}>
      {relativeTime(iso, now)}
    </time>
  );
}
