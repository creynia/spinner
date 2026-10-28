// One-line verdicts ("mean -$41 ± $6 · P(ahead) 38% · bust 2%"). Pure formatting over the metrics.
import { formatMoney } from '@core';
import type { RunMetrics } from '@core/contracts/analysis';
import type { Framing } from './settings';

export interface VerdictInput {
  /** Mean net per session, cents, and the half-width of its 95% CI (cents) when known. */
  meanNet: number;
  halfWidth: number | null;
  pAhead: number;
  pBust: number;
  n: number;
}

export function pct(p: number): string {
  const v = p * 100;
  if (v === 0) return '0%';
  if (v > 0 && v < 1) return '<1%';
  if (v < 100 && v > 99) return '>99%';
  return `${Math.round(v)}%`;
}

/** Scale a per-session amount to the chosen framing. */
export function frame(
  perSession: number,
  framing: Framing,
  roundsPerSession: number,
  roundsPerHour: number,
): { value: number; unit: string } {
  if (framing === 'hour' && roundsPerSession > 0) {
    return { value: (perSession * roundsPerHour) / roundsPerSession, unit: 'per hour' };
  }
  if (framing === 'per100' && roundsPerSession > 0) {
    return { value: (perSession * 100) / roundsPerSession, unit: 'per 100 rounds' };
  }
  return { value: perSession, unit: 'per session' };
}

export function formatVerdict(
  v: VerdictInput,
  framing: Framing = 'session',
  roundsPerSession = 0,
  roundsPerHour = 0,
): string {
  const scale =
    framing === 'session' || roundsPerSession <= 0
      ? 1
      : frame(1, framing, roundsPerSession, roundsPerHour).value;
  const mean = formatMoney(Math.round(v.meanNet * scale), { sign: true });
  const ci = v.halfWidth === null ? '' : ` ± ${formatMoney(Math.round(v.halfWidth * scale))}`;
  const unit = framing === 'session' ? '' : ` ${frame(1, framing, 1, 1).unit}`;
  return `mean ${mean}${ci}${unit} · P(ahead) ${pct(v.pAhead)} · bust ${pct(v.pBust)}`;
}

export function verdictFromMetrics(m: RunMetrics): VerdictInput {
  const ci = m.net.mean.ci;
  return {
    meanNet: m.net.mean.value,
    halfWidth: ci ? (ci.hi - ci.lo) / 2 : null,
    pAhead: m.probabilities.ahead.p,
    pBust: m.probabilities.bust.p,
    n: m.n,
  };
}
