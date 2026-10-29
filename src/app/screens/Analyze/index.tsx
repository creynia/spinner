// Analyze (architecture.md §6.3): tabs Overview, Paths, Risk, Where the money went, Convergence,
// Sessions, Export over one stored run. Money framing comes from settings.
import { experimentName } from '@core';
import { useState } from 'preact/hooks';
import { AnalysisView, Button, isAnalyzeTab, type AnalyzeTab } from '@core/ui';
import { RenameExperiment } from '../RenameExperiment';
import { navigate } from '../../router';
import { settingsStore } from '../../services/settings';
import { useStore } from '../../state/store';
import type { ScreenProps } from '../types';
import { NotFoundCard, tableMaxFor, useRunData } from './data';

export function Analyze({ params, query }: ScreenProps) {
  const runId = params.runId;
  const run = useRunData(runId);
  const framing = useStore(settingsStore, (s) => s.framing);
  const q = query.get('tab');
  const [renaming, setRenaming] = useState(false);
  const [tab, setTab] = useState<AnalyzeTab>(isAnalyzeTab(q) ? q : 'overview');
  // Switching tabs rewrites the hash in place: no history entry, no screen remount.
  const onTab = (t: AnalyzeTab) => {
    setTab(t);
    try {
      history.replaceState(null, '', `#/analyze/${encodeURIComponent(runId ?? '')}?tab=${t}`);
    } catch {
      // keep the tab in memory only
    }
  };

  if (run.state === 'loading') {
    return (
      <>
        <h1>Analyze</h1>
        <section class="card">
          <p class="muted" role="status">
            Loading the run...
          </p>
        </section>
      </>
    );
  }
  if (run.state !== 'ready') {
    return (
      <>
        <h1>Analyze</h1>
        <NotFoundCard what="Run" message={run.state === 'error' ? run.message : undefined} />
      </>
    );
  }
  const data = run.data;
  const status = data.meta.status;
  return (
    <div class="results-screen">
      <h1>Analyze: {experimentName(data)}</h1>
      {data.meta.imported ? (
        <p class="muted" data-imported>
          <span class="chip-note">imported</span> from spinner {data.meta.imported.appVersion}
          {data.meta.imported.trimmed ? ', gallery trim (fewer checkpoints and samples)' : ''}
          {data.meta.imported.partial ? ', partial run' : ''}
        </p>
      ) : null}
      <div class="actions">
        <Button href={`#/define?from=${encodeURIComponent(data.meta.runId)}`}>Run again</Button>
        <Button href={`#/compare?runs=${encodeURIComponent(data.meta.runId)}`}>Compare</Button>
        <Button onClick={() => setRenaming(true)} aria-label={`Rename ${experimentName(data)}`}>
          Rename
        </Button>
        {status !== 'done' ? (
          <Button href={`#/run/${encodeURIComponent(data.meta.runId)}`}>Open the run</Button>
        ) : null}
      </div>
      {renaming ? (
        <RenameExperiment
          id={data.meta.definitionId}
          name={experimentName(data)}
          onClose={() => setRenaming(false)}
        />
      ) : null}
      <AnalysisView
        data={data}
        framing={framing}
        tableMax={tableMaxFor(data.definition)}
        tab={tab}
        onTab={onTab}
        sessionHref={(i) => `#/watch/${encodeURIComponent(data.meta.runId)}/${i}`}
        onOpenSession={(i) => navigate(`/watch/${encodeURIComponent(data.meta.runId)}/${i}`)}
      />
    </div>
  );
}
