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

/**
 * Sweepable paths (harness-data-analysis.md §13.2): any scalar leaf except `/schema`,
 * `/game/id`, `/run/*` (seed and sessions stay the base's, so every variant shares the streams),
 * `/strategy/schema` and `/strategy/game`. Whether the path exists is checked by `setPointer`.
 */
export function sweepPathAllowed(path: string): boolean {
  const parts = parsePointer(path);
  if (!parts || parts.length === 0) return false;
  if (path === '/schema' || path === '/game/id') return false;
  if (path === '/strategy/schema' || path === '/strategy/game') return false;
  if (parts[0] === 'run') return false;
  return true;
}
