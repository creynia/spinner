import { DEFINITION_SCHEMA, type ExperimentDefinition } from '../contracts/experiment';
import { STRATEGY_SCHEMA, type StrategyDefinition } from '../contracts/strategy';

/** Thrown by `migrateDefinition` for input that is not a definition or is from a newer schema. */
export class DefinitionFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DefinitionFormatError';
  }
}

/** `MIGRATIONS[v]` turns a version-`v` document into version `v + 1` (§8.5). */
export type MigrationTable = Record<
  number,
  (x: Record<string, unknown>) => Record<string, unknown>
>;

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * The shared migration loop: applies `table[v]` until `current`. Refuses a missing or invalid
 * version and any version newer than `current`. Works on a structured clone.
 */
export function runMigrations(
  x: unknown,
  current: number,
  table: MigrationTable,
  what: string,
  fail: (message: string) => Error,
  field = 'schema',
): Record<string, unknown> {
  if (!isObject(x)) throw fail(`not ${what}: expected an object`);
  let doc: Record<string, unknown> = structuredClone(x);
  const v0 = doc[field];
  if (typeof v0 !== 'number' || !Number.isInteger(v0) || v0 < 1) {
    throw fail(`not ${what}: missing or invalid ${field}`);
  }
  let v: number = v0;
  if (v > current) throw fail(`${what} made with a newer version (${field} ${v} > ${current})`);
  while (v < current) {
    const step = table[v];
    if (!step) throw fail(`no migration for ${what} ${field} ${v}`);
    doc = step(doc);
    const next = doc[field];
    if (typeof next !== 'number' || next <= v)
      throw fail(`migration of ${what} ${field} ${v} failed`);
    v = next;
  }
  return doc;
}

/** Past definition schemas migrate here. Schema 1 is current, so the table is empty. */
export const DEFINITION_MIGRATIONS: MigrationTable = {};
/** Past strategy schemas migrate here (applied to `definition.strategy`). */
export const STRATEGY_MIGRATIONS: MigrationTable = {};

/** Throws `DefinitionFormatError`. Migrates both `definition.schema` and `strategy.schema`. */
export function migrateDefinition(
  x: unknown,
  tables: {
    definition?: MigrationTable;
    strategy?: MigrationTable;
    current?: number;
    strategyCurrent?: number;
  } = {},
): ExperimentDefinition {
  const fail = (m: string): Error => new DefinitionFormatError(m);
  const doc = runMigrations(
    x,
    tables.current ?? DEFINITION_SCHEMA,
    tables.definition ?? DEFINITION_MIGRATIONS,
    'definition',
    fail,
  );
  const strategy = doc.strategy;
  if (isObject(strategy) && 'schema' in strategy) {
    doc.strategy = runMigrations(
      strategy,
      tables.strategyCurrent ?? STRATEGY_SCHEMA,
      tables.strategy ?? STRATEGY_MIGRATIONS,
      'strategy',
      fail,
    );
  }
  return doc as unknown as ExperimentDefinition;
}

/** Migrates one strategy document to the current strategy schema. */
export function migrateStrategy(x: unknown): StrategyDefinition {
  return runMigrations(
    x,
    STRATEGY_SCHEMA,
    STRATEGY_MIGRATIONS,
    'strategy',
    (m) => new DefinitionFormatError(m),
  ) as unknown as StrategyDefinition;
}
