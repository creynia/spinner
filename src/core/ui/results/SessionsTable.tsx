// Sortable, virtualised table of the per-session summary rows (10,000 rows stay cheap: only the
// visible window is rendered, between two spacer rows). Tapping a row opens Watch.
import { useMemo, useRef, useState } from 'preact/hooks';
import type { RunData } from '../../contracts/run';
import { domainSize, endedByLabel } from '../../analysis';
import { fmtEnded, fmtInt, fmtMoney } from './format';

export const ROW_HEIGHT = 48;
const VIEW_HEIGHT = 480;
const OVERSCAN = 6;

type SortKey = 'index' | 'net' | 'endedBy' | 'roundsPlayed' | 'maxDrawdown' | 'maxExposure';
const COLUMNS: { key: SortKey; label: string; numeric: boolean; wide?: boolean }[] = [
  { key: 'index', label: '#', numeric: true },
  { key: 'net', label: 'Net', numeric: true },
  { key: 'endedBy', label: 'Ended by', numeric: false },
  { key: 'roundsPlayed', label: 'Rounds', numeric: true, wide: true },
  { key: 'maxDrawdown', label: 'Max drawdown', numeric: true },
  { key: 'maxExposure', label: 'Max on table', numeric: true, wide: true },
];

export interface SessionsTableProps {
  data: RunData;
  /** Link target for a session (Watch); null makes rows plain (read-only bundles). */
  hrefFor?: (index: number) => string | null;
  onOpen?: (index: number) => void;
  /** Rows visible at once (tests shrink the window). */
  viewHeight?: number;
}

export function SessionsTable({
  data,
  hrefFor,
  onOpen,
  viewHeight = VIEW_HEIGHT,
}: SessionsTableProps) {
  const n = domainSize(data);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'index', dir: 1 });
  const [top, setTop] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const t = data.summary;
  const reasons = data.meta.labels.reasons;

  const order = useMemo(() => {
    const idx = new Int32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    if (sort.key === 'index') return sort.dir === 1 ? idx : idx.reverse();
    const col = t[sort.key] as ArrayLike<number>;
    const dir = sort.dir;
    // Stable on ties: the index breaks them.
    return idx.sort((a, b) => (col[a]! - col[b]!) * dir || a - b);
  }, [data, n, sort]);

  const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
  const count = Math.ceil(viewHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const last = Math.min(n, first + count);
  const rows: number[] = [];
  for (let r = first; r < last; r++) rows.push(order[r]!);

  const toggle = (key: SortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'index' ? 1 : -1 },
    );

  return (
    <div
      class="sessions-scroll"
      ref={box}
      style={{ maxHeight: `${viewHeight}px` }}
      onScroll={(e) => setTop((e.currentTarget as HTMLElement).scrollTop)}
      tabIndex={0}
      role="region"
      aria-label={`Sessions, ${fmtInt(n)} rows, scrollable`}
    >
      <table class="sessions-table" data-rows={n}>
        <caption class="visually-hidden">
          Per-session results, {fmtInt(n)} sessions. Sort with the column buttons; select a row to
          watch it.
        </caption>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                scope="col"
                class={`${c.numeric ? 'num' : ''}${c.wide ? ' wide-only' : ''}`}
                aria-sort={
                  sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'
                }
              >
                <button type="button" class="sort-btn" onClick={() => toggle(c.key)}>
                  {c.label}
                  <span aria-hidden="true">
                    {sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {first > 0 ? (
            <tr aria-hidden="true" style={{ height: `${first * ROW_HEIGHT}px` }}>
              <td colSpan={COLUMNS.length} />
            </tr>
          ) : null}
          {rows.map((i) => {
            const href = hrefFor ? hrefFor(i) : null;
            return (
              <tr
                key={i}
                class={href ? 'session-row clickable' : 'session-row'}
                style={{ height: `${ROW_HEIGHT}px` }}
                onClick={href && onOpen ? () => onOpen(i) : undefined}
              >
                <th scope="row" class="num">
                  {href ? (
                    <a class="session-link" href={href} aria-label={`Watch session ${i}`}>
                      {fmtInt(i)}
                    </a>
                  ) : (
                    fmtInt(i)
                  )}
                </th>
                <td class={`num ${t.net[i]! > 0 ? 'pos' : t.net[i]! < 0 ? 'neg' : ''}`}>
                  {fmtMoney(t.net[i]!, { sign: true })}
                </td>
                <td>{fmtEnded(endedByLabel(t.endedBy[i]!, reasons))}</td>
                <td class="num wide-only">{fmtInt(t.roundsPlayed[i]!)}</td>
                <td class="num">{fmtMoney(t.maxDrawdown[i]!)}</td>
                <td class="num wide-only">{fmtMoney(t.maxExposure[i]!)}</td>
              </tr>
            );
          })}
          {last < n ? (
            <tr aria-hidden="true" style={{ height: `${(n - last) * ROW_HEIGHT}px` }}>
              <td colSpan={COLUMNS.length} />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
