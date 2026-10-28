// One place where every displayed number is formatted (PLAYBOOK §9.5: consistent, with intervals).
// Money in, cents; the framing scales a per-session amount to per hour or per 100 rounds.
import type { Estimate, Interval } from '../../contracts/analysis';
import { MIN_N_FOR_CI } from '../../contracts/analysis';
import { formatMoney } from '../../money';

export type MoneyFraming = 'session' | 'hour' | 'per100';

export const FRAMING_LABEL: Record<MoneyFraming, string> = {
  session: 'per session',
  hour: 'per hour',
  per100: 'per 100 rounds',
};

/** Display rounding (docs/metrics.md): to the cent, to the dollar from $1,000 up. */
export function fmtMoney(cents: number, opts?: { sign?: boolean }): string {
  if (!Number.isFinite(cents)) return 'n/a';
  const c = Math.abs(cents) >= 100_000 ? Math.round(cents / 100) * 100 : Math.round(cents);
  return formatMoney(c, opts);
}

export function fmtPct(p: number): string {
  if (!Number.isFinite(p)) return 'n/a';
  return `${(p * 100).toFixed(1)}%`;
}

export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return 'n/a';
  return Math.round(n).toLocaleString('en-US');
}

export function fmtNum(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return 'n/a';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtZ(z: number | null): string {
  return z === null || !Number.isFinite(z)
    ? 'n/a'
    : `${z >= 0 ? '+' : '-'}${Math.abs(z).toFixed(2)}`;
}

export function fmtDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return 'n/a';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

export function fmtBytes(b: number | null | undefined): string {
  if (b === null || b === undefined || !Number.isFinite(b)) return 'unknown';
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

/** Scales per-session cents to the chosen framing. `meanRounds` is the mean rounds actually played. */
export interface Framer {
  framing: MoneyFraming;
  unit: string;
  scale: number;
  /** Framed money text; amounts are per-session cents. */
  money(perSession: number, opts?: { sign?: boolean }): string;
}

export function makeFramer(
  framing: MoneyFraming,
  meanRounds: number,
  roundsPerHour: number,
): Framer {
  let scale = 1;
  if (meanRounds > 0 && Number.isFinite(meanRounds)) {
    if (framing === 'hour') scale = roundsPerHour / meanRounds;
    else if (framing === 'per100') scale = 100 / meanRounds;
  }
  const eff: MoneyFraming = meanRounds > 0 && Number.isFinite(meanRounds) ? framing : 'session';
  return {
    framing: eff,
    unit: FRAMING_LABEL[eff],
    scale,
    money: (v, opts) => fmtMoney(v * scale, opts),
  };
}

export function intervalText(ci: Interval | undefined, fmt: (v: number) => string): string | null {
  return ci ? `${fmt(ci.lo)} to ${fmt(ci.hi)}` : null;
}

/** "-$41 (95% CI -$47 to -$35)" or, below 30 sessions, the point value and the reason. */
export function estimateText(e: Estimate, fmt: (v: number) => string): string {
  const t = intervalText(e.ci, fmt);
  return t ? `${fmt(e.value)} (95% CI ${t})` : `${fmt(e.value)} (too few sessions for an interval)`;
}

export const TOO_FEW = `too few sessions for an interval (under ${MIN_N_FOR_CI})`;

/** Hours and rounds helper for the length distribution. */
export function fmtHours(h: number): string {
  return Number.isFinite(h) ? `${h.toFixed(h < 10 ? 2 : 1)} h` : 'n/a';
}

/** "rounds" is shown as "round limit"; strategy stops as "strategy: <reason>". */
export function fmtEnded(label: string): string {
  if (label === 'rounds') return 'round limit';
  if (label.startsWith('strategy:')) return `strategy: ${label.slice(9)}`;
  return label;
}
