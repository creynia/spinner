// The live charts of a running run: fan on one tab and histogram on the other on phones, side by
// side on wide screens. Inputs are analysis outputs already throttled by the caller (about 4 Hz).
import type { FanChart as FanData, Histogram as Hist } from '../../contracts/analysis';
import { Card, Tabs } from '../kit';
import { FanChart, Histogram } from '../charts';
import { useMediaQuery } from './hooks';
import { useState } from 'preact/hooks';

export interface LivePanelProps {
  fan: FanData | null;
  histogram: Hist | null;
  sessions: number;
  /** Sessions the live fan uses when it is a prefix of the run so far (shown in its title). */
  fanSessions?: number;
}

export function LivePanel({ fan, histogram, sessions, fanSessions }: LivePanelProps) {
  const wide = useMediaQuery('(min-width: 900px)');
  const [tab, setTab] = useState<'paths' | 'results'>('paths');
  const paths =
    fan && fan.rounds.length > 1 ? (
      <FanChart
        fan={fan}
        title={
          fanSessions && fanSessions < sessions
            ? `Live: net result by round (first ${fanSessions.toLocaleString('en-US')} sessions)`
            : 'Live: net result by round'
        }
      />
    ) : (
      <p class="muted">Paths appear after the first batch arrives.</p>
    );
  const results = histogram ? (
    <Histogram
      histogram={histogram}
      title={`Live: net result per session (${sessions.toLocaleString('en-US')} done)`}
      xLabel="Net result"
    />
  ) : (
    <p class="muted">The distribution appears after the first batch arrives.</p>
  );
  if (wide) {
    return (
      <div class="two-col live-panel">
        <Card title="Paths">{paths}</Card>
        <Card title="Results">{results}</Card>
      </div>
    );
  }
  return (
    <Card title="Live charts" class="live-panel">
      <Tabs
        tabs={[
          { id: 'paths', label: 'Paths' },
          { id: 'results', label: 'Results' },
        ]}
        value={tab}
        onChange={(t) => setTab(t as 'paths' | 'results')}
        label="Live charts"
        idPrefix="live"
      >
        {tab === 'paths' ? paths : results}
      </Tabs>
    </Card>
  );
}
