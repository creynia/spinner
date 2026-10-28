/**
 * Trace format (strategy.md §12) with reconciliation S4 (names `TraceWindow`, `SessionTrace`) and
 * G7 (`reconcile.adjusted`). FROZEN. Imports nothing outside `contracts/`.
 *
 * A trace is a list of `TraceWindow` records, stored as JSON in sample sessions and pinned as JSON
 * Lines (one canonical-JSON record per line, keys sorted) in golden tests. The interpreter fills
 * the strategy part; the harness adds `reconcile`, `outcome` and money.
 */
import type { ProgResult } from './strategy';

export interface TraceWindow {
  /** Window = round index. */
  w: number;
  /** Stage at the start of the window. */
  stage: string;
  /** Present when a goto happened. */
  stageAfter?: string;
  /** Referenced facts only (strategy.md §10.9), canonical keys. */
  obs: Record<string, number | string | boolean | null>;
  /** Every progression, sorted by name. */
  prog: Record<
    string,
    {
      /** Phase 2 input ('unarmed': resolution ignored, strategy.md §7.2). */
      fed: ProgResult | 'unarmed';
      /** Strategy.md §7.6, after phases 2-3. */
      state: Record<string, number | number[]>;
      /** Cents, after phases 2-3. */
      amount: number;
      events?: ('cap' | 'done')[];
    }
  >;
  /** Rule ids in firing order; '@enter:<stage>', '@exit:<stage>' for hooks. */
  fired: string[];
  effects: {
    rule: string;
    /** 'bet' | 'remove' | 'clear' | 'press' | 'set' | ... */
    op: string;
    /** E.g. { bet: 'red', amount: 5000 } or { var: 'x', from: 0, to: 1 }. */
    detail: Record<string, number | string>;
    note?: 'no-op' | 'not-on-table' | 'null-skipped' | 'ignored-skip';
  }[];
  desired: { bet: string; amount: number; parent?: string; source: 'layout' | 'patch' | 'keep' }[];
  dropped?: { bet: string; reason: 'null' | 'zero' | 'negative' }[];
  acts?: { act: string; args?: Record<string, string | number> }[];
  skip?: true;
  stop?: string;
  error?: { code: string; message: string };
  // ---- filled by the harness:
  /** `adjusted` is new (reconciliation G7): amounts clamped, reduced or rounded, shown in Watch. */
  reconcile?: {
    actions: number;
    deferred: { bet: string; reason: string }[];
    rejected: { bet: string; reason: string }[];
    adjusted: { bet: string; to: number; reason: string }[];
  };
  outcome?: {
    summary: Record<string, number | string | boolean>;
    net: number;
    resolutions: { bet: string; result: string; profit: number }[];
  };
  /** After the round (or at the stop). */
  equity: number;
  bust?: true;
}

/** A whole session's trace (reconciliation S4). */
export type SessionTrace = TraceWindow[];
