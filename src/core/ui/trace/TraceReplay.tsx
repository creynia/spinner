import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { GameUi } from '../game-ui';
import type { TraceWindow } from '../../contracts/strategy-trace';
import { EquityLine } from './EquityLine';
import { Stepper } from './Stepper';
import { TraceList } from './TraceList';
import { WindowDetail } from './WindowDetail';
import { equitySeries, placedLayout, toRoundOutcome } from './outcome';
import { useReducedMotion, usePlayback, type SpeedId } from './usePlayback';
import './trace.css';

export interface TraceReplayProps<R = unknown> {
  trace: readonly TraceWindow[];
  /** Cents. */
  bankroll: number;
  ui: Pick<GameUi<R>, 'TableView' | 'OutcomeGlyph'>;
  rules: R;
  /** Plain-words bet name; default is the canonical id. */
  betLabel?: (id: string) => string;
  ruleLabel?: (id: string) => string | undefined;
  initialRound?: number;
  initialSpeed?: SpeedId;
  onRoundChange?: (round: number) => void;
}

const ident = (id: string) => id;

/** Table + trace + stepper for one session; game-agnostic (the table comes from the game's UI). */
export function TraceReplay<R>(props: TraceReplayProps<R>) {
  const { trace, ui } = props;
  const n = trace.length;
  const clamp = (r: number) => Math.min(Math.max(r, 0), Math.max(n - 1, 0));
  const [round, setRound] = useState(() => clamp(props.initialRound ?? 0));
  const [speed, setSpeed] = useState<SpeedId>(props.initialSpeed ?? '2');
  const [highlight, setHighlight] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const roundRef = useRef(round);
  roundRef.current = round;

  const go = (r: number) => {
    const c = clamp(r);
    roundRef.current = c;
    setRound(c);
  };
  useEffect(() => props.onRoundChange?.(round), [round]);
  useEffect(() => {
    setRound((r) => clamp(r));
  }, [n]);

  const { playing, setPlaying } = usePlayback({
    speed,
    reducedMotion: reduced,
    step: () => {
      if (roundRef.current >= n - 1) return false;
      go(roundRef.current + 1);
      return roundRef.current < n - 1;
    },
  });
  // Playing from the end restarts at the beginning.
  const playPause = () => {
    if (!playing && roundRef.current >= n - 1) go(0);
    setPlaying(!playing);
  };

  const w = trace[round];
  const layout = useMemo(() => (w ? placedLayout(w) : []), [w]);
  const outcome = useMemo(() => (w ? toRoundOutcome(w) : null), [w]);
  const series = useMemo(() => equitySeries(trace, props.bankroll), [trace, props.bankroll]);
  const { TableView, OutcomeGlyph } = ui;

  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
    const k = e.key;
    if (k === 'ArrowRight') go(round + 1);
    else if (k === 'ArrowLeft') go(round - 1);
    else if (k === 'Home') go(0);
    else if (k === 'End') go(n - 1);
    else if (k === ' ' && t.tagName !== 'BUTTON') playPause();
    else return;
    e.preventDefault();
  };

  if (!w) return <p class="muted">This session has no recorded rounds.</p>;

  return (
    <div class="tr-replay" onKeyDown={onKey} data-testid="trace-replay">
      <div class="tr-table">
        <TableView
          rules={props.rules}
          layout={layout}
          lastOutcome={outcome}
          highlight={highlight}
        />
      </div>
      <div class="tr-trace card">
        <TraceList trace={trace} round={round} OutcomeGlyph={OutcomeGlyph} onSelect={go} />
      </div>
      <div class="tr-state card">
        <WindowDetail
          w={w}
          OutcomeGlyph={OutcomeGlyph}
          betLabel={props.betLabel ?? ident}
          ruleLabel={props.ruleLabel}
          highlighted={highlight}
          onHighlight={setHighlight}
        />
        <h4>Equity</h4>
        <EquityLine values={series} cursor={round + 1} />
      </div>
      <div class="tr-stepbar">
        <Stepper
          round={round}
          count={n}
          playing={playing}
          speed={speed}
          reducedMotion={reduced}
          onFirst={() => go(0)}
          onPrev={() => go(round - 1)}
          onNext={() => go(round + 1)}
          onLast={() => go(n - 1)}
          onPlayPause={playPause}
          onSpeed={setSpeed}
          onScrub={go}
        />
      </div>
    </div>
  );
}
