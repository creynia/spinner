/**
 * Experiment definition contract (harness-data-analysis.md §16.1, PLAYBOOK §6) with reconciliation
 * E1-E5 applied. FROZEN. Imports nothing outside `contracts/`.
 *
 * Function signatures of `src/core/experiment` (stubbed in WP0, owned by core-store):
 *   migrateDefinition(x: unknown): ExperimentDefinition              // throws DefinitionFormatError
 *   normalizeDefinition(d, ctx: NormalizeContext): NormalizeResult   // calls normalizeStrategy (E2)
 *   canonicalJson(v: Json): string
 *   sha256Hex(data: string | Uint8Array): Promise<string>
 *   definitionId(d: NormalizedDefinition): Promise<DefinitionId>
 *   simKey(d, gameVersion: string, coreVersion: string): Promise<SimKey>
 *   encodeShareLink(d): Promise<{ hash: string } | { tooLong: true; chars: number }>
 *   decodeShareLink(hashParams: URLSearchParams): Promise<{ definition: ExperimentDefinition; checksumOk: boolean | null }>
 *   setPointer(d, path: string, value: Json): ExperimentDefinition
 *   sweepPathAllowed(path: string, def?: ExperimentDefinition): boolean
 *     Without `def`, only the path rules apply: every `x-` path is denied except a stage's chip value,
 *     `/strategy/stages/<s>/x-chips/chip`. With `def`, the chip-stage rules apply too: the compiled
 *     chip rows (`/strategy/stages/<s>/layout/<i>/amount…`, `i < x-chips.spots.length`) are denied and
 *     the chip value must be a numeric denomination (layouts.md §8.1; implemented by WP-L8).
 *   applySweepValue(d, path: string, value: Json): ExperimentDefinition
 *     `setPointer`, then, when `isChipPath(path)`, `recompileStageChips` of that stage so the generated
 *     rows follow the new chip value (layouts.md §8.1; lives in `core/experiment/pointer.ts`, WP-L8).
 *     For a chip path the value must be whole positive cents; otherwise it is a variant error
 *     ("chip value must be whole cents").
 */
import type { Cents, GamePlugin, Json, RulesRef } from './game';
import type { Diagnostic, StrategyDefinition } from './strategy';

// `Json` and `RulesRef` are declared in game.ts (the plugin's RulesSchema needs them and
// experiment.ts imports game.ts); re-exported here where harness-data-analysis.md §16.1 puts them.
export type { Json, RulesRef };

export const DEFINITION_SCHEMA = 1 as const;

export interface SessionConfig {
  /** 1 ... 100_000_000. */
  bankroll: Cents;
  /** 1 ... 100_000. */
  maxRounds: number;
  /** Stop when equity - bankroll >= stopWin (> 0). */
  stopWin?: Cents;
  /** Stop when bankroll - equity >= stopLoss (> 0). */
  stopLoss?: Cents;
  /** Default: `plugin.pace(rules).roundsPerHour` (normalized: always present; reconciliation G9). */
  roundsPerHour?: number;
}

export interface RunConfig {
  /** 1 ... 100_000. */
  sessions: number;
  /** uint32. */
  seed: number;
  checkpointSchedule?: 'auto' | number[];
  /** 0 ... 100, default 24. */
  sampleSessions?: number;
}

export interface ExperimentDefinition {
  schema: typeof DEFINITION_SCHEMA;
  name: string;
  notes?: string;
  tags?: string[];
  /** `rules` is a preset id or a `RulesRef`; normalization always yields a `RulesRef` (E1). */
  game: { id: string; rules: string | RulesRef };
  strategy: StrategyDefinition | { ref: string };
  session: SessionConfig;
  run: RunConfig;
}

/** Output of `normalizeDefinition`: strategy inlined, rules as RulesRef, defaults explicit. */
export interface NormalizedDefinition extends ExperimentDefinition {
  game: { id: string; rules: RulesRef };
  strategy: StrategyDefinition;
  session: SessionConfig & { roundsPerHour: number };
  run: Required<Pick<RunConfig, 'sessions' | 'seed' | 'checkpointSchedule' | 'sampleSessions'>>;
}

/** 64 lowercase hex, sha256 of the canonical JSON of the normalized definition. */
export type DefinitionId = string;
/** 64 hex; ignores name/notes/tags; includes game and core versions. */
export type SimKey = string;

export interface DefinitionRecord {
  v: 1;
  id: DefinitionId;
  definition: NormalizedDefinition;
  createdAt: string;
  updatedAt: string;
  derivedFrom?: DefinitionId;
  origin: 'user' | 'preset' | 'link' | 'import' | 'gallery';
  runIds: string[];
}

export interface StrategyRecord {
  v: 1;
  id: string;
  strategy: StrategyDefinition;
  hash: string;
  createdAt: string;
  updatedAt: string;
  derivedFrom?: string;
}

export interface SweepSpec {
  path: string;
  values: Json[];
}

export interface ExperimentGroup {
  v: 1;
  id: string;
  kind: 'compare' | 'sweep';
  name: string;
  /** Sweep. */
  baseDefinitionId?: DefinitionId;
  sweep?: SweepSpec;
  /** Sweep, in value order. */
  variantDefinitionIds?: DefinitionId[];
  /** Compare: baseline first. */
  runIds: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * `plugin` is the full `GamePlugin` (reconciliation G4): normalization step 7 runs the strategy
 * validator, which needs `limits`, `compileFact`, `bets.parse` and `facts`.
 */
export interface NormalizeContext {
  plugin: GamePlugin<unknown, unknown, unknown, unknown>;
  resolveStrategyRef(ref: string): StrategyDefinition | undefined;
}

export type NormalizeResult =
  | { ok: true; definition: NormalizedDefinition; warnings: Diagnostic[] }
  | { ok: false; errors: Diagnostic[]; warnings: Diagnostic[] };

export const SHARE_LINK_MAX_CHARS = 8000;
