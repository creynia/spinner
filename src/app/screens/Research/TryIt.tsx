// Chapter 9, "Try a candidate": one block per candidate strategy with an "Open in Define" button
// that builds the share link of share.ts and navigates to it. Numbers come from the candidate's
// first ledger row (data.json); the setup numbers in the copy are the constants of share.ts.
import { useMemo, useState } from 'preact/hooks';
import { SHARE_FALLBACK_NOTICE, formatMoney } from '@core';
import { Button } from '@core/ui';
import { navigate } from '../../router';
import type { Candidate, RowStats } from './data';
import { money, pct1 } from './kit';
import { TRY_SETUP, candidateLink, normalizeCandidate, type CandidateLink } from './share';

/** Plan section 9 order: the cash-out version first, then the stack, then the two-street ladder. */
export const CANDIDATE_ORDER = [
  'keeper-c9-streets-to12-cashout',
  'keeper-c9-streets-to12-stack',
  'keeper-b3-two-streets-l29',
];

export interface TryItProps {
  candidates: Candidate[];
  rows: Record<string, RowStats>;
  /** Navigates to a hash; defaults to the app router. */
  go?: (hash: string) => void;
}

const rank = (id: string): number => {
  const i = CANDIDATE_ORDER.indexOf(id);
  return i < 0 ? CANDIDATE_ORDER.length : i;
};

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "Typical session +$286 · ends ahead 90.3% · average -$46 · worst 5 % -$3,210". */
export function candidateLine(r: RowStats): string {
  return `Typical session ${money(r.median)} · ends ahead ${pct1(r.pWin)} · average ${money(r.mean)} · worst 5 % ${money(r.cvar5)}`;
}

type State =
  { s: 'idle' } | { s: 'opening' } | { s: 'file'; link: CandidateLink & { kind: 'file' } };

function CandidateBlock({
  c,
  stats,
  go,
}: {
  c: Candidate;
  stats: RowStats | undefined;
  go: (hash: string) => void;
}) {
  const [state, setState] = useState<State>({ s: 'idle' });
  const normalized = useMemo(() => normalizeCandidate(c), [c]);
  const open = async (): Promise<void> => {
    setState({ s: 'opening' });
    const link = await candidateLink(c);
    if (link.kind === 'link') {
      setState({ s: 'idle' });
      go(link.hash);
    } else if (link.kind === 'file') setState({ s: 'file', link });
    else setState({ s: 'idle' });
  };
  return (
    <div class="research-candidate">
      <p class="research-candidate-name">{c.name}</p>
      {stats ? <p class="research-candidate-line">{candidateLine(stats)}</p> : null}
      {!normalized.ok ? (
        <p class="error">This candidate does not load: {normalized.message}.</p>
      ) : state.s === 'file' ? (
        <>
          <p>
            This definition is {SHARE_FALLBACK_NOTICE} ({state.link.chars.toLocaleString('en-US')}{' '}
            characters).
          </p>
          <Button
            variant="secondary"
            onClick={() => download(state.link.filename, state.link.file)}
          >
            Download definition file
          </Button>
        </>
      ) : (
        <Button
          variant="primary"
          aria-label={`Open in Define: ${c.name}`}
          disabled={state.s === 'opening'}
          onClick={() => void open()}
        >
          {state.s === 'opening' ? 'Opening…' : 'Open in Define'}
        </Button>
      )}
    </div>
  );
}

export function TryIt({ candidates, rows, go = navigate }: TryItProps) {
  const sorted = [...candidates].sort((a, b) => rank(a.id) - rank(b.id));
  return (
    <div class="research-tryit">
      {sorted.map((c) => (
        <CandidateBlock key={c.id} c={c} stats={rows[c.rows[0] ?? '']} go={go} />
      ))}
      <p class="muted research-tryit-note">
        Opens an unsaved draft in Define with the {formatMoney(100)}-minimum table, a{' '}
        {formatMoney(TRY_SETUP.bankroll)} bankroll, {TRY_SETUP.maxRounds} spins,{' '}
        {TRY_SETUP.sessions.toLocaleString('en-US')} sessions and seed {TRY_SETUP.seed}. Press Run;
        on Analyze → Overview the typical session should match the number above, because the seed is
        the same.
      </p>
    </div>
  );
}
