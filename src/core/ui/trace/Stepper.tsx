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
          <span aria-hidden="true">|◀</span>
        </button>
        <button
          type="button"
          class="btn"
          aria-label="Previous round"
          disabled={p.round <= 0}
          onClick={p.onPrev}
        >
          <span aria-hidden="true">◀</span>
        </button>
        <button
          type="button"
          class="btn btn-primary"
          aria-label={p.playing ? 'Pause' : 'Play'}
          aria-disabled={p.reducedMotion || undefined}
          disabled={p.round >= last && !p.playing}
          onClick={p.onPlayPause}
        >
          <span aria-hidden="true">{p.playing ? '❚❚' : '▶'}</span>
        </button>
        <button
          type="button"
          class="btn"
          aria-label="Next round"
          disabled={p.round >= last}
          onClick={p.onNext}
        >
          <span aria-hidden="true">▶</span>
        </button>
        <button
          type="button"
          class="btn"
          aria-label="Last round"
          disabled={p.round >= last}
          onClick={p.onLast}
        >
          <span aria-hidden="true">▶|</span>
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
