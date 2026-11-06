import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { createSession, type PlaySession, type SpinRecord } from '@core/play';
import { rouletteEnv } from './env';
import { ResultPanel } from './ResultPanel';
import { StatsPanel } from './StatsPanel';

afterEach(cleanup);

const env = rouletteEnv('european');
const fresh = (): PlaySession =>
  createSession(env, { variant: 'european', bankroll: 100_000, rng: { kind: 'seeded', seed: 7 } });

const rec = (n: number, net: number, cost?: SpinRecord['cost']): SpinRecord => ({
  n,
  bets: [],
  wagered: Math.abs(net),
  net,
  equity: 0,
  expectedLoss: 0,
  summary: { pocket: 7, color: 'red' },
  resolutions: [],
  events: [],
  at: '',
  ...(cost ? { cost } : {}),
});

describe('cost of a win display', () => {
  it('shows dashes on a fresh session and on one saved without the fields', () => {
    const s = fresh();
    delete (s.stats as Partial<typeof s.stats>).lossRun;
    delete (s.stats as Partial<typeof s.stats>).lastWinCost;
    render(<StatsPanel session={s} />);
    expect(screen.getByText('Since last win').nextSibling?.textContent).toBe('–');
    expect(screen.getByText('Cost of last win').nextSibling?.textContent).toBe('–');
  });

  it('shows the run and the last win cost', () => {
    const s = fresh();
    s.stats.lossRun = { amount: 1500, spins: 3 };
    s.stats.lastWinCost = { amount: 20_000, spins: 8, win: 3500 };
    render(<StatsPanel session={s} />);
    expect(screen.getByText('Since last win').nextSibling?.textContent).toBe(
      '$15 over 3 losing spins',
    );
    expect(screen.getByText('Cost of last win').nextSibling?.textContent).toBe(
      '$200 over 8 losing spins (won $35)',
    );
  });

  it('describes a win and a long loss run in the result panel', () => {
    const { container, rerender } = render(
      <ResultPanel log={[rec(79, -2500), rec(80, 3500, { amount: 20_000, spins: 8 })]} />,
    );
    expect(container.querySelector('.play-result-text .muted')?.textContent).toBe(
      'Spin 80 · cost $200 over 8 spins',
    );
    rerender(<ResultPanel log={[rec(78, -5000), rec(79, 0), rec(80, -10_000)]} />);
    expect(container.querySelector('.play-result-text .muted')?.textContent).toBe(
      'Spin 80 · down $150 over 2 spins',
    );
    rerender(<ResultPanel log={[rec(80, -2500)]} />);
    expect(container.querySelector('.play-result-text .muted')?.textContent).toBe(
      'Spin 80 · staked $25',
    );
  });
});
