// The play session as screen state: persisted to localStorage on every change, with the list of
// finished sessions. Operations read the latest session from a ref, so keys pressed faster than
// Preact re-renders still chain correctly.
import type { Cents } from '@core/contracts/game';
import {
  createSession,
  endSession,
  spin as spinSession,
  topUp as topUpSession,
  type PlayResult,
  type PlayRngSpec,
  type PlaySession,
  type SpinResult,
} from '@core/play';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { rouletteEnv, type RouletteEnv } from './env';
import {
  DEFAULT_BANKROLL,
  HISTORY_KEY,
  SESSION_KEY,
  loadHistory,
  loadSession,
  saveHistory,
  parseHistory,
  parseSession,
  saveSession,
  summarize,
  withSummary,
  type SessionSummary,
} from './store';

export interface NewSessionOptions {
  variant: string;
  bankroll: Cents;
  rng: PlayRngSpec;
}

export interface PlayController {
  session: PlaySession;
  env: RouletteEnv;
  history: SessionSummary[];
  /** The latest session (ahead of `session` between a commit and the next render). */
  current: () => PlaySession;
  /** Runs a bet operation on the latest session; commits it when ok, else returns the refusal. */
  apply: (op: (env: RouletteEnv, s: PlaySession) => PlayResult) => PlayResult;
  spin: () => SpinResult;
  start: (opts: NewSessionOptions) => void;
  topUp: (amount: Cents) => void;
  end: () => void;
}

function fresh(opts: NewSessionOptions): PlaySession {
  return createSession(rouletteEnv(opts.variant), {
    variant: opts.variant,
    bankroll: opts.bankroll,
    rng: opts.rng,
  });
}

export const DEFAULT_SESSION: NewSessionOptions = {
  variant: 'european',
  bankroll: DEFAULT_BANKROLL,
  rng: { kind: 'crypto' },
};

export function usePlaySession(): PlayController {
  const [session, setSession] = useState<PlaySession>(
    () => loadSession() ?? fresh(DEFAULT_SESSION),
  );
  const [history, setHistory] = useState<SessionSummary[]>(loadHistory);
  const ref = useRef(session);
  const env = useMemo(() => rouletteEnv(session.variant), [session.variant]);

  useEffect(() => saveSession(session), [session]);

  // Another tab changed the saved session or history: adopt the newer session (by `updatedAt`;
  // an invalid or removed value is ignored) and the new history list.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SESSION_KEY) {
        const incoming = parseSession(e.newValue);
        if (incoming && incoming.updatedAt > ref.current.updatedAt) {
          ref.current = incoming;
          setSession(incoming);
        }
      } else if (e.key === HISTORY_KEY) {
        setHistory(parseHistory(e.newValue));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const commit = useCallback((s: PlaySession) => {
    ref.current = s;
    setSession(s);
  }, []);

  const remember = useCallback((s: PlaySession) => {
    if (s.stats.spins === 0) return;
    setHistory((h) => {
      const next = withSummary(h, summarize(s));
      saveHistory(next);
      return next;
    });
  }, []);

  const apply = useCallback(
    (op: (env: RouletteEnv, s: PlaySession) => PlayResult): PlayResult => {
      const r = op(rouletteEnv(ref.current.variant), ref.current);
      if (r.ok) commit(r.session);
      return r;
    },
    [commit],
  );

  const spin = useCallback((): SpinResult => {
    const r = spinSession(rouletteEnv(ref.current.variant), ref.current);
    if (r.ok) commit(r.session);
    return r;
  }, [commit]);

  const start = useCallback(
    (opts: NewSessionOptions) => {
      const old = ref.current;
      if (!old.endedAt) remember(endSession(old));
      commit(fresh(opts));
    },
    [commit, remember],
  );

  const topUp = useCallback(
    (amount: Cents) => {
      if (amount > 0) commit(topUpSession(ref.current, amount));
    },
    [commit],
  );

  const end = useCallback(() => {
    if (ref.current.endedAt) return;
    const s = endSession(ref.current);
    remember(s);
    commit(s);
  }, [commit, remember]);

  const current = useCallback(() => ref.current, []);

  return { session, env, history, current, apply, spin, start, topUp, end };
}
