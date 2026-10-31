// Chapter "try": open a candidate in Define, size your own ladder, and where to
// read the result. The risk notice lives in Settings -> About only (decisions #11): this chapter
// links there and repeats none of it.
import { href } from '../../router';
import type { Chapter } from './content';
import { data } from './data';
import { LadderCalculator } from './LadderCalculator';
import { TryIt } from './TryIt';
import './chapters-7-9.css';

export function ChTry(_props: { chapter: Chapter }) {
  return (
    <div class="research-try">
      <h3>Try a candidate</h3>
      <TryIt candidates={data.candidates} rows={data.rows} />
      <h3>Build your own ladder</h3>
      <LadderCalculator />
      <h3>After you run it</h3>
      <p>
        Analyze names the same numbers in statistical terms: the median net per session is the
        typical session, P(ahead) is the chance of ending ahead, and the mean net is the average.
        Expect the average to be negative whatever you run.
      </p>
      <p>
        <a class="link-tap" href={href('/settings?section=about')}>
          Read the risk notice
        </a>
      </p>
    </div>
  );
}
