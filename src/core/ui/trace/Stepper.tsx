import { SPEEDS, type SpeedId } from './usePlayback';

export interface StepperProps {
  round: number;
  count: number;
  playing: boolean;
  speed: SpeedId;
  reducedMotion: boolean;
  onFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast: () => void;
  onPlayPause: () => void;
  onSpeed: (s: SpeedId) => void;
  onScrub: (round: number) => void;
}

const I = (p: { children: preact.ComponentChildren }) => (
  <svg
    class="tr-icon"
    width="20"
    height="20"
    viewBox="0 0 20 20"
    aria-hidden="true"
    focusable="false"
    fill="currentColor"
  >
    {p.children}
  </svg>
);
const Bar = ({ x }: { x: number }) => <rect x={x} y="3" width="2.5" height="14" />;
const Tri = ({ x, left }: { x: number; left?: boolean }) => (
  <path d={left ? `M${x + 7} 3v14L${x} 10z` : `M${x} 3v14l7-7z`} />
);
const FirstIcon = () => (
  <I>
    <Bar x={2} />
    <Tri x={5} left />
    <Tri x={11} left />
  </I>
);
const PrevIcon = () => (
  <I>
    <Bar x={4} />
    <Tri x={8} left />
  </I>
);
const PlayIcon = () => (
  <I>
    <Tri x={5} />
  </I>
);
const PauseIcon = () => (
  <I>
    <rect x="4" y="3" width="4" height="14" />
    <rect x="12" y="3" width="4" height="14" />
  </I>
);
const NextIcon = () => (
  <I>
    <Tri x={5} />
    <Bar x={13.5} />
  </I>
);
const LastIcon = () => (
  <I>
    <Tri x={3} />
    <Tri x={9} />
    <Bar x={15.5} />
  </I>
);

/** |◀ ◀ ▶/❚❚ ▶ ▶| with speed and a scrubber. Every control is at least 44 px. */
export function Stepper(p: StepperProps) {
  const last = p.count - 1;
  return (
    <div class="tr-stepper" role="group" aria-label="Replay controls">
      <div class="tr-stepper-row">
        <button
          type="button"
          class="btn"
          aria-label="First round"
          disabled={p.round <= 0}
          onClick={p.onFirst}
        >
          <FirstIcon />
        </button>
        <button
          type="button"
          class="btn"
          aria-label="Previous round"
          disabled={p.round <= 0}
          onClick={p.onPrev}
        >
          <PrevIcon />
        </button>
        <button
          type="button"
          class="btn btn-primary"
          aria-label={p.playing ? 'Pause' : 'Play'}
          aria-disabled={p.reducedMotion || undefined}
          disabled={p.round >= last && !p.playing}
          onClick={p.onPlayPause}
        >
          {p.playing ? <PauseIcon /> : <PlayIcon />}
          <span class="tr-btn-text">{p.playing ? 'Pause' : 'Play'}</span>
        </button>
        <button
          type="button"
          class="btn"
          aria-label="Next round"
          disabled={p.round >= last}
          onClick={p.onNext}
        >
          <NextIcon />
        </button>
        <button
          type="button"
          class="btn"
          aria-label="Last round"
          disabled={p.round >= last}
          onClick={p.onLast}
        >
          <LastIcon />
        </button>
      </div>
      <div class="tr-stepper-row">
        <label class="tr-scrub">
          <span class="tr-scrub-label">
            Round {p.count ? p.round + 1 : 0} of {p.count}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(last, 0)}
            value={Math.max(p.round, 0)}
            aria-label="Round"
            aria-valuetext={`Round ${p.round + 1} of ${p.count}`}
            onInput={(e) => p.onScrub(Number(e.currentTarget.value))}
          />
        </label>
        <label class="tr-speed">
          <span class="tr-scrub-label">Speed</span>
          <select
            class="input"
            value={p.speed}
            onChange={(e) => p.onSpeed(e.currentTarget.value as SpeedId)}
          >
            {SPEEDS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {p.reducedMotion ? (
        <p class="muted tr-note">
          Autoplay is off because your device asks for reduced motion. Use Next.
        </p>
      ) : null}
    </div>
  );
}
