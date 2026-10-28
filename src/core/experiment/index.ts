// core/experiment: canonical JSON, sha256 ids, migrate, normalize, share links (owner: core-store).
// WP0 ships throwing stubs with the signatures of harness-data-analysis.md §16.1.
import type {
  DefinitionId,
  ExperimentDefinition,
  Json,
  NormalizeContext,
  NormalizedDefinition,
  NormalizeResult,
  SimKey,
} from '../contracts/experiment';

/** Thrown by `migrateDefinition` for input that is not a definition or is from a newer schema. */
export class DefinitionFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DefinitionFormatError';
  }
}

/** Throws `DefinitionFormatError`. */
export function migrateDefinition(_x: unknown): ExperimentDefinition {
  throw new Error('TODO(core-store)');
}

/** Calls `normalizeStrategy` (reconciliation E2) and the strategy validator. */
export function normalizeDefinition(
  _d: ExperimentDefinition,
  _ctx: NormalizeContext,
): NormalizeResult {
  throw new Error('TODO(core-store)');
}

export function canonicalJson(_v: Json): string {
  throw new Error('TODO(core-store)');
}

export function sha256Hex(_data: string | Uint8Array): Promise<string> {
  throw new Error('TODO(core-store)');
}

export function definitionId(_d: NormalizedDefinition): Promise<DefinitionId> {
  throw new Error('TODO(core-store)');
}

export function simKey(
  _d: NormalizedDefinition,
  _gameVersion: string,
  _coreVersion: string,
): Promise<SimKey> {
  throw new Error('TODO(core-store)');
}

export function encodeShareLink(
  _d: NormalizedDefinition,
): Promise<{ hash: string } | { tooLong: true; chars: number }> {
  throw new Error('TODO(core-store)');
}

export function decodeShareLink(
  _hashParams: URLSearchParams,
): Promise<{ definition: ExperimentDefinition; checksumOk: boolean | null }> {
  throw new Error('TODO(core-store)');
}

export function setPointer(
  _d: NormalizedDefinition,
  _path: string,
  _value: Json,
): ExperimentDefinition {
  throw new Error('TODO(core-store)');
}

export function sweepPathAllowed(_path: string): boolean {
  throw new Error('TODO(core-store)');
}
