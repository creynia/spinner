// Fingerprints and entry construction (sync.md §7.2).
import type { Json } from '../contracts/game';
import type { DeviceId, Hlc, SyncEntry, SyncKind, SyncValueByKind } from '../contracts/sync';
import { canonicalJson, definitionId, sha256Hex } from '../experiment';
import { DEVICE_ID_PATTERN, HLC_PATTERN } from '../contracts/sync';
import { HLC_WALL_LIMIT, hlcWall } from './hlc';

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The value that is hashed: volatile fields left out, unknown keys kept. */
export function fingerprintValue(kind: SyncKind, value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (kind === 'setting') {
    const s = isObj(value) ? value : {};
    return { key: s.key, value: s.value } as Json;
  }
  if (!isObj(value)) return value as Json;
  const out: Record<string, unknown> = { ...value };
  if (kind === 'run') {
    delete out.verdict;
    if (isObj(out.extra) && isObj(out.extra.imported)) {
      const imported = { ...out.extra.imported };
      delete imported.importedAt;
      out.extra = { ...out.extra, imported };
    }
    return out as Json;
  }
  delete out.updatedAt;
  if (kind === 'def' && Array.isArray(out.runIds))
    out.runIds = (out.runIds as string[]).slice().sort();
  return out as Json;
}

/** sha256 hex of the canonical fingerprint; `''` for a tombstone (`value === null`). */
export function hashOf(kind: SyncKind, value: unknown): Promise<string> {
  return value === null
    ? Promise.resolve('')
    : sha256Hex(canonicalJson(fingerprintValue(kind, value)));
}

/**
 * Build an entry. `parent` is what the edit descends from (`syncIndex[key]`: its entry's `hlc` and
 * its `seen` join); `counter` is a fresh `syncMeta.vvCounter` value the caller consumed (sync.md
 * §7.4, N1). `basis = parent?.hlc ?? null`; `vv = { ...(parent?.seen ?? {}), [self]: counter }`.
 */
export async function entryOf<K extends SyncKind>(
  kind: K,
  id: string,
  value: SyncValueByKind[K] | null,
  hlc: Hlc,
  parent: { hlc: Hlc; seen: Record<DeviceId, number> } | undefined,
  self: DeviceId,
  counter: number,
): Promise<SyncEntry<K>> {
  if (parent && (parent.seen[self] ?? 0) >= counter) {
    throw new Error(
      `entryOf: counter ${counter} does not exceed parent.seen[${self}] = ${parent.seen[self]}`,
    );
  }
  const raw: unknown = value;
  const v = isObj(raw) && typeof raw.v === 'number' ? raw.v : SUPPORTED_V[kind];
  const entry: SyncEntry<K> = {
    key: `${kind}:${id}`,
    kind,
    id,
    hlc,
    basis: parent?.hlc ?? null,
    vv: { ...(parent?.seen ?? {}), [self]: counter },
    hash: await hashOf(kind, value),
    v,
    value,
  };
  if (value === null) entry.deleted = true;
  return entry;
}

/** The id a record carries inside its value, per kind. */
function innerId(kind: SyncKind, value: unknown): unknown {
  if (!isObj(value)) return undefined;
  return kind === 'setting' ? value.key : kind === 'run' ? value.runId : value.id;
}

export async function verifyEntry(
  e: SyncEntry,
): Promise<'ok' | 'bad-hash' | 'bad-id' | 'unknown-kind' | 'newer'> {
  if (!Object.hasOwn(SUPPORTED_V, e.kind)) return 'unknown-kind';
  if (
    typeof e.id !== 'string' ||
    e.id === '' ||
    e.key !== `${e.kind}:${e.id}` ||
    typeof e.hlc !== 'string' ||
    !HLC_PATTERN.test(e.hlc) ||
    (e.basis !== null && (typeof e.basis !== 'string' || !HLC_PATTERN.test(e.basis))) ||
    !isObj(e.vv) ||
    !Object.entries(e.vv).every(
      ([d, n]) => DEVICE_ID_PATTERN.test(d) && Number.isSafeInteger(n) && n >= 0,
    ) ||
    hlcWall(e.hlc) > HLC_WALL_LIMIT ||
    (e.basis !== null && hlcWall(e.basis) > HLC_WALL_LIMIT) ||
    !Number.isSafeInteger(e.v) ||
    e.v < 1
  ) {
    return 'bad-id';
  }
  if (e.v > SUPPORTED_V[e.kind]) return 'newer';
  if (e.deleted === true) return e.value === null && e.hash === '' ? 'ok' : 'bad-hash';
  if (e.value === null || e.value === undefined || e.hash === '') return 'bad-hash';
  if (innerId(e.kind, e.value) !== e.id) return 'bad-id';
  if (e.kind === 'def') {
    const def = (e.value as SyncValueByKind['def']).definition;
    if (!isObj(def) || (await definitionId(def)) !== e.id) return 'bad-id';
  }
  let hash: string;
  try {
    hash = await hashOf(e.kind, e.value);
  } catch {
    return 'bad-hash'; // not canonicalisable (NaN, Infinity, ...)
  }
  return hash === e.hash ? 'ok' : 'bad-hash';
}

/** Highest record schema `v` per kind this build understands; newer entries are kept opaque. */
export const SUPPORTED_V: Record<SyncKind, number> = {
  def: 1,
  strategy: 1,
  layout: 1,
  group: 1,
  setting: 1,
  run: 1,
};
