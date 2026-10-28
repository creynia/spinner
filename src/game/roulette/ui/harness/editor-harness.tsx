// Test-only page for the ChipBoard inside the real LayoutEditor (board-shots.mjs): the roulette
// plugin and UI, theme/wheel/empty from the query string, plus a read-only thumbnail. Not part of
// the app build.
import { render } from 'preact';
import type { GamePlugin } from '@core/contracts/game';
import type { LayoutSpot } from '@core/contracts/layout';
import { LayoutEditor } from '@core/ui';
import { ROULETTE_PRESETS } from '../../rules';
import { roulette } from '../../index';
import type { WheelKind } from '../../types';
import { rouletteUi } from '../index';

const params = new URLSearchParams(location.search);
const wheel = (params.get('wheel') ?? 'european') as WheelKind;
document.documentElement.dataset['theme'] = params.get('theme') ?? 'light';
const rules = ROULETTE_PRESETS[wheel];
const initial: LayoutSpot[] = params.get('empty') === '1' ? [] : [{ bet: 'red', chips: 5 }];
const plugin = roulette as unknown as GamePlugin<unknown, unknown, typeof rules, unknown>;

function Host() {
  return (
    <main>
      <h1>Layout editor</h1>
      <LayoutEditor
        plugin={plugin}
        rules={rules}
        ui={{ ...rouletteUi, chips: rouletteUi.chips! }}
        initialSpots={initial}
        name="Rev test"
        variant={wheel}
        chipValue={500}
        bankroll={100_000}
        onSave={() => undefined}
        onClose={() => undefined}
      />
    </main>
  );
}

render(<Host />, document.getElementById('root')!);
