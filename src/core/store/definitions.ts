// Renaming a saved definition (the owner's "rename experiments").
//
// An experiment is a `DefinitionRecord`; its runs point at it by `definitionId`. The id is the hash
// of the whole normalized definition, name included (experiment/ids.ts), but it is only an
// identity: a rename changes `definition.name` in place and NEVER the record id, so `definitionId`,
// `runKey` and every run id (they start with the id) stay put. `simKey` ignores the name anyway.
//
// Names are not snapshotted into runs: `RunMeta` carries no name, and every screen resolves the
// live name through the record (`loadRun` returns `record.definition`). One source of truth.
//
// A renamed record no longer hashes to its own id, which the run-file importer checks. The record
// therefore remembers `idName`, the name the id was minted with; exports write it as
// `definitionIdName` and the importer verifies the hash with it. Exported files keep the name
// they had at export time. (Contract note: `idName` is a store-layer extension of
// `DefinitionRecord`; it should be folded into `contracts/experiment.ts` as an optional field.)
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

/** A stored record: `idName` is set only after a rename (the name the id was hashed with). */
export type StoredDefinitionRecord = DefinitionRecord & { idName?: string };
/** `RunData` as loaded from the store; carries the record's `idName` for exports. */
export type StoredRunData = RunData & { idName?: string };

export async function renameDefinitionRecord(
  backend: Backend,
  id: string,
  input: string,
  now: () => string = () => new Date().toISOString(),
): Promise<DefinitionRecord> {
  const check = validateDefinitionName(input);
  if (!check.ok) throw new Error(check.error);
  const rec = await backend.get<StoredDefinitionRecord>('definitions', id);
  if (!rec) throw new Error('That experiment no longer exists.');
  const { idName: _old, ...rest } = rec;
  const idName = rec.idName ?? rec.definition.name;
  const next: StoredDefinitionRecord = {
    ...rest,
    definition: { ...rec.definition, name: check.name },
    updatedAt: now(),
    ...(idName !== check.name ? { idName } : {}),
  };
  await backend.tx(['definitions'], 'readwrite', (t) => t.put('definitions', next));
  return next;
}
