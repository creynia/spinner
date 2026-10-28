// Sweeps (harness-data-analysis.md §13.2): build variants of a definition along one path, create the
// group record, and run the variants one after another on the shared pool. The queue lives at module
// level so it keeps going when the person leaves the screen.
import type {
  DefinitionRecord,
  ExperimentGroup,
  Json,
  NormalizedDefinition,
} from '@core/contracts/experiment';
import { applySweepValue, newRunId, normalizeDefinition, sweepPathAllowed } from '@core';
import { createStore } from '../../state/store';
import { game } from '../../services/game';
import { getController, getCoreRepo, resumeStored, runKeys, startRun } from '../../services/runs';

export const MIN_VALUES = 2;
export const MAX_VALUES = 24;

export interface Leaf {
  path: string;
  value: number | string;
}

const esc = (k: string): string => k.replace(/~/g, '~0').replace(/\//g, '~1');

/** Numeric and string leaves of a definition that a sweep may vary. */
export function leafPaths(def: NormalizedDefinition): Leaf[] {
  const out: Leaf[] = [];
  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'number' || typeof node === 'string') {
      if (
        sweepPathAllowed(path, def) &&
        !['/name', '/notes'].includes(path) &&
        !path.startsWith('/tags')
      )
        out.push({ path, value: node });
    } else if (Array.isArray(node)) node.forEach((x, i) => walk(x, `${path}/${i}`));
    else if (typeof node === 'object' && node !== null)
      for (const [k, v] of Object.entries(node)) walk(v, `${path}/${esc(k)}`);
  };
  walk(def, '');
  return out;
}

/** The picker label of a leaf: the chip value of a stage reads "Stage play: chip value" (layouts.md §8.1). */
export function leafLabel(def: NormalizedDefinition, leaf: Leaf): string {
  const m = /^\/strategy\/stages\/(\d+)\/x-chips\/chip$/.exec(leaf.path);
  const stage = m ? def.strategy.stages[Number(m[1])] : undefined;
  const text = m && stage ? `Stage ${stage.id}: chip value` : leaf.path;
  return `${text} (now ${leaf.value})`;
}

/** Parse "10, 25, 50" (numbers) or "a, b" (strings) the way the current leaf is typed. */
export function parseValues(
  text: string,
  kind: 'number' | 'string',
): { ok: true; values: Json[] } | { ok: false; error: string } {
  const parts = text
    .split(/[,\n;]/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (parts.length < MIN_VALUES || parts.length > MAX_VALUES)
    return { ok: false, error: `Give ${MIN_VALUES} to ${MAX_VALUES} values, separated by commas.` };
  if (kind === 'number') {
    const nums = parts.map(Number);
    if (nums.some((n) => !Number.isFinite(n)))
      return { ok: false, error: 'Every value must be a number.' };
    for (let i = 1; i < nums.length; i++)
      if (!(nums[i]! > nums[i - 1]!))
        return { ok: false, error: 'Numbers must be strictly increasing.' };
    return { ok: true, values: nums };
  }
  if (new Set(parts).size !== parts.length) return { ok: false, error: 'Values must be distinct.' };
  return { ok: true, values: parts };
}

export interface Variant {
  value: Json;
  definition: NormalizedDefinition;
}

/** A swept value as text (values are numbers or strings; anything else is JSON). */
export function showValue(v: Json): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export function variantLabel(path: string, value: Json): string {
  const last = path.split('/').pop() ?? path;
  return `${last}=${showValue(value)}`;
}

export type BuildResult =
  { ok: true; variants: Variant[] } | { ok: false; errors: { value: Json; message: string }[] };

export function buildVariants(
  base: NormalizedDefinition,
  path: string,
  values: Json[],
): BuildResult {
  const errors: { value: Json; message: string }[] = [];
  const variants: Variant[] = [];
  if (!sweepPathAllowed(path, base))
    return { ok: false, errors: [{ value: path, message: 'That path cannot be swept.' }] };
  for (const value of values) {
    try {
      const raw = applySweepValue(base, path, value);
      const res = normalizeDefinition(
        { ...raw, name: `${base.name} · ${variantLabel(path, value)}` },
        { plugin: game.plugin, resolveStrategyRef: () => undefined },
      );
      if (res.ok) variants.push({ value, definition: res.definition });
      else errors.push({ value, message: res.errors[0]?.message ?? 'invalid' });
    } catch (e) {
      errors.push({ value, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, variants };
}

export async function createSweep(
  base: DefinitionRecord,
  path: string,
  values: Json[],
  variants: Variant[],
): Promise<ExperimentGroup> {
  const repo = await getCoreRepo();
  const now = new Date().toISOString();
  const ids: string[] = [];
  for (const v of variants) {
    const { definitionId } = await runKeys(v.definition);
    ids.push(definitionId);
    if (!(await repo.getDefinition(definitionId))) {
      await repo.putDefinition({
        v: 1,
        id: definitionId,
        definition: v.definition,
        createdAt: now,
        updatedAt: now,
        derivedFrom: base.id,
        origin: 'user',
        runIds: [],
      });
    }
  }
  const group: ExperimentGroup = {
    v: 1,
    id: newRunId(base.id),
    kind: 'sweep',
    name: `${base.definition.name} · sweep ${path}`,
    baseDefinitionId: base.id,
    sweep: { path, values },
    variantDefinitionIds: ids,
    runIds: [],
    createdAt: now,
    updatedAt: now,
  };
  await repo.putGroup(group);
  return group;
}

export interface SweepQueueState {
  running: boolean;
  /** Index of the variant being run, or -1. */
  current: number;
  error?: string;
}
export const sweepQueue = createStore<Record<string, SweepQueueState>>({});

const setState = (id: string, s: SweepQueueState): void =>
  sweepQueue.update((all) => ({ ...all, [id]: s }));

const TERMINAL = ['done', 'error', 'cancelled', 'paused'];

/** Run every variant that has no finished run yet, in value order, and record the run ids. */
export async function runSweep(groupId: string): Promise<void> {
  if (sweepQueue.get()[groupId]?.running) return;
  const repo = await getCoreRepo();
  let group = (await repo.listGroups()).find((g) => g.id === groupId);
  if (!group || !group.variantDefinitionIds) return;
  const variantIds = group.variantDefinitionIds;
  setState(groupId, { running: true, current: -1 });
  try {
    for (let i = 0; i < variantIds.length; i++) {
      setState(groupId, { running: true, current: i });
      const rec = await repo.getDefinition(variantIds[i]!);
      if (!rec) throw new Error('A variant definition is missing from the library.');
      const keys = await runKeys(rec.definition);
      const runs = await repo.listRuns();
      const mine = group.runIds[i];
      let runId: string | undefined;
      const done = runs.find((r) => r.simKey === keys.simKey && r.status === 'done');
      if (done) runId = done.runId;
      else if (mine && runs.some((r) => r.runId === mine)) {
        runId = mine;
        const meta = runs.find((r) => r.runId === mine)!;
        if (meta.status !== 'done') await resumeStored(mine);
      } else runId = await startRun(rec.definition);
      const c = getController(runId);
      while (c && !TERMINAL.includes(c.status)) await c.settled();
      if (c && c.status !== 'done') throw new Error(`Variant ${i + 1} stopped (${c.status}).`);
      if (group.runIds[i] !== runId) {
        const runIds: string[] = [...group.runIds];
        runIds[i] = runId;
        group = { ...group, runIds, updatedAt: new Date().toISOString() };
        await repo.putGroup(group);
      }
    }
    setState(groupId, { running: false, current: -1 });
  } catch (e) {
    setState(groupId, {
      running: false,
      current: -1,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
