// Test-only page for the ChipBoard (board-shots.mjs): a fake host with the tool radiogroup, a
// status line and a thumbnail, theme and wheel from the query string. Not part of the app build.
import { render } from 'preact';
import { useState } from 'preact/hooks';
import type { LayoutSpot } from '@core/contracts/layout';
import { ROULETTE_PRESETS } from '../../rules';
import type { WheelKind } from '../../types';
import { rouletteUi } from '../index';

const params = new URLSearchParams(location.search);
const wheel = (params.get('wheel') ?? 'european') as WheelKind;
document.documentElement.dataset['theme'] = params.get('theme') ?? 'light';
const rules = ROULETTE_PRESETS[wheel];
const initial: LayoutSpot[] =
  params.get('empty') === '1'
    ? []
    : [
        { bet: 'red', chips: 5 },
        { bet: 'straight:17', chips: 2 },
        { bet: 'split:1-4', chips: 1 },
        ...(wheel === 'european' ? [{ bet: 'voisins', chips: 9 }] : []),
      ];

function Host() {
  const [spots, setSpots] = useState<LayoutSpot[]>(initial);
  const [tool, setTool] = useState<'add' | 'remove'>('add');
  const [status, setStatus] = useState('');
  const { ChipBoard } = rouletteUi.chips!;
  const adjust = (bet: string, delta: number) =>
    setSpots((cur) => {
      const n = Math.max(0, (cur.find((s) => s.bet === bet)?.chips ?? 0) + delta);
      if (!cur.some((s) => s.bet === bet)) return n > 0 ? [...cur, { bet, chips: n }] : cur;
      return n === 0
        ? cur.filter((s) => s.bet !== bet)
        : cur.map((s) => (s.bet === bet ? { ...s, chips: n } : s));
    });
  return (
    <main>
      <h1>Roulette chip board</h1>
      <div role="radiogroup" aria-label="Tool" class="tools">
        {(['add', 'remove'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={tool === t}
            id={`tool-${t}`}
            onClick={() => setTool(t)}
          >
            {t === 'add' ? 'Add' : 'Remove'}
          </button>
        ))}
      </div>
      <h2>Board</h2>
      <ChipBoard
        rules={rules}
        spots={spots}
        tool={tool}
        chipValue={null}
        onAdjust={adjust}
        onStatus={setStatus}
      />
      <p id="status" role="status">
        {status}
      </p>
      <p id="count">{spots.reduce((n, s) => n + s.chips, 0)}</p>
      <h2>Thumbnail</h2>
      <div class="thumb">
        <ChipBoard
          rules={rules}
          spots={spots}
          tool="add"
          chipValue={null}
          onAdjust={adjust}
          readOnly
        />
      </div>
    </main>
  );
}

render(<Host />, document.getElementById('root')!);
