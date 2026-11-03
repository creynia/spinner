import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend } from '@core';
import { BUILTIN_LAYOUTS } from '@game/roulette';
import { createBackendRepo, setRepoForTests } from '../../services/db';
import { createSession, type PlayResult, type PlaySession } from '@core/play';
import { rouletteEnv } from './env';
import { Play } from './index';
import {
  HISTORY_KEY,
  SESSION_KEY,
  adjustBet,
  loadHistory,
  loadSession,
  saveSession,
  spotsOfBets,
} from './store';

const env = rouletteEnv('european');
const ok = (r: PlayResult): PlaySession => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.session;
};
const seeded = (seed = 42): PlaySession =>
  createSession(env, { variant: 'european', bankroll: 100_000, rng: { kind: 'seeded', seed } });
const stored = (): PlaySession => loadSession()!;
const q = (s = '') => new URLSearchParams(s);
const button = (name: string | RegExp) => screen.getByRole('button', { name });

beforeEach(() => {
  localStorage.clear();
  location.hash = '#/play';
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('play helpers', () => {
  it('turns board taps into chips of the selected denomination', () => {
    let s = seeded();
    s = ok(adjustBet(env, s, 'red', 1, 2500));
    s = ok(adjustBet(env, s, 'red', 1, 2500));
    expect(s.bets).toEqual([{ bet: 'red', amount: 5000 }]);
    expect(spotsOfBets(s.bets, 100)).toEqual([{ bet: 'red', chips: 50 }]);
    s = ok(adjustBet(env, s, 'red', -1, 2500));
    expect(s.bets).toEqual([{ bet: 'red', amount: 2500 }]);
    // a chip larger than the stake takes the whole bet down
    s = ok(adjustBet(env, s, 'red', -1, 10_000));
    expect(s.bets).toEqual([]);
    expect(adjustBet(env, s, 'red', -1, 500).ok).toBe(false);
  });

  it('round-trips the session through localStorage', () => {
    let s = ok(adjustBet(env, seeded(), 'black', 1, 2500));
    saveSession(s);
    expect(loadSession()).toEqual(s);
    localStorage.setItem(SESSION_KEY, '{"v":2}');
    expect(loadSession()).toBeNull();
    localStorage.setItem(SESSION_KEY, 'not json');
    expect(loadSession()).toBeNull();
    s = seeded();
    saveSession(s);
    expect(loadSession()?.id).toBe(s.id);
  });
});

describe('Play screen', () => {
  it('starts a session with a default bankroll and renders the table', () => {
    render(<Play params={{}} query={q()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Play' })).toBeTruthy();
    expect(stored().bankroll).toBe(100_000);
    expect(screen.getByRole('radiogroup', { name: 'Chip' })).toBeTruthy();
  });

  it('spins, rebets, doubles and undoes, with the same spins for the same seed', () => {
    const s = ok(adjustBet(env, seeded(), 'red', 1, 2500));
    saveSession(s);
    render(<Play params={{}} query={q()} />);

    fireEvent.click(button('Spin'));
    const one = stored();
    expect(one.stats.spins).toBe(1);
    expect(one.bets).toEqual([]);
    expect(one.lastBets).toEqual([{ bet: 'red', amount: 2500 }]);
    expect(screen.getByRole('status').textContent).toMatch(/^\d+ (red|black|green)\. /);

    // Rebet is one tap; Double doubles it; Undo takes the double back.
    fireEvent.click(button(/^Rebet \$25/));
    expect(stored().bets).toEqual([{ bet: 'red', amount: 2500 }]);
    fireEvent.click(button('Double bets'));
    expect(stored().bets).toEqual([{ bet: 'red', amount: 5000 }]);
    fireEvent.click(button('Undo'));
    expect(stored().bets).toEqual([{ bet: 'red', amount: 2500 }]);
    fireEvent.click(button('Clear'));
    expect(stored().bets).toEqual([]);

    // With an empty felt the primary button is "Rebet & spin".
    fireEvent.click(button('Rebet & spin'));
    const two = stored();
    expect(two.stats.spins).toBe(2);
    expect(two.log[1]!.bets).toEqual([{ bet: 'red', amount: 2500 }]);

    // Same seed, same bets: same pockets.
    cleanup();
    saveSession(ok(adjustBet(env, seeded(), 'red', 1, 2500)));
    render(<Play params={{}} query={q()} />);
    fireEvent.click(button('Spin'));
    fireEvent.click(button('Rebet & spin'));
    expect(stored().log.map((r) => r.summary['pocket'])).toEqual(
      two.log.map((r) => r.summary['pocket']),
    );
  });

  it('has keyboard shortcuts: R rebet, D double, U undo, C clear, digits pick a chip, Space spins', () => {
    const s = ok(adjustBet(env, seeded(), 'red', 1, 2500));
    saveSession(s);
    render(<Play params={{}} query={q()} />);
    const key = (k: string, extra: KeyboardEventInit = {}) =>
      fireEvent.keyDown(document.body, { key: k, ...extra });
    key(' ');
    expect(stored().stats.spins).toBe(1);
    key('r');
    expect(stored().bets).toEqual([{ bet: 'red', amount: 2500 }]);
    key('d');
    expect(stored().bets).toEqual([{ bet: 'red', amount: 5000 }]);
    key('z', { ctrlKey: true });
    expect(stored().bets).toEqual([{ bet: 'red', amount: 2500 }]);
    key('c');
    expect(stored().bets).toEqual([]);
    key('u');
    expect(stored().bets).toEqual([{ bet: 'red', amount: 2500 }]);
    key('3');
    expect(
      within(screen.getByRole('radiogroup', { name: 'Chip' })).getByRole('radio', { checked: true })
        .textContent,
    ).toBe('$25');
    key('Enter');
    expect(stored().stats.spins).toBe(2);
  });

  it('blocks the spin with the table minimum shown inline', () => {
    saveSession(ok(adjustBet(env, seeded(), 'red', 1, 500)));
    render(<Play params={{}} query={q()} />);
    expect(screen.getByRole('alert').textContent).toMatch(/minimum|\$25/i);
    expect((button('Spin') as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens #/play?layout=<id> with that layout ready to place', async () => {
    setRepoForTests(createBackendRepo(createMemoryBackend()));
    try {
      const l = BUILTIN_LAYOUTS[0]!;
      render(<Play params={{}} query={q(`layout=${l.id}`)} />);
      const dialog = await waitFor(() => screen.getByRole('dialog'));
      const place = await waitFor(() => {
        const b = [...dialog.querySelectorAll<HTMLButtonElement>('button.btn-primary')].find((x) =>
          /^(Replace bets|Add to table)$/.test(x.textContent ?? ''),
        );
        if (!b || b.disabled) throw new Error('not ready');
        return b;
      });
      fireEvent.click(place);
      const want = l.spots.map((sp) => sp.bet).sort();
      expect(
        stored()
          .bets.map((b) => b.bet)
          .sort(),
      ).toEqual(want);
    } finally {
      setRepoForTests(null);
    }
  });

  it('keeps a summary when the session ends and offers a new one', () => {
    saveSession(ok(adjustBet(env, seeded(), 'red', 1, 2500)));
    render(<Play params={{}} query={q()} />);
    fireEvent.click(button('Spin'));
    fireEvent.click(button('More play actions'));
    fireEvent.click(button(/^Session/));
    fireEvent.click(button('End session'));
    expect(stored().endedAt).toBeTruthy();
    expect(loadHistory()).toHaveLength(1);
    expect((JSON.parse(localStorage.getItem(HISTORY_KEY)!) as { spins: number }[])[0]!.spins).toBe(
      1,
    );
    expect(screen.getByRole('heading', { name: 'Session ended' })).toBeTruthy();
    fireEvent.click(button(/^New session \(/));
    expect(stored().endedAt).toBeUndefined();
    expect(stored().stats.spins).toBe(0);
  });
});
