// A list of labelled numbers, each with its 95% interval or the reason there is none.
import { TOO_FEW } from './format';

export interface KeyRow {
  id: string;
  label: string;
  value: string;
  /** Formatted interval ends; absent for point values that have none by definition. */
  interval?: { lo: string; hi: string } | null;
  /** True when an interval would exist but N is below 30. */
  tooFew?: boolean;
  hint?: string;
  tone?: 'neutral' | 'good' | 'bad';
}

export interface KeyNumbersProps {
  rows: KeyRow[];
  caption: string;
}

export function KeyNumbers({ rows, caption }: KeyNumbersProps) {
  return (
    <div class="table-scroll" tabIndex={0} role="region" aria-label="Table, scrolls sideways">
      <table class="keynums">
        <caption class="visually-hidden">{caption}</caption>
        <thead class="visually-hidden">
          <tr>
            <th scope="col">Measure</th>
            <th scope="col">Value</th>
            <th scope="col">95% interval</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-metric={r.id} class={r.tone ? `kn-${r.tone}` : undefined}>
              <th scope="row">
                {r.label}
                {r.hint ? <span class="kn-hint">{r.hint}</span> : null}
              </th>
              <td class="kn-value">{r.value}</td>
              <td class="kn-ci">
                {r.interval ? (
                  <>
                    {r.interval.lo} to {r.interval.hi}
                  </>
                ) : r.tooFew ? (
                  <span class="muted" title={TOO_FEW}>
                    too few sessions
                  </span>
                ) : (
                  <span class="muted">exact</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
