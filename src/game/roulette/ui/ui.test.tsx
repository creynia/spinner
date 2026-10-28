import { cleanup, fireEvent, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layout, RoundOutcome } from '@core/contracts/game';
import { ROULETTE_PRESETS } from '../rules';
import { betDef, catalog, familyOf, fixedBetIds, parseBet } from '../bets';
import { pocketLabels } from '../pockets';
import type { WheelKind } from '../types';
import { BetPicker, OutcomeGlyph, TableView, rouletteUi } from './index';
import { CHIP_R, anchorOf, buildBoard, chipAt, hotZone, labelBox, minTapSize } from './geometry';
import { chipsOf } from './chips';

const WHEELS: WheelKind[] = ['european', 'american', 'triple-zero'];

function setPhone(phone: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: phone && q.includes('max-width'),
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}
beforeEach(() => setPhone(true));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const q = (c: ParentNode, sel: string): Element => {
  const el = c.querySelector(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

function outcome(pocket: string, color?: string): RoundOutcome {
  return {
    net: 0,
    wagered: 0,
    resolutions: [],
    events: [],
    summary: { pocket, color: color ?? null },
  };
}

describe('rouletteUi', () => {
  it('is a GameUi', () => {
    expect(Object.keys(rouletteUi).sort()).toEqual(['BetPicker', 'OutcomeGlyph', 'TableView']);
  });
});

describe.each(WHEELS)('BetPicker on %s', (wheel) => {
  const rules = ROULETTE_PRESETS[wheel];
  const ids = catalog(rules)
    .map((e) => e.id)
    .filter((id) => !id.includes('<'));

  it('reaches every catalog bet and emits its canonical id', { timeout: 60_000 }, () => {
    const picked: string[] = [];
    const { container } = render(<BetPicker rules={rules} onPick={(id) => picked.push(id)} />);
    const calls = ids.filter((id) => familyOf(id) === 'call');
    for (const id of ids.filter((i) => !calls.includes(i))) {
      const before = picked.length;
      if (q(container, 'svg').querySelector(`[data-bet="${id}"]`)) {
        fireEvent.click(q(container, `[data-bet="${id}"]`));
      } else {
        const def = betDef(id, wheel)!;
        fireEvent.click(q(container, `[data-pocket="${pocketLabels(wheel)[def.pockets[0]!]}"]`));
        fireEvent.click(q(container, `[data-bet-row="${id}"]`));
      }
      expect(picked.length, id).toBe(before + 1);
      expect(picked.at(-1)).toBe(id);
      expect(parseBet(id)).toBe(id);
    }
    if (wheel === 'european') {
      fireEvent.click(q(container, '[role=tab]:nth-child(2)'));
      for (const id of calls) {
        fireEvent.click(q(container, `[data-bet="${id}"]`));
        expect(picked.at(-1)).toBe(id);
      }
      // neighbours:<p>:<k>, all 37 x 9
      const out = q(container, 'output');
      const seen = new Set<string>();
      for (const p of pocketLabels('european')) {
        fireEvent.click(q(container, `[data-centre="${p}"]`));
        for (let k = 1; k <= 9; k++) {
          const level = () => Number(/±(\d)/.exec(out.textContent)![1]);
          while (level() < k) fireEvent.click(q(container, '[aria-label="More neighbours"]'));
          while (level() > k) fireEvent.click(q(container, '[aria-label="Fewer neighbours"]'));
          fireEvent.click(q(container, '[data-bet^="neighbours:"]'));
          expect(picked.at(-1)).toBe(`neighbours:${p}:${k}`);
          seen.add(picked.at(-1)!);
        }
      }
      expect(seen.size).toBe(333);
    } else {
      expect(container.querySelectorAll('[role=tab]').length).toBe(2);
      expect(calls).toEqual([]);
    }
    expect(new Set(picked).size).toBe(ids.length + (wheel === 'european' ? 333 : 0));
  });

  it('every inside bet can also be tapped as a fine-pointer hot zone', () => {
    const picked: string[] = [];
    const { container } = render(<BetPicker rules={rules} onPick={(id) => picked.push(id)} />);
    const zoneIds = ids.filter(
      (id) => !['straight', 'even-money', 'dozen', 'column', 'call'].includes(familyOf(id)!),
    );
    for (const id of zoneIds) fireEvent.click(q(container, `[data-zone="${id}"]`));
    expect(picked).toEqual(zoneIds);
  });

  it('types an id or alias and echoes the canonical id', () => {
    const picked: string[] = [];
    const { container } = render(<BetPicker rules={rules} onPick={(id) => picked.push(id)} />);
    const tabs = container.querySelectorAll('[role=tab]');
    fireEvent.click(tabs[tabs.length - 1]!);
    const input = q(container, 'input');
    fireEvent.input(input, { target: { value: '20-17' } });
    expect(q(container, '.rl-echo').textContent).toContain('split:17-20');
    fireEvent.submit(q(container, 'form'));
    expect(picked).toEqual(['split:17-20']);
    fireEvent.input(input, { target: { value: 'voisins' } });
    const button = q(container, 'button[type=submit]') as HTMLButtonElement;
    expect(button.disabled).toBe(wheel !== 'european');
    fireEvent.input(input, { target: { value: 'nonsense' } });
    expect(button.disabled).toBe(true);
  });
});

describe('BetPicker keyboard and focus', () => {
  const rules = ROULETTE_PRESETS.european;
  it('writes a lowercase tabindex on SVG regions (SVG attributes are case-sensitive)', () => {
    const { container } = render(<BetPicker rules={rules} onPick={() => undefined} />);
    for (const g of container.querySelectorAll('svg [role=button]')) {
      expect(g.getAttribute('tabindex')).toBe('0');
      expect(g.hasAttribute('tabIndex')).toBe(false);
    }
  });

  it('opens the sheet from the keyboard, modal, with Tab trapped', () => {
    const { container } = render(<BetPicker rules={rules} onPick={() => undefined} />);
    fireEvent.keyDown(q(container, '[data-pocket="17"]'), { key: 'Enter' });
    const dlg = q(container, '[role=dialog]');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const buttons = [...dlg.querySelectorAll('button')];
    buttons.at(-1)!.focus();
    const ev = fireEvent.keyDown(buttons.at(-1)!, { key: 'Tab' });
    expect(ev).toBe(false); // default prevented: focus wrapped
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('pairs tabs and panel, roves tabindex and moves with the arrow keys', () => {
    const { container } = render(<BetPicker rules={rules} onPick={() => undefined} />);
    const tabs = () => [...container.querySelectorAll<HTMLElement>('[role=tab]')];
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    const panel = q(container, '[role=tabpanel]');
    expect(tabs()[0]!.getAttribute('aria-controls')).toBe(panel.id);
    fireEvent.keyDown(tabs()[0]!, { key: 'ArrowRight' });
    expect(tabs()[1]!.getAttribute('aria-selected')).toBe('true');
    expect(q(container, '[role=tabpanel]').getAttribute('aria-labelledby')).toBe(tabs()[1]!.id);
    fireEvent.keyDown(tabs()[1]!, { key: 'End' });
    expect(tabs()[2]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tabs()[2]!, { key: 'Home' });
    expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true');
  });
});

describe('BetPicker sheet', () => {
  it('lists the twelve inside bets of 17 with a diagram, id and payout, 48 px rows', () => {
    const { container } = render(
      <BetPicker rules={ROULETTE_PRESETS.european} onPick={() => undefined} />,
    );
    fireEvent.click(q(container, '[data-pocket="17"]'));
    const rows = [...container.querySelectorAll('[data-bet-row]')].map((r) =>
      r.getAttribute('data-bet-row'),
    );
    expect(rows).toEqual([
      'straight:17',
      'split:14-17',
      'split:16-17',
      'split:17-18',
      'split:17-20',
      'street:16-17-18',
      'corner:13-14-16-17',
      'corner:14-15-17-18',
      'corner:16-17-19-20',
      'corner:17-18-20-21',
      'sixline:13-14-15-16-17-18',
      'sixline:16-17-18-19-20-21',
    ]);
    expect(container.querySelectorAll('.rl-row svg.rl-mini').length).toBe(rows.length);
    expect(q(container, '[role=dialog]').getAttribute('aria-label')).toBe('Bets on 17');
    fireEvent.keyDown(q(container, '[role=dialog]'), { key: 'Escape' });
    expect(container.querySelector('[role=dialog]')).toBeNull();
  });

  it('marks the current value', () => {
    const { container } = render(
      <BetPicker rules={ROULETTE_PRESETS.european} value="red" onPick={() => undefined} />,
    );
    expect(q(container, '[data-bet="red"]').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll('.rl-hl').length).toBe(18);
  });

  it('shows the component chips of call bets and neighbours', () => {
    const { container } = render(
      <BetPicker rules={ROULETTE_PRESETS.european} onPick={() => undefined} />,
    );
    fireEvent.click(q(container, '[role=tab]:nth-child(2)'));
    const comps = (label: string) =>
      [
        ...[...container.querySelectorAll('ul[aria-label]')]
          .find((u) => u.getAttribute('aria-label') === `Chips of ${label}`)!
          .querySelectorAll('li'),
      ].map((li) => li.textContent);
    expect(comps('Tiers du cylindre')).toEqual([
      'split 5-8',
      'split 10-11',
      'split 13-16',
      'split 23-24',
      'split 27-30',
      'split 33-36',
    ]);
    expect(comps('Voisins du zéro')).toContain('trio 0-2-3 ×2');
    fireEvent.click(q(container, '[data-centre="17"]'));
    expect(comps('Neighbours of 17 ±2').sort()).toEqual(['17', '2', '25', '34', '6']);
  });
});

describe('TableView', () => {
  const layout: Layout = [
    { bet: 'red', amount: 2500 },
    { bet: 'straight:17', amount: 100 },
    { bet: 'voisins', amount: 900 },
  ];
  const pending: Layout = [{ bet: 'prison:black', amount: 2500 }];
  const rules = ROULETTE_PRESETS.european;

  it('renders chips with amounts, expanded call bets and pending bets', () => {
    const { container } = render(
      <TableView
        rules={rules}
        layout={layout}
        pending={pending}
        lastOutcome={null}
        highlight={null}
      />,
    );
    const chip = (spot: string, kind = 'bet') =>
      q(container, `[data-spot="${spot}"][data-kind="${kind}"]`);
    expect(chip('red').textContent).toBe('$25');
    expect(chip('straight:17').getAttribute('data-cents')).toBe('100');
    expect(chip('trio:0-2-3').getAttribute('data-cents')).toBe('200');
    expect(chip('corner:25-26-28-29').getAttribute('data-cents')).toBe('200');
    expect(chip('split:4-7').getAttribute('data-cents')).toBe('100');
    expect(chip('black', 'pending').textContent).toContain('prison');
    expect(container.querySelectorAll('.rl-chip').length).toBe(2 + 7 + 1);
    const entries = [...container.querySelectorAll('[data-bet-entry]')].map((e) =>
      e.getAttribute('data-bet-entry'),
    );
    expect(entries).toEqual(['red', 'straight:17', 'voisins', 'prison:black']);
    expect(q(container, 'svg').getAttribute('role')).toBe('img');
  });

  it('sums chips on a shared spot', () => {
    const chips = chipsOf(
      [
        { bet: 'jeu-zero', amount: 400 },
        { bet: 'straight:26', amount: 100 },
      ],
      [],
      'european',
    );
    expect(chips.find((c) => c.spot === 'straight:26')?.cents).toBe(200);
  });

  it('draws the winning pocket, the highlighted bet and the last outcome glyph', () => {
    const { container } = render(
      <TableView
        rules={rules}
        layout={[]}
        lastOutcome={outcome('17', 'black')}
        highlight="split:17-20"
      />,
    );
    expect(q(container, '[data-pocket-dolly]').getAttribute('data-pocket-dolly')).toBe('17');
    const lit = [...container.querySelectorAll('[data-pocket]')]
      .filter((g) => g.querySelector('.rl-hl'))
      .map((g) => g.getAttribute('data-pocket'));
    expect(lit.sort()).toEqual(['17', '20']);
    expect(q(container, '.rl-glyph').getAttribute('aria-label')).toBe('17 black');
    expect(container.textContent).toContain('No bets placed');
  });

  it('is vertical on phones and horizontal on desktop', () => {
    setPhone(true);
    const a = render(<TableView rules={rules} layout={[]} lastOutcome={null} highlight={null} />);
    expect(q(a.container, 'svg').getAttribute('data-orientation')).toBe('portrait');
    a.unmount();
    setPhone(false);
    const b = render(<TableView rules={rules} layout={[]} lastOutcome={null} highlight={null} />);
    expect(q(b.container, 'svg').getAttribute('data-orientation')).toBe('landscape');
  });

  it.each(WHEELS)('lays out the %s zero row', (wheel) => {
    const { container } = render(
      <TableView rules={ROULETTE_PRESETS[wheel]} layout={[]} lastOutcome={null} highlight={null} />,
    );
    const cells = [...container.querySelectorAll('[data-pocket]')].map((g) =>
      g.getAttribute('data-pocket'),
    );
    expect(cells).toEqual(pocketLabelsInDomOrder(wheel));
  });
});

function pocketLabelsInDomOrder(wheel: WheelKind): string[] {
  const zeros =
    wheel === 'european' ? ['0'] : wheel === 'american' ? ['0', '00'] : ['0', '000', '00'];
  return [...zeros, ...Array.from({ length: 36 }, (_, i) => String(i + 1))];
}

describe('OutcomeGlyph', () => {
  it.each([
    ['0', 'green'],
    ['00', 'green'],
    ['000', 'green'],
    ['1', 'red'],
    ['2', 'black'],
    ['36', 'red'],
    ['35', 'black'],
  ])('labels %s as %s in words', (pocket, color) => {
    const { container } = render(<OutcomeGlyph outcome={outcome(pocket)} />);
    const g = q(container, '.rl-glyph');
    expect(g.getAttribute('aria-label')).toBe(`${pocket} ${color}`);
    expect(g.textContent).toBe(`${pocket}${color}`);
  });
});

describe('geometry', () => {
  it.each(WHEELS)('keeps chips off their own label (%s)', (wheel) => {
    for (const o of ['portrait', 'landscape'] as const) {
      const b = buildBoard(wheel, o);
      const spots = [
        ...b.outside.map((x) => x.id),
        ...[...b.pockets.keys()].map((p) => `straight:${p}`),
      ];
      for (const spot of spots)
        for (const pending of [false, true]) {
          const c = chipAt(b, spot, pending)!;
          const l = labelBox(b, spot)!;
          const hit =
            c.x + CHIP_R > l.x &&
            c.x - CHIP_R < l.x + l.w &&
            c.y + CHIP_R > l.y &&
            c.y - CHIP_R < l.y + l.h;
          expect(hit, `${wheel} ${o} ${spot} pending=${pending}`).toBe(false);
        }
    }
  });

  it('puts the triple-zero trio on the zero row edge, outside the 000 cell', () => {
    for (const o of ['portrait', 'landscape'] as const) {
      const b = buildBoard('triple-zero', o);
      const a = anchorOf(b, 'trio:0-00-000')!;
      const z = b.pockets.get('000')!;
      const inside = a.x > z.x && a.x < z.x + z.w && a.y > z.y && a.y < z.y + z.h;
      expect(inside).toBe(false);
    }
  });

  it.each(WHEELS)('keeps every tap target >= 44 px at the reference viewports (%s)', (wheel) => {
    // 390 px phone with 16 px gutters; 844 px landscape with a 180 px rail and 16 px gutters.
    expect(minTapSize(buildBoard(wheel, 'portrait'), 390 - 32)).toBeGreaterThanOrEqual(44);
    expect(minTapSize(buildBoard(wheel, 'landscape'), 844 - 180 - 32)).toBeGreaterThanOrEqual(44);
  });

  it.each(WHEELS)('gives every line bet an anchor and an in-bounds hot zone (%s)', (wheel) => {
    for (const o of ['portrait', 'landscape'] as const) {
      const b = buildBoard(wheel, o);
      for (const id of fixedBetIds(wheel)) {
        const a = anchorOf(b, id);
        expect(a, `${o} ${id}`).not.toBeNull();
        expect(a!.x).toBeGreaterThanOrEqual(b.view.x);
        expect(a!.y).toBeGreaterThanOrEqual(b.view.y);
        expect(a!.x).toBeLessThanOrEqual(b.width);
        expect(a!.y).toBeLessThanOrEqual(b.height);
        const z = hotZone(b, id);
        if (z) {
          expect(z.x).toBeGreaterThanOrEqual(b.view.x);
          expect(z.y).toBeGreaterThanOrEqual(b.view.y);
          expect(z.x + z.w).toBeLessThanOrEqual(b.width);
          expect(z.y + z.h).toBeLessThanOrEqual(b.height);
        } else expect(['straight', 'even-money', 'dozen', 'column']).toContain(familyOf(id));
      }
    }
  });
});
