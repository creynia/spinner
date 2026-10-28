import { formatMoney } from '../../money';

export interface EquityLineProps {
  /** Starting bankroll, then equity after each round (cents). */
  values: readonly number[];
  /** Index into `values` of the current round. */
  cursor: number;
  label?: string;
  fmt?: (cents: number) => string;
}

const W = 300;
const H = 72;
const PAD = 4;
const MAX_POINTS = 400;

/** Equity over the session with a marker at the round being viewed. */
export function EquityLine({
  values,
  cursor,
  label = 'Equity this session',
  fmt,
}: EquityLineProps) {
  const f = fmt ?? ((v: number) => formatMoney(v));
  const n = values.length;
  const lo = n ? Math.min(...values) : 0;
  const hi = n ? Math.max(...values) : 1;
  const span = hi - lo || 1;
  const x = (i: number) => PAD + (n > 1 ? (i / (n - 1)) * (W - 2 * PAD) : 0);
  const y = (v: number) => H - PAD - ((v - lo) / span) * (H - 2 * PAD);
  const stride = Math.max(1, Math.ceil(n / MAX_POINTS));
  let d = '';
  for (let i = 0; i < n; i += stride)
    d += `${d ? 'L' : 'M'}${x(i).toFixed(1)} ${y(values[i]!).toFixed(1)}`;
  if ((n - 1) % stride !== 0 && n > 0)
    d += `L${x(n - 1).toFixed(1)} ${y(values[n - 1]!).toFixed(1)}`;
  const c = Math.min(Math.max(cursor, 0), Math.max(n - 1, 0));
  const text =
    n === 0
      ? `${label}: no data`
      : `${label}: starts ${f(values[0]!)}, now ${f(values[c]!)} at round ${c}, low ${f(lo)}, high ${f(hi)}`;
  return (
    <svg class="tr-equity" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={text}>
      {n > 0 ? (
        <>
          <line
            class="tr-equity-base"
            x1={PAD}
            x2={W - PAD}
            y1={y(values[0]!)}
            y2={y(values[0]!)}
          />
          <path class="tr-equity-line" d={d} />
          <circle class="tr-equity-dot" cx={x(c)} cy={y(values[c]!)} r="4" />
        </>
      ) : null}
    </svg>
  );
}
