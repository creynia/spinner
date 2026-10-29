// Renaming a saved definition (the owner's "rename experiments").
//
// An experiment is a `DefinitionRecord`; its runs point at it by `definitionId`. Definitions are
// content-addressed and immutable: `id === sha256(definition)`, name included. A rename is
// metadata: it sets `record.displayName` (and `updatedAt`) and never touches `record.definition`,
// so `definitionId`, `runKey`, run ids and `simKey` stay put and the stored definition still
// hashes to its id. Renaming back to `definition.name` clears `displayName` but keeps
// `displayNameAt` (a tombstone), so merging two copies picks the newer rename.
//
// Names are not snapshotted into runs: `RunMeta` carries no name, and every screen resolves the
// live name through the record (`experimentName`). `loadRun` hands back the record's
// `displayName` next to the definition so results screens and exports can do the same. Run files
// carry `displayName` as an optional field; the importer still hashes `definition` as before.
import type { DefinitionRecord } from '../contracts/experiment';
import type { RunData } from '../contracts/run';
import type { Backend } from './backend';

/** Same cap the Library uses when it derives "Copy of ..." names. */
export const DEFINITION_NAME_MAX = 120;

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/** Trimmed, non-empty, at most `DEFINITION_NAME_MAX` characters. Duplicate names are allowed. */
export function validateDefinitionName(input: string): NameCheck {
  const name = input.trim();
  if (name === '') return { ok: false, error: 'Enter a name.' };
  if (name.length > DEFINITION_NAME_MAX) {
    return { ok: false, error: `Use at most ${DEFINITION_NAME_MAX} characters.` };
  }
  return { ok: true, name };
}

/** `RunData` as loaded from the store: carries the record's `displayName` for screens and exports. */
export type StoredRunData = RunData & { displayName?: string; displayNameAt?: string };

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DAY_MS = 86_400_000;

/** Epoch ms of an ISO time, or null if it is not ISO, unparseable, or over 24 h in the future. */
export function parseNameTime(iso: unknown, now: number = Date.now()): number | null {
  if (typeof iso !== 'string' || !ISO.test(iso)) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) || t > now + DAY_MS ? null : t;
}

/**
 * What to trust from an imported name: a name that fails `validateDefinitionName` is dropped with
 * its time (the definition is kept); a bad time drops both. A time without a name is a tombstone.
 */
export function sanitizeImportedName(
  displayName: unknown,
  displayNameAt: unknown,
  now: number = Date.now(),
): { displayName?: string; displayNameAt?: string } {
  if (displayNameAt === undefined) return {};
  if (parseNameTime(displayNameAt, now) === null || typeof displayNameAt !== 'string') return {};
  if (displayName === undefined) return { displayNameAt };
  if (typeof displayName !== 'string') return {};
  const check = validateDefinitionName(displayName);
  return check.ok ? { displayName: check.name, displayNameAt } : {};
}

/**
 * Merges an incoming name (from a run file) into an existing record: the newer `displayNameAt`
 * wins, a side with a time beats one without, and with no times local wins. Returns the record to
 * store, or null when nothing changes.
 */
export function mergeDisplayName(
  existing: DefinitionRecord,
  incoming: { displayName?: string | undefined; displayNameAt?: string | undefined },
  now: number = Date.now(),
): DefinitionRecord | null {
  const inc = sanitizeImportedName(incoming.displayName, incoming.displayNameAt, now);
  if (inc.displayNameAt === undefined) return null;
  const theirs = parseNameTime(inc.displayNameAt, now) as number;
  const mine = existing.displayNameAt === undefined ? NaN : Date.parse(existing.displayNameAt);
  if (!Number.isNaN(mine) && mine >= theirs) return null;
  const { displayName: _old, ...rest } = existing;
  return {
    ...rest,
    displayNameAt: inc.displayNameAt,
    ...(inc.displayName !== undefined && inc.displayName !== existing.definition.name
      ? { displayName: inc.displayName }
      : {}),
  };
}

export async function renameDefinitionRecord(
  backend: Backend,
  id: string,
  input: string,
  now: () => string = () => new Date().toISOString(),
): Promise<DefinitionRecord> {
  const check = validateDefinitionName(input);
  if (!check.ok) throw new Error(check.error);
  const rec = await backend.get<DefinitionRecord>('definitions', id);
  if (!rec) throw new Error('That experiment no longer exists.');
  const { displayName: _old, ...rest } = rec;
  const at = now();
  const next: DefinitionRecord = {
    ...rest,
    updatedAt: at,
    displayNameAt: at,
    ...(check.name !== rec.definition.name ? { displayName: check.name } : {}),
  };
  await backend.tx(['definitions'], 'readwrite', (t) => t.put('definitions', next));
  return next;
}
