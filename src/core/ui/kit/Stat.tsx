// Stat tile: a label, a headline value and, always when it is an estimate, its 95% interval.
export interface StatProps {
  label: string;
  /** Formatted value, e.g. "-$41". */
  value: string;
  /** Formatted interval ends, e.g. { lo: '-$47', hi: '-$35' }. */
  interval?: { lo: string; hi: string };
  hint?: string;
  tone?: 'neutral' | 'good' | 'bad';
}

export function Stat({ label, value, interval, hint, tone = 'neutral' }: StatProps) {
  return (
    <div class={`stat stat-${tone}`}>
      <div class="stat-label">{label}</div>
      <div class="stat-value">{value}</div>
      {interval ? (
        <div class="stat-ci">
          95% CI {interval.lo} to {interval.hi}
        </div>
      ) : null}
      {hint ? <div class="stat-hint muted">{hint}</div> : null}
    </div>
  );
}
