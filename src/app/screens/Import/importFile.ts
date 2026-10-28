// The import pipeline up to the store (harness-data-analysis.md §10.2), for the Import and Gallery
// screens. Never throws: every failure comes back as a titled, readable problem.
import type { RunData } from '@core/contracts/run';
import type { Repo } from '@core';
import {
  decodeRunBundle,
  definitionId,
  DefinitionFormatError,
  importDefinitionFile,
  isGzip,
  normalizeDefinition,
  decompressBytes,
} from '@core';
import { roulette } from '@game/roulette';
import {
  importLayoutText,
  MAX_LAYOUT_FILE_BYTES,
  type LayoutImportItem,
} from '../../services/layouts';

export const GAME_ID = 'roulette';

export type ImportProblemKind =
  | 'foreign-game'
  | 'newer-version'
  | 'damaged'
  | 'not-spinner'
  | 'library'
  | 'invalid';

export interface ImportProblem {
  kind: ImportProblemKind;
  title: string;
  /** The precise reason from the decoder, shown verbatim. */
  detail: string;
  /** Individual validation errors (definitions), each with its JSON pointer. */
  items?: string[];
}

export type ImportOutcome =
  | {
      ok: true;
      kind: 'run';
      runId: string;
      definitionId: string;
      status: 'imported' | 'exists';
      name: string;
      data: RunData;
    }
  | { ok: true; kind: 'definition'; definitionId: string; name: string }
  | { ok: true; kind: 'layouts'; items: LayoutImportItem[] }
  | { ok: false; problem: ImportProblem };

// core-store's decoder returns message strings only (no error codes), so classification matches
// on their wording; switch to codes if the decoder ever exposes them.
export function classify(message: string): ImportProblem {
  const m = message.toLowerCase();
  const detail = message;
  if (/^this file is a .* run; open it/.test(m) || /this file is a .*(lab|run)/.test(m))
    return { kind: 'foreign-game', title: 'This file is for a different game', detail };
  if (/newer version/.test(m))
    return { kind: 'newer-version', title: 'Made with a newer version of spinner', detail };
  if (/library/.test(m))
    return { kind: 'library', title: 'This is a library backup, not a run', detail };
  if (
    /damaged|digest|does not match|shape|length|decompress|utf-8|not json|samples|columns/.test(m)
  )
    return { kind: 'damaged', title: 'This file is damaged', detail };
  if (/not a spinner/.test(m))
    return { kind: 'not-spinner', title: 'This is not a spinner file', detail };
  return { kind: 'invalid', title: 'Cannot import this file', detail };
}

async function peekFormat(
  bytes: Uint8Array,
): Promise<{ format?: string; schema?: unknown; game?: unknown } | null> {
  try {
    const raw = isGzip(bytes) ? await decompressBytes(bytes, 'gzip', 256 * 1024 * 1024) : bytes;
    const o: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

/** Import a run bundle or a definition file. Runs are stored with `meta.imported` set. */
export async function importBytes(
  bytes: Uint8Array,
  repo: Repo,
  origin: 'import' | 'gallery' = 'import',
): Promise<ImportOutcome> {
  const head = await peekFormat(bytes);
  if (head && head.format === 'casino-lab-layout') return importLayouts(bytes, repo);
  if (head && head.format === undefined && head.schema !== undefined)
    return importDefinition(bytes, repo);
  const r = await decodeRunBundle(bytes, GAME_ID);
  if ('error' in r) return { ok: false, problem: classify(r.error) };
  const res = await repo.importRun(r.data, { origin });
  return {
    ok: true,
    kind: 'run',
    runId: res.runId,
    definitionId: r.data.meta.definitionId,
    status: res.status,
    name: r.data.definition.name,
    data: r.data,
  };
}

async function importLayouts(bytes: Uint8Array, repo: Repo): Promise<ImportOutcome> {
  if (bytes.length > MAX_LAYOUT_FILE_BYTES)
    return {
      ok: false,
      problem: {
        kind: 'invalid',
        title: 'This layout file is too large',
        detail: `layout files are limited to ${MAX_LAYOUT_FILE_BYTES / 1024 / 1024} MB; this one is ${(bytes.length / 1024 / 1024).toFixed(1)} MB`,
      },
    };
  try {
    const raw = isGzip(bytes) ? await decompressBytes(bytes, 'gzip', MAX_LAYOUT_FILE_BYTES) : bytes;
    const r = await importLayoutText(new TextDecoder().decode(raw), repo);
    if (r.ok) return { ok: true, kind: 'layouts', items: r.items };
    return { ok: false, problem: { kind: r.kind, title: r.title, detail: r.detail } };
  } catch {
    return {
      ok: false,
      problem: { kind: 'damaged', title: 'This file is damaged', detail: 'cannot read this file' },
    };
  }
}

async function importDefinition(bytes: Uint8Array, repo: Repo): Promise<ImportOutcome> {
  try {
    const raw = isGzip(bytes) ? await decompressBytes(bytes, 'gzip', 16 * 1024 * 1024) : bytes;
    const def = importDefinitionFile(new TextDecoder().decode(raw));
    if (def.game.id !== GAME_ID)
      return {
        ok: false,
        problem: {
          kind: 'foreign-game',
          title: 'This file is for a different game',
          detail: `this definition is for ${def.game.id}; open it in the ${def.game.id} lab`,
        },
      };
    const res = normalizeDefinition(def, {
      plugin: roulette,
      resolveStrategyRef: () => undefined,
    });
    if (!res.ok)
      return {
        ok: false,
        problem: {
          kind: 'invalid',
          title: 'This definition has errors',
          detail: `${res.errors.length} ${res.errors.length === 1 ? 'error' : 'errors'}`,
          items: res.errors.map((e) => `${e.path || '/'}: ${e.message}`),
        },
      };
    const id = await definitionId(res.definition);
    if (!(await repo.getDefinition(id))) {
      const now = new Date().toISOString();
      await repo.putDefinition({
        v: 1,
        id,
        definition: res.definition,
        createdAt: now,
        updatedAt: now,
        origin: 'import',
        runIds: [],
      });
    }
    return { ok: true, kind: 'definition', definitionId: id, name: res.definition.name };
  } catch (e) {
    if (e instanceof DefinitionFormatError)
      return {
        ok: false,
        problem: { kind: 'invalid', title: 'Cannot read this definition', detail: e.message },
      };
    return {
      ok: false,
      problem: { kind: 'damaged', title: 'This file is damaged', detail: 'cannot read this file' },
    };
  }
}

/** A pasted definition link (`…#/define?d=…`) to the Define address, or null. */
export function definitionLinkTarget(text: string): string | null {
  const t = text.trim();
  const q = t.indexOf('?');
  if (q < 0 || !/[?&]d=/.test(t)) return null;
  const params = new URLSearchParams(t.slice(q + 1).replace(/^#/, ''));
  const d = params.get('d');
  if (!d) return null;
  const h = params.get('h');
  return `#/define?d=${encodeURIComponent(d)}${h ? `&h=${encodeURIComponent(h)}` : ''}`;
}
