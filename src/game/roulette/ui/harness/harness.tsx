// Test-only page for screenshots and axe (shots.mjs): TableView and BetPicker stacked, theme and
// wheel from the query string. Not part of the app build.
import { render } from 'preact';
import { useState } from 'preact/hooks';
import type { Layout, RoundOutcome } from '@core/contracts/game';
import { ROULETTE_PRESETS } from '../../rules';
import type { WheelKind } from '../../types';
import { rouletteUi } from '../index';

const params = new URLSearchParams(location.search);
const wheel = (params.get('wheel') ?? 'european') as WheelKind;
document.documentElement.dataset['theme'] = params.get('theme') ?? 'light';

const rules = ROULETTE_PRESETS[wheel];
const layout: Layout = [
  { bet: 'red', amount: 2500 },
  { bet: 'straight:17', amount: 500 },
  { bet: 'split:14-17', amount: 100 },
  { bet: 'corner:25-26-28-29', amount: 300 },
  { bet: 'dozen:2', amount: 5000 },
  ...(wheel === 'european' ? [{ bet: 'tiers', amount: 600 }] : []),
];
const pending: Layout = wheel === 'european' ? [{ bet: 'prison:black', amount: 2500 }] : [];
const last: RoundOutcome = {
  net: 0,
  wagered: 0,
  resolutions: [],
  events: [],
  summary: { pocket: '17', color: 'black' },
};

function Harness() {
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const { TableView, BetPicker, OutcomeGlyph } = rouletteUi;
  return (
    <main>
      <h1>Roulette UI</h1>
      <div class="wrap">
        <section aria-labelledby="h-table">
          <h2 id="h-table">Table view</h2>
          <TableView
            rules={rules}
            layout={layout}
            pending={pending}
            lastOutcome={last}
            highlight={picked ?? 'split:14-17'}
          />
        </section>
        <section aria-labelledby="h-picker">
          <h2 id="h-picker">Bet picker</h2>
          <BetPicker rules={rules} value={picked} onPick={setPicked} />
          <p id="picked">{picked ?? 'nothing picked'}</p>
        </section>
        <section aria-labelledby="h-glyph">
          <h2 id="h-glyph">Outcomes</h2>
          <OutcomeGlyph outcome={last} />
        </section>
      </div>
    </main>
  );
}

render(<Harness />, document.getElementById('root')!);
