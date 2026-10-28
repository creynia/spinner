import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createInThreadTransport, representativeSessions, simulateOn } from '@core';
import type { RunData } from '@core/contracts/run';
import type { TraceWindow } from '@core/contracts/strategy-trace';
import { EquityLine, TraceList, WindowDetail } from '@core/ui';
import { roulette } from '@game/roulette';
import { rouletteUi } from '@game/roulette/ui';
import { WatchView } from '@app/screens/Watch/WatchView';
import { defaultDeps, type WatchDeps } from '@app/screens/Watch/deps';
import { rouletteRun } from './watch.fixture';

let data: RunData;
const transport = createInThreadTransport(roulette, { hop: 'microtask' });

beforeAll(async () => {
  data = await rouletteRun();
});
afterAll(() => transport.terminate());
afterEach(cleanup);

function deps(over: Partial<WatchDeps> = {}): WatchDeps {
  return {
    ...defaultDeps,
    loadRun: () => Promise.resolve(data),
    simulate: async (def, index, schedule) => {
      const r = await simulateOn(transport, def, index, schedule);
      return { row: r.row, trace: r.trace };
    },
    ...over,
  };
}
const props = (index: string, query = '') => ({
  params: { runId: 'run-watch-test', index },
  query: new URLSearchParams(query),
});
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('Watch: a stored sample of a real roulette session', () => {
  it('renders every window: fired rules, effects, reconcile and desired rows', async () => {
    const sample = data.samples[0]!;
    const { container, getByRole } = render(
      <WatchView {...props(String(sample.index))} deps={deps()} />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-testid=trace-replay]')).not.toBeNull(),
    );
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(sample.trace.some((w) => w.fired.length > 0)).toBe(true);
    const next = getByRole('button', { name: 'Next round' });
    for (let i = 0; i < sample.trace.length; i++) {
      const w = sample.trace[i]!;
      const detail = container.querySelector(`.tr-detail[data-window="${w.w}"]`)!;
      expect(detail, `window ${w.w}`).not.toBeNull();
      const rules = [...detail.querySelectorAll('[data-rule]')].map((e) =>
        e.getAttribute('data-rule'),
      );
      expect(rules).toEqual(w.fired);
      expect(detail.querySelectorAll('.tr-bets > li')).toHaveLength(w.desired.length);
      const rec = detail.querySelector('[data-reconcile]')!.textContent;
      expect(rec).toContain(`${w.reconcile?.rejected.length ?? 0} rejected`);
      expect(rec).toContain(`${w.reconcile?.deferred.length ?? 0} deferred`);
      expect(rec).toContain(`${w.reconcile?.adjusted.length ?? 0} adjusted`);
      for (const e of w.effects)
        expect(detail.querySelector(`[data-rule="${e.rule}"] [data-op="${e.op}"]`)).not.toBeNull();
      if (w.outcome) expect(detail.querySelector('.rl-glyph')).not.toBeNull();
      if (i < sample.trace.length - 1) fireEvent.click(next);
    }
    expect(container.querySelector('.tr-detail')!.getAttribute('data-window')).toBe(
      String(sample.trace.length - 1),
    );
    expect(container.querySelector('.rl-table')).not.toBeNull();
    expect(container.querySelector('svg.tr-equity')).not.toBeNull();
  });

  it('steps with the keyboard, the scrubber and ?round=', async () => {
    const { container, getByRole } = render(<WatchView {...props('0', 'round=3')} deps={deps()} />);
    await waitFor(() => expect(container.querySelector('.tr-replay')).not.toBeNull());
    const cur = () => container.querySelector('.tr-detail')!.getAttribute('data-window');
    expect(cur()).toBe('2');
    fireEvent.keyDown(container.querySelector('.tr-replay')!, { key: 'ArrowRight' });
    expect(cur()).toBe('3');
    fireEvent.keyDown(container.querySelector('.tr-replay')!, { key: 'ArrowLeft' });
    fireEvent.keyDown(container.querySelector('.tr-replay')!, { key: 'Home' });
    expect(cur()).toBe('0');
    fireEvent.input(getByRole('slider', { name: 'Round' }), { target: { value: '7' } });
    expect(cur()).toBe('7');
    fireEvent.keyDown(container.querySelector('.tr-replay')!, { key: 'End' });
    expect(Number(cur())).toBe(data.samples[0]!.trace.length - 1);
  });

  it('plays instantly to the end, and not at all with reduced motion', async () => {
    const { container, getByRole, unmount } = render(
      <WatchView {...props('0', 'speed=instant')} deps={deps()} />,
    );
    await waitFor(() => expect(container.querySelector('.tr-replay')).not.toBeNull());
    fireEvent.click(getByRole('button', { name: 'Play' }));
    await waitFor(() =>
      expect(Number(container.querySelector('.tr-detail')!.getAttribute('data-window'))).toBe(
        data.samples[0]!.trace.length - 1,
      ),
    );
    unmount();
    const mm = vi
      .fn()
      .mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal('matchMedia', mm);
    try {
      const r = render(<WatchView {...props('0', 'speed=instant')} deps={deps()} />);
      await waitFor(() => expect(r.container.querySelector('.tr-replay')).not.toBeNull());
      fireEvent.click(r.getByRole('button', { name: 'Play' }));
      await tick();
      expect(r.container.querySelector('.tr-detail')!.getAttribute('data-window')).toBe('0');
      expect(r.container.textContent).toContain('reduced motion');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Watch: re-simulating any index', () => {
  it('replays a non-sample session exactly and shows no engine-version notice', async () => {
    const stored = new Set(data.samples.map((s) => s.index));
    const index = [...Array(data.sessions).keys()].find((i) => !stored.has(i))!;
    const { container } = render(<WatchView {...props(String(index))} deps={deps()} />);
    await waitFor(() => expect(container.querySelector('.tr-replay')).not.toBeNull());
    expect(container.querySelector('[data-summary]')!.textContent).toContain('re-simulated');
    expect(container.querySelector('[data-mismatch]')).toBeNull();
    expect(container.querySelectorAll('.tr-list li').length).toBeGreaterThan(0);
  });

  it('warns when the re-simulated session differs from the stored row', async () => {
    const d = deps({
      simulate: async (def, index, schedule) => {
        const r = await simulateOn(transport, def, index, schedule);
        return { row: { ...r.row, net: r.row.net + 100 }, trace: r.trace };
      },
    });
    const { container } = render(<WatchView {...props('5')} deps={d} />);
    await waitFor(() => expect(container.querySelector('[data-mismatch]')).not.toBeNull());
    expect(container.querySelector('[data-mismatch]')!.textContent).toContain(
      'different engine version',
    );
  });

  it('refuses to re-simulate across versions but still shows stored samples', async () => {
    const d = deps({ gameVersion: '9.9.9' });
    const a = render(<WatchView {...props('5')} deps={d} />);
    await waitFor(() =>
      expect(a.container.textContent).toContain('only the stored sample sessions'),
    );
    cleanup();
    const b = render(<WatchView {...props(String(data.samples[0]!.index))} deps={d} />);
    await waitFor(() => expect(b.container.querySelector('.tr-replay')).not.toBeNull());
  });

  it('offers best, median and worst', async () => {
    const rep = representativeSessions(data);
    const { container } = render(<WatchView {...props('0')} deps={deps()} />);
    await waitFor(() => expect(container.querySelector('.watch-nav')).not.toBeNull());
    const hrefs = [...container.querySelectorAll('.watch-nav a')].map((a) =>
      a.getAttribute('href'),
    );
    for (const i of [rep.best, rep.median, rep.worst])
      expect(hrefs).toContain(`#/watch/run-watch-test/${i}`);
  });

  it('shows inline cards for an unknown run and a bad index', async () => {
    const a = render(
      <WatchView {...props('0')} deps={deps({ loadRun: () => Promise.resolve(null) })} />,
    );
    await waitFor(() => expect(a.container.textContent).toContain('Run not found'));
    cleanup();
    const b = render(<WatchView {...props('99999')} deps={deps()} />);
    await waitFor(() => expect(b.container.textContent).toContain('No such session'));
    cleanup();
    const c = render(<WatchView {...props('abc')} deps={deps()} />);
    await waitFor(() => expect(c.container.textContent).toContain('No such session'));
  });
});

describe('trace components', () => {
  const win: TraceWindow = {
    w: 4,
    stage: 'mart',
    obs: { net: -5000 },
    prog: { m: { fed: 'loss', state: { k: 2 }, amount: 10000 } },
    fired: ['mart#1'],
    effects: [{ rule: 'mart#1', op: 'bet', detail: { bet: 'red', amount: 10000 } }],
    desired: [
      { bet: 'red', amount: 10000, source: 'layout' },
      { bet: 'straight:17', amount: 99999999, source: 'patch' },
      { bet: 'dozen:1', amount: 5000, source: 'patch' },
      { bet: 'black', amount: 7000, source: 'patch' },
    ],
    reconcile: {
      actions: 2,
      deferred: [{ bet: 'dozen:1', reason: 'wrong phase' }],
      rejected: [{ bet: 'straight:17', reason: 'above table max' }],
      adjusted: [{ bet: 'black', to: 6000, reason: 'reduced' }],
    },
    outcome: {
      summary: { pocket: '17', color: 'black' },
      net: -10000,
      resolutions: [{ bet: 'red', result: 'lose', profit: -10000 }],
    },
    equity: 190000,
  };
  it('never hides a rejected entry; deferred and adjusted carry reasons', () => {
    const { container } = render(
      <WindowDetail
        w={win}
        OutcomeGlyph={rouletteUi.OutcomeGlyph}
        betLabel={(b) => b}
        highlighted={null}
        onHighlight={() => {}}
      />,
    );
    const rej = container.querySelector('li[data-bet="straight:17"]')!;
    expect(rej.getAttribute('data-status')).toBe('rejected');
    expect(rej.textContent).toContain('Rejected: above table max');
    expect(container.querySelector('li[data-bet="dozen:1"]')!.textContent).toContain(
      'Deferred: wrong phase',
    );
    expect(container.querySelector('li[data-bet="black"]')!.textContent).toContain(
      'Adjusted to $60: reduced',
    );
    expect(container.querySelector('[data-reconcile]')!.textContent).toContain(
      '1 rejected · 1 deferred · 1 adjusted',
    );
    expect(container.querySelector('.tr-rejlist')!.textContent).toContain('Rejected straight:17');
  });
  it('lists rejected rounds with a text label', () => {
    const { container } = render(
      <TraceList
        trace={[win]}
        round={0}
        OutcomeGlyph={rouletteUi.OutcomeGlyph}
        onSelect={() => {}}
      />,
    );
    expect(container.querySelector('.tr-tag-rejected')!.textContent).toContain('1 rejected');
    expect(container.querySelector('button[aria-current=step]')).not.toBeNull();
  });
  it('summarises the equity line for screen readers', () => {
    const { container } = render(<EquityLine values={[1000, 1500, 500]} cursor={1} />);
    expect(container.querySelector('svg')!.getAttribute('aria-label')).toMatch(
      /starts .*now .*low .*high/,
    );
  });
});
