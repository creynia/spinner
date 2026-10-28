// Layout library service (layouts.md §4.7, §8; WP-L6): list (built-ins merged), save, rename,
// duplicate, delete, export, "used in" and the import path. Every layout is validated with the
// game's context for its variant before any `putLayout`.
import type { DefinitionRecord, StrategyRecord } from '@core/contracts/experiment';
import type { ChipLayout, LayoutRecord } from '@core/contracts/layout';
import type { Diagnostic } from '@core/contracts/strategy';
import {
  allocLayoutId,
  decodeLayoutFile,
  encodeLayoutFile,
  LayoutFileError,
  layoutHash,
  type Repo,
} from '@core';
import { readStageChips, validateChipLayout } from '@core/strategy';
import { BUILTIN_LAYOUTS, resolveRules, RULE_PRESET_IDS } from '@game/roulette';
import { validationContext } from '../screens/Define/doc';
import { libraryRepo, libraryVersion } from '../screens/Define/data';

export const LAYOUT_GAME = 'roulette';
/** Largest layout file the Import screen reads (a 500-layout file is far below this). */
export const MAX_LAYOUT_FILE_BYTES = 1024 * 1024;

export const VARIANTS: readonly { id: string; label: string }[] = RULE_PRESET_IDS.map((id) => ({
  id,
  label: id === 'european' ? 'European' : id === 'american' ? 'American' : 'Triple zero',
}));
export const variantLabel = (id: string): string => VARIANTS.find((v) => v.id === id)?.label ?? id;

const BUILTIN_IDS: ReadonlySet<string> = new Set(BUILTIN_LAYOUTS.map((l) => l.id));
export const isBuiltinId = (id: string): boolean => BUILTIN_IDS.has(id);

/** One row of the Layouts tab. */
export interface LayoutEntry {
  id: string;
  layout: ChipLayout;
  hash: string;
  builtin: boolean;
  record?: LayoutRecord;
  updatedAt?: string;
  usedIn: number;
}

/** Validates against the game and the layout's own variant. Returns the errors only. */
export function layoutErrors(l: unknown): Diagnostic[] {
  const variant = (l as { variant?: unknown } | null)?.variant;
  const known = RULE_PRESET_IDS.some((id) => id === variant);
  if (typeof variant === 'string' && !known) {
    return [
      {
        code: 'E_LAYOUT_SCHEMA',
        severity: 'error',
        path: '/variant',
        message: `invalid layout: there is no ${variant} wheel`,
      },
    ];
  }
  const ctx = known ? validationContext(resolveRules(variant as string)) : null;
  return validateChipLayout(l, ctx).filter((d) => d.severity === 'error');
}

const touch = () => libraryVersion.update((v) => v + 1);

function stageChipSources(stages: unknown): { id: string; builtin: boolean }[] {
  const out: { id: string; builtin: boolean }[] = [];
  if (!Array.isArray(stages)) return out;
  for (const st of stages) {
    const c = readStageChips(st);
    if (c?.from) out.push({ id: c.from.id, builtin: c.from.builtin === true });
  }
  return out;
}

/** How many definitions plus strategies hold a stage copied from each layout (by id and kind). */
export function countUsage(
  definitions: readonly DefinitionRecord[],
  strategies: readonly StrategyRecord[],
): Map<string, { definitions: number; strategies: number }> {
  const m = new Map<string, { definitions: number; strategies: number }>();
  const add = (list: { id: string; builtin: boolean }[], key: 'definitions' | 'strategies') => {
    for (const k of new Set(list.map((x) => `${x.builtin ? 'b' : 'u'}:${x.id}`))) {
      const e = m.get(k) ?? { definitions: 0, strategies: 0 };
      e[key]++;
      m.set(k, e);
    }
  };
  for (const d of definitions) add(stageChipSources(d.definition.strategy?.stages), 'definitions');
  for (const s of strategies) add(stageChipSources(s.strategy?.stages), 'strategies');
  return m;
}

export const usageKey = (id: string, builtin: boolean): string => `${builtin ? 'b' : 'u'}:${id}`;

/** Built-ins first, then the library newest first. */
export async function listLayoutEntries(): Promise<LayoutEntry[]> {
  const repo = await libraryRepo();
  const [records, defs, strats] = await Promise.all([
    repo.listLayouts(),
    repo.listDefinitions(),
    repo.listStrategies(),
  ]);
  const usage = countUsage(defs, strats);
  const used = (id: string, builtin: boolean) => {
    const u = usage.get(usageKey(id, builtin));
    return u ? u.definitions + u.strategies : 0;
  };
  const built = await Promise.all(
    BUILTIN_LAYOUTS.map(async (layout): Promise<LayoutEntry> => ({
      id: layout.id,
      layout,
      hash: await layoutHash(layout),
      builtin: true,
      usedIn: used(layout.id, true),
    })),
  );
  return [
    ...built,
    ...records
      .filter((r) => r.layout.game === LAYOUT_GAME)
      .map((r): LayoutEntry => ({
        id: r.id,
        layout: r.layout,
        hash: r.hash,
        builtin: false,
        record: r,
        updatedAt: r.updatedAt,
        usedIn: used(r.id, false),
      })),
  ];
}

export async function usedInOf(
  id: string,
  builtin: boolean,
): Promise<{ definitions: number; strategies: number }> {
  const repo = await libraryRepo();
  const [d, s] = await Promise.all([repo.listDefinitions(), repo.listStrategies()]);
  return countUsage(d, s).get(usageKey(id, builtin)) ?? { definitions: 0, strategies: 0 };
}

async function takenIds(repo: Repo): Promise<Set<string>> {
  return new Set([...BUILTIN_IDS, ...(await repo.listLayouts()).map((r) => r.id)]);
}

export class LayoutInvalidError extends Error {
  constructor(readonly items: string[]) {
    super(items[0] ?? 'invalid layout');
    this.name = 'LayoutInvalidError';
  }
}

/** Saves (create or overwrite) a validated layout; throws `LayoutInvalidError` and saves nothing. */
export async function saveLayout(
  layout: ChipLayout,
  opts: { origin?: LayoutRecord['origin']; derivedFrom?: string } = {},
): Promise<LayoutRecord> {
  const errors = layoutErrors(layout);
  if (errors.length > 0) throw new LayoutInvalidError(errors.map((e) => `${e.path}: ${e.message}`));
  if (isBuiltinId(layout.id)) throw new LayoutInvalidError(['/id: that id belongs to a built-in']);
  const repo = await libraryRepo();
  const have = await repo.getLayout(layout.id);
  const now = new Date().toISOString();
  const rec: LayoutRecord = {
    v: 1,
    id: layout.id,
    layout,
    hash: await layoutHash(layout),
    createdAt: have?.createdAt ?? now,
    updatedAt: now,
    origin: have?.origin ?? opts.origin ?? 'user',
    ...((have?.derivedFrom ?? opts.derivedFrom)
      ? { derivedFrom: (have?.derivedFrom ?? opts.derivedFrom)! }
      : {}),
  };
  await repo.putLayout(rec);
  touch();
  return rec;
}

/** A new layout from the editor: allocates the id from the name. */
export async function createLayout(
  fields: Pick<ChipLayout, 'name' | 'variant' | 'spots' | 'notes'>,
): Promise<LayoutRecord> {
  const repo = await libraryRepo();
  const id = allocLayoutId(fields.name, await takenIds(repo));
  return saveLayout({ schema: 1, id, game: LAYOUT_GAME, ...fields });
}

export async function renameLayout(id: string, name: string): Promise<LayoutRecord> {
  const rec = await (await libraryRepo()).getLayout(id);
  if (!rec) throw new Error('That layout no longer exists.');
  return saveLayout({ ...rec.layout, name: name.trim() });
}

/** Copies a library or built-in layout under a new id and name "Copy of …". */
export async function duplicateLayout(entry: {
  layout: ChipLayout;
  builtin: boolean;
}): Promise<LayoutRecord> {
  const repo = await libraryRepo();
  const name = `Copy of ${entry.layout.name}`.slice(0, 80);
  const id = allocLayoutId(name, await takenIds(repo));
  return saveLayout(
    { ...entry.layout, id, name },
    { origin: entry.builtin ? 'builtin' : 'user', derivedFrom: entry.layout.id },
  );
}

/** Stages that used it keep their copy. */
export async function deleteLayout(id: string): Promise<void> {
  await (await libraryRepo()).deleteLayout(id);
  touch();
}

const appVersion = (): string => (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0');

export function layoutFileText(layouts: ChipLayout[]): string {
  return encodeLayoutFile(layouts, { id: 'spinner', version: appVersion() });
}
export function layoutFileName(layout: ChipLayout): string {
  return `${layout.id}.layout.json`;
}

// ---------------------------------------------------------------- import (layouts.md §8)

export type LayoutImportItem =
  | { status: 'imported'; id: string; name: string; renamedFrom?: string }
  | { status: 'exists'; id: string; name: string }
  | { status: 'invalid'; name: string; items: string[] };

export type LayoutImportOutcome =
  | { ok: true; items: LayoutImportItem[] }
  | {
      ok: false;
      kind: 'foreign-game' | 'newer-version' | 'damaged' | 'not-spinner' | 'invalid';
      title: string;
      detail: string;
    };

/** Decodes, validates every layout, then saves the good ones; same id and hash is "exists". */
export async function importLayoutText(text: string, repo: Repo): Promise<LayoutImportOutcome> {
  let file;
  try {
    file = decodeLayoutFile(text);
  } catch (e) {
    const code = e instanceof LayoutFileError ? e.code : 'bad-shape';
    const detail = e instanceof Error ? e.message : 'cannot read this file';
    if (code === 'newer-version')
      return {
        ok: false,
        kind: 'newer-version',
        title: 'Made with a newer version of spinner',
        detail,
      };
    if (code === 'wrong-format')
      return { ok: false, kind: 'not-spinner', title: 'This is not a layout file', detail };
    return { ok: false, kind: 'damaged', title: 'This file is damaged', detail };
  }
  const foreign = file.layouts.find(
    (l) => typeof l.game === 'string' && l.game !== '' && l.game !== LAYOUT_GAME,
  );
  if (foreign)
    return {
      ok: false,
      kind: 'foreign-game',
      title: 'This file is for a different game',
      detail: `these layouts are for ${foreign.game}; open them in the ${foreign.game} lab`,
    };
  const taken = await takenIds(repo);
  const items: LayoutImportItem[] = [];
  const seen = new Set<string>();
  for (const l of file.layouts) {
    const name = typeof l.name === 'string' && l.name !== '' ? l.name : 'Untitled layout';
    const errors = layoutErrors(l);
    if (errors.length > 0) {
      items.push({
        status: 'invalid',
        name,
        items: errors.map((e) => `${e.path || '/'}: ${e.message}`),
      });
      continue;
    }
    const hash = await layoutHash(l);
    const dupKey = `${l.id}:${hash}`;
    const have = isBuiltinId(l.id) ? undefined : await repo.getLayout(l.id);
    // Same id and hash (in the library, a built-in, or earlier in this very file): already there.
    const builtin = BUILTIN_LAYOUTS.find((b) => b.id === l.id);
    const builtinSame = builtin !== undefined && (await layoutHash(builtin)) === hash;
    if (seen.has(dupKey) || have?.hash === hash || builtinSame) {
      items.push({ status: 'exists', id: l.id, name });
      continue;
    }
    seen.add(dupKey);
    let id = l.id;
    if (taken.has(id)) id = allocLayoutId(l.id, taken);
    taken.add(id);
    const rec = { ...l, id };
    const errs2 = layoutErrors(rec);
    if (errs2.length > 0) {
      items.push({ status: 'invalid', name, items: errs2.map((e) => `${e.path}: ${e.message}`) });
      continue;
    }
    const now = new Date().toISOString();
    await repo.putLayout({
      v: 1,
      id,
      layout: rec,
      hash,
      createdAt: now,
      updatedAt: now,
      origin: 'import',
    });
    items.push({ status: 'imported', id, name, ...(id !== l.id ? { renamedFrom: l.id } : {}) });
  }
  if (items.some((i) => i.status === 'imported')) touch();
  return { ok: true, items };
}
