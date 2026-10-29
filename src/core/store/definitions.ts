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

/**
 * Merges an incoming name (from a run file) into an existing record: the newer `displayNameAt`
 * wins, a side with a time beats one without, and with no times local wins. Returns the record to
 * store, or null when nothing changes.
 */
export function mergeDisplayName(
  existing: DefinitionRecord,
  incoming: { displayName?: string | undefined; displayNameAt?: string | undefined },
): DefinitionRecord | null {
  const at = incoming.displayNameAt;
  if (at === undefined) return null;
  if (existing.displayNameAt !== undefined && existing.displayNameAt >= at) return null;
  const { displayName: _old, ...rest } = existing;
  return {
    ...rest,
    displayNameAt: at,
    ...(incoming.displayName !== undefined && incoming.displayName !== existing.definition.name
      ? { displayName: incoming.displayName }
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
