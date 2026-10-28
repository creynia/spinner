/**
 * Fact schema contract (strategy.md §8.1) with the decisions.md reconciliation applied (F2).
 *
 * FROZEN. Implemented by every game plugin (`GamePlugin.facts`), consumed by `core/strategy`
 * (validation, compile) and `core/ui` (builder). Imports nothing.
 */

/** A value a fact can take (strategy.md §8.1). */
export type FactValue = number | string | boolean;

/**
 * 'name' or 'name:arg1:arg2'. Reconciliation F2: the **greedy parameter is last**, so arguments
 * containing colons (bet ids such as `split:17-20`) are unambiguous:
 * `lastColor`, `spinsSince:red`, `streak:straight:17`, `count:10:red`, `hits:split:17-20`.
 * The canonical ref (arguments canonicalised, e.g. aliases folded by `bets.parse`) is the key used
 * in traces and diagnostics.
 */
export type FactRef = string;

/** The value type of a fact (strategy.md §8.1). */
export type FactType =
  | {
      type: 'number';
      unit: 'money' | 'count' | 'scalar';
      integer?: boolean;
      min?: number;
      max?: number;
    }
  | { type: 'enum'; values: readonly (string | number)[]; labels?: readonly string[] }
  | { type: 'boolean' };

/**
 * A parameter of a parameterised fact, event or action (strategy.md §8.1 + reconciliation F2).
 *
 * `'target'` (new in F2) is a bet id **or** one of the game's declared extra targets (roulette:
 * `zero`, `green`). `'bet'` accepts bet ids only (`E_UNKNOWN_BET` otherwise). A `'bet'` or
 * `'target'` parameter consumes the rest of the ref when it is the last parameter.
 */
export interface FactParam {
  name: string;
  type: 'number' | 'enum' | 'bet' | 'target';
  values?: readonly (string | number)[]; // enum params
  min?: number; // number params
  max?: number;
}

/** Declaration of one fact (strategy.md §8.1). */
export interface FactDecl {
  /** camelCase, unique across session + game facts (strategy.md §8.2 names are reserved). */
  name: string;
  /** Builder text: 'last colour'. */
  label: string;
  doc: string;
  /** 'round': describes the round just resolved (null at window 0). 'state': current state. */
  scope: 'round' | 'state';
  nullable: boolean;
  /** Parameterised fact, e.g. `spinsSince:<target>`; `count:<n>:<target>` has the target last. */
  params?: FactParam[];
  value: FactType;
}

/** Declaration of one game event (strategy.md §8.1, §8.3). */
export interface EventDecl {
  name: string;
  label: string;
  doc: string;
  params?: FactParam[];
}

/** Declaration of one game decision for the `act` effect (strategy.md §6.11; none for roulette). */
export interface ActionDecl {
  name: string;
  label: string;
  doc: string;
  params?: FactParam[];
}

/**
 * What a plugin publishes about its facts and events (strategy.md §8.1).
 *
 * `bet-won`/`bet-lost`/`bet-push` are derived by the core from resolutions (profit sign) for every
 * game (reconciliation F1); a plugin may list them here for documentation but must not emit them
 * in `RoundOutcome.events`. `prog-cap`/`prog-done` are core-only (strategy.md §8.3).
 */
export interface FactSchema {
  facts: readonly FactDecl[];
  events: readonly EventDecl[];
  actions?: readonly ActionDecl[];
}
