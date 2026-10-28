// What the builder needs to know about the game (all of it from the plugin; nothing roulette-specific).
import type { BetCatalogEntry } from '../../contracts/game';
import type { FactDecl, FactParam, FactSchema, FactType } from '../../contracts/facts';
import type { Diagnostic } from '../../contracts/strategy';
import type { GameUi } from '../game-ui';
import type { BuilderChipsEnv } from '../layout/types';

export interface BuilderEnv {
  facts: FactSchema;
  catalog: readonly BetCatalogEntry[];
  /** The game's resolved rules, passed to its BetPicker. */
  rules: unknown;
  ui: Pick<GameUi, 'BetPicker'>;
  /** "spin", "roll", "hand". */
  roundWord: string;
  /** Strategy unit in cents (for "2 units ($50)"). */
  unit: number;
  /** Extra non-bet targets facts accept (roulette: zero, green). */
  extraTargets?: readonly string[];
  /**
   * Tap-to-place chips (layouts.md §7.2). Absent: the builder is the rows-only builder it was
   * before chips, and its output is byte-for-byte the same.
   */
  chips?: BuilderChipsEnv<unknown>;
  /** The rules preset the table is drawn on ('european'...), written to layouts saved from a stage. */
  chipsVariant?: string;
}

export interface SessionFactDef {
  name: string;
  label: string;
  value: FactType;
  group: 'session';
}
const MONEY: FactType = { type: 'number', unit: 'money', integer: true };
const COUNT: FactType = { type: 'number', unit: 'count', integer: true, min: 0 };
/** Session and strategy facts of every game (strategy.md §8.2). */
export const SESSION_FACT_DEFS: readonly SessionFactDef[] = (
  [
    { name: 'net', label: 'net result', value: MONEY },
    { name: 'bankroll', label: 'cash (off the table)', value: MONEY },
    { name: 'equity', label: 'equity', value: MONEY },
    { name: 'start', label: 'starting bankroll', value: MONEY },
    { name: 'peak', label: 'peak equity', value: MONEY },
    { name: 'drawdown', label: 'drawdown', value: MONEY },
    { name: 'exposure', label: 'on the table', value: MONEY },
    { name: 'wagered', label: 'total wagered', value: MONEY },
    { name: 'lastNet', label: 'last round net', value: MONEY },
    { name: 'round', label: 'round number', value: COUNT },
    { name: 'roundsInStage', label: 'rounds in this stage', value: COUNT },
    { name: 'roundsWagered', label: 'rounds with a bet', value: COUNT },
    { name: 'winStreak', label: 'win streak', value: COUNT },
    { name: 'lossStreak', label: 'loss streak', value: COUNT },
    {
      name: 'lastResult',
      label: 'last result',
      value: { type: 'enum', values: ['win', 'loss', 'push', 'none'] },
    },
  ] as Omit<SessionFactDef, 'group'>[]
).map((d) => ({ ...d, group: 'session' as const }));

export interface FactInfo {
  name: string;
  label: string;
  group: 'session' | 'game';
  value: FactType;
  params: readonly FactParam[];
  scope: 'round' | 'state';
  decl?: FactDecl;
}

export function allFacts(env: BuilderEnv): FactInfo[] {
  const s: FactInfo[] = SESSION_FACT_DEFS.map((d) => ({
    name: d.name,
    label: d.label,
    group: 'session',
    value: d.value,
    params: [],
    scope: d.name === 'lastNet' || d.name === 'lastResult' ? 'round' : 'state',
  }));
  const g: FactInfo[] = env.facts.facts.map((d) => ({
    name: d.name,
    label: d.label,
    group: 'game',
    value: d.value,
    params: d.params ?? [],
    scope: d.scope,
    decl: d,
  }));
  return [...s, ...g];
}

export function factByName(env: BuilderEnv, name: string): FactInfo | undefined {
  return allFacts(env).find((f) => f.name === name);
}

/** Bet label from the catalog, falling back to the id. */
export function betLabel(env: BuilderEnv, id: string): string {
  return env.catalog.find((b) => b.id === id)?.label ?? id;
}

export function money(cents: number): string {
  const neg = cents < 0;
  const a = Math.abs(cents);
  const d = Math.floor(a / 100);
  const c = a % 100;
  const body = `$${d.toLocaleString('en-US')}${c ? `.${String(c).padStart(2, '0')}` : ''}`;
  return neg ? `−${body}` : body;
}

/** Diagnostics attach to the row whose path is a prefix of theirs. */
export function diagsAt(diags: readonly Diagnostic[], path: string): Diagnostic[] {
  return diags.filter((d) => d.path === path || d.path.startsWith(path + '/'));
}
export function diagsExactlyUnder(diags: readonly Diagnostic[], path: string): Diagnostic[] {
  return diagsAt(diags, path);
}

/** A display string for an unknown JSON value (never "[object Object]"). */
export function str(x: unknown, fallback = ''): string {
  return typeof x === 'string'
    ? x
    : typeof x === 'number' || typeof x === 'boolean'
      ? String(x)
      : fallback;
}
