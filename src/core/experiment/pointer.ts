import { isChipPath, readStageChips, recompileStageChips } from '../strategy/chips';
import type { ExperimentDefinition, Json, NormalizedDefinition } from '../contracts/experiment';

function parsePointer(path: string): string[] | null {
  if (path === '') return [];
  if (path[0] !== '/') return null;
  const parts = path.slice(1).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (/~(?![01])/.test(p)) return null;
    out.push(p.replace(/~1/g, '/').replace(/~0/g, '~'));
  }
  return out;
}

/**
 * Sets an existing scalar leaf by RFC 6901 pointer on a clone of `d` (no implicit creation in v1).
 * Throws `Error` when the pointer is malformed or does not name an existing scalar leaf.
 */
export function setPointer(
  d: NormalizedDefinition | ExperimentDefinition,
  path: string,
  value: Json,
): ExperimentDefinition {
  const parts = parsePointer(path);
  if (!parts || parts.length === 0) throw new Error(`invalid pointer: ${JSON.stringify(path)}`);
  const clone = structuredClone(d) as unknown as Record<string, unknown>;
  let node: unknown = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    node = child(node, parts[i] as string, path);
  }
  const last = parts[parts.length - 1] as string;
  const old = child(node, last, path);
  if (typeof old === 'object' && old !== null)
    throw new Error(`pointer ${path} is not a scalar leaf`);
  if (Array.isArray(node)) node[Number(last)] = value;
  else (node as Record<string, unknown>)[last] = value;
  return clone as unknown as ExperimentDefinition;
}

function child(node: unknown, key: string, path: string): unknown {
  if (Array.isArray(node)) {
    if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= node.length) {
      throw new Error(`pointer ${path} does not exist`);
    }
    return node[Number(key)];
  }
  if (typeof node === 'object' && node !== null && Object.hasOwn(node, key)) {
    return (node as Record<string, unknown>)[key];
  }
  throw new Error(`pointer ${path} does not exist`);
}

const CHIP_ROW = /^\/strategy\/stages\/(0|[1-9]\d*)\/layout\/(0|[1-9]\d*)(\/|$)/;

const stageOf = (d: ExperimentDefinition, i: number): unknown =>
  'stages' in d.strategy ? d.strategy.stages[i] : undefined;

const rawChips = (stage: unknown): Record<string, unknown> | null => {
  const b =
    typeof stage === 'object' && stage !== null
      ? (stage as Record<string, unknown>)['x-chips']
      : undefined;
  return typeof b === 'object' && b !== null && !Array.isArray(b)
    ? (b as Record<string, unknown>)
    : null;
};

/**
 * Sweepable paths (harness-data-analysis.md §13.2): any scalar leaf except `/schema`,
 * `/game/id`, `/run/*` (seed and sessions stay the base's, so every variant shares the streams),
 * `/strategy/schema` and `/strategy/game`. Layouts (layouts.md §8.1): every `x-` path is denied
 * except a stage's chip value; with `def`, the compiled chip rows of a chip stage are denied too and
 * the chip value must be a numeric denomination. Whether the path exists is checked by `setPointer`.
 */
export function sweepPathAllowed(
  path: string,
  def?: NormalizedDefinition | ExperimentDefinition,
): boolean {
  const parts = parsePointer(path);
  if (!parts || parts.length === 0) return false;
  if (path === '/schema' || path === '/game/id') return false;
  if (path === '/strategy/schema' || path === '/strategy/game') return false;
  if (parts[0] === 'run') return false;
  const chip = isChipPath(path);
  if (chip) {
    if (!def) return true;
    const b = rawChips(stageOf(def, chip.stage));
    return b !== null && typeof b.chip === 'number';
  }
  if (parts.some((p) => p.startsWith('x-'))) return false;
  if (def) {
    const m = CHIP_ROW.exec(path);
    if (m) {
      const b = rawChips(stageOf(def, Number(m[1])));
      if (b && Array.isArray(b.spots) && Number(m[2]) < b.spots.length) return false;
    }
  }
  return true;
}

/**
 * `setPointer`, then, for a stage's chip value (`isChipPath`), regenerates that stage's chip rows
 * (layouts.md §8.1). A chip value must be whole positive cents; this is checked before recompiling
 * because `recompileStageChips` silently returns the definition unchanged on a bad chip.
 */
export function applySweepValue(
  d: NormalizedDefinition | ExperimentDefinition,
  path: string,
  value: Json,
): ExperimentDefinition {
  const chip = isChipPath(path);
  if (chip && (typeof value !== 'number' || !Number.isInteger(value) || value <= 0))
    throw new Error('chip value must be whole cents');
  const next = setPointer(d, path, value);
  if (!chip) return next;
  if (!('stages' in next.strategy)) throw new Error(`pointer ${path} does not exist`);
  if (!readStageChips(next.strategy.stages[chip.stage]))
    throw new Error('chip value is too large for this layout');
  return { ...next, strategy: recompileStageChips(next.strategy, chip.stage) };
}
