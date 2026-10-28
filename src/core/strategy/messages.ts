// English messages for diagnostics, generated from `code` + `params` (strategy.md §9).
import type { Diagnostic, Severity } from '../contracts/strategy';

const TEMPLATES: Record<string, string> = {
  E_INTERNAL: 'internal validator error: {detail}',
  E_SCHEMA_VERSION: 'schema must be 1 (got {got})',
  E_TYPE: 'expected {expected}',
  E_REQUIRED: 'missing required key {key}',
  E_UNKNOWN_KEY: 'unknown key {key}',
  E_ONE_OF: 'does not match exactly one of the allowed forms ({detail})',
  E_ID_FORMAT: '{value} is not a valid {what}',
  E_DUPLICATE_ID: 'duplicate id {value}',
  E_NOT_INTEGER: 'must be an integer',
  E_RANGE: 'out of range: {detail}',
  E_LIMIT: 'limit exceeded: {detail}',
  E_EFFECT_CAP: 'more than 16 effects in one list',
  E_UNKNOWN_STAGE: 'unknown stage {value}',
  E_UNKNOWN_VAR: 'unknown var {value}',
  E_UNKNOWN_PROG: 'unknown progression {value}',
  E_EXTENDS_CYCLE: 'extends cycle through stage {value}',
  E_EXTENDS_DEPTH: 'extends chain deeper than 4',
  E_GOTO_IN_HOOK: 'goto is not allowed in onEnter/onExit',
  E_GOTO_SELF_ALWAYS:
    'goto with reenter to its own stage under an always rule restarts the stage every window',
  E_UNREACHABLE_EFFECT: 'effect is unreachable after goto/stop',
  E_RESERVED_REASON: 'stop reason {value} is reserved',
  E_EXPR_CYCLE: 'progression {value} depends on itself',
  E_DIV_ZERO_LITERAL: 'literal zero divisor or modulus',
  E_HISTORY_BOUND: 'needs at least one of atLeast / atMost',
  E_PROG_SPEC: 'invalid progression spec: {detail}',
  E_PROG_OP_UNSUPPORTED: 'advance/back is not supported on {value}',
  E_PROG_OVERFLOW: 'top amount {value} exceeds 2^31 - 1 cents',
  E_DEFERRED: '{value} is not available in v1',
  E_GAME_MISMATCH: 'strategy is for game {value}, plugin is {plugin}',
  E_UNKNOWN_BET: 'unknown bet {value}',
  E_BET_UNAVAILABLE: 'bet {value} is not available at these rules',
  E_UNKNOWN_FACT: 'unknown fact {value}',
  E_FACT_ARGS: 'bad arguments for fact {value}: {detail}',
  E_FACT_TYPE: 'fact type mismatch: {detail}',
  E_FACT_VALUE: 'value not allowed for this fact: {detail}',
  E_HISTORY_FACT: 'history predicates need a round-scoped fact ({value} is not)',
  E_UNKNOWN_EVENT: 'unknown event {value}',
  E_EVENT_FILTER: 'event {event} does not support filter {value}',
  E_UNKNOWN_ACT: 'unknown action {value}',
  E_PRESS_NON_PERSISTENT: 'press needs a persistent bet ({value} is not)',
  E_REMOVE_CONTRACT: 'cannot remove contract bet {value}',
  E_UNKNOWN_LIMIT_CLASS: '{value} is neither a bet nor a limit class',
  E_BELOW_MIN: 'constant amount {amount} is below the table minimum {min} for {value}',
  W_UNREACHABLE_STAGE: 'stage {value} is never the target of a goto',
  W_EFFECT_CAP_POSSIBLE: 'worst case is {value} effects in one window (cap 16)',
  W_UNUSED_VAR: 'var {value} is never read',
  W_UNUSED_PROG: 'progression {value} is never read',
  W_TRACK_MISMATCH: 'progression {value} tracks bets that no amount reading it sizes',
  W_PROG_ABOVE_TABLE_MAX: 'progression {value} reaches {amount}, above the table maximum {max}',
  W_BELOW_MIN_POSSIBLE: 'constant amount {amount} may be below the table minimum {min}',
  W_KEEP_NON_PERSISTENT: 'keepOr on non-persistent bet {value} never keeps anything',
  W_NO_LAYOUT: 'the strategy never bets',
  W_NO_EXIT: 'no stop rule and no session stopWin/stopLoss',
  W_UNIT_MIX: 'mixes money and count',
  W_EMPTY_GROUP: 'empty all/any group',
  W_CONST_CONDITION: 'condition compares two literals',
  W_NEEDS_PARENT: 'bet {value} needs one of its parents in the layout',
};

export function message(code: string, params?: Record<string, string | number>): string {
  const t = TEMPLATES[code] ?? code;
  return t.replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? `{${k}}`));
}

export function diagnostic(
  code: string,
  path: string,
  params?: Record<string, string | number>,
): Diagnostic {
  const severity: Severity = code.startsWith('W_') ? 'warning' : 'error';
  const d: Diagnostic = { code, severity, path, message: message(code, params) };
  if (params) d.params = params;
  return d;
}
