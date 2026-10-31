// Chapter 9, "Open in Define": builds the full ExperimentDefinition of a candidate strategy (the
// $1-minimum table, $5,000, 500 spins, 10,000 sessions, seed 20261031: the setup of the ledger
// rows in data.json), normalizes it and turns it into a Define share link.
import {
  encodeShareLink,
  exportDefinitionFile,
  normalizeDefinition,
  type ExperimentDefinition,
  type NormalizedDefinition,
  type RulesRef,
  type StrategyDefinition,
} from '@core';
import { game } from '../../services/game';
import type { Candidate } from './data';

/** The $1-minimum European table: outside bets from $1, inside bets from $1 in total. */
export const TRY_RULES: RulesRef = {
  preset: 'european',
  overrides: { limits: { outside: { min: 100 }, inside: { minTotal: 100 } } },
};

/** Constants of the setup, in cents and counts (the copy under the buttons quotes them). */
export const TRY_SETUP = {
  bankroll: 500000,
  maxRounds: 500,
  sessions: 10000,
  seed: 20261031,
} as const;

/** The whole experiment a candidate button opens. Stops of a cash-out candidate are strategy rules. */
export function candidateDefinition(c: Candidate): ExperimentDefinition {
  return {
    schema: 1,
    name: c.name,
    game: { id: 'roulette', rules: TRY_RULES },
    strategy: c.strategy as StrategyDefinition,
    session: { bankroll: TRY_SETUP.bankroll, maxRounds: TRY_SETUP.maxRounds },
    run: { sessions: TRY_SETUP.sessions, seed: TRY_SETUP.seed },
  };
}

export type CandidateNormalized =
  { ok: true; definition: NormalizedDefinition } | { ok: false; message: string };

/** Normalizes the candidate with the app's plugin; `message` is the first error. */
export function normalizeCandidate(c: Candidate): CandidateNormalized {
  const res = normalizeDefinition(candidateDefinition(c), {
    plugin: game.plugin,
    resolveStrategyRef: () => undefined,
  });
  if (res.ok) return { ok: true, definition: res.definition };
  return { ok: false, message: res.errors[0]?.message ?? 'unknown problem' };
}

export type CandidateLink =
  | { kind: 'link'; hash: string }
  | { kind: 'file'; chars: number; file: string; filename: string }
  | { kind: 'error'; message: string };

export type ShareEncoder = typeof encodeShareLink;

/** `#/define?d=...&h=...` for a candidate; a file when the link would be too long. */
export async function candidateLink(
  c: Candidate,
  encode: ShareEncoder = encodeShareLink,
): Promise<CandidateLink> {
  const n = normalizeCandidate(c);
  if (!n.ok) return { kind: 'error', message: n.message };
  const r = await encode(n.definition);
  if ('hash' in r) return { kind: 'link', hash: r.hash };
  return {
    kind: 'file',
    chars: r.chars,
    file: exportDefinitionFile(n.definition),
    filename: `${c.id}.definition.json`,
  };
}
