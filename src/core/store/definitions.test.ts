import { describe, expect, it } from 'vitest';
import { definitionId, runKey, simKey } from '../experiment';
import { makeRun } from './__fixtures__/synth';
import {
  createMemoryBackend,
  createRepo,
  decodeRunBundle,
  DEFINITION_NAME_MAX,
  encodeRunBundle,
  validateDefinitionName,
  type RunBundleV1,
} from './index';

const run = await makeRun({ sessions: 20, maxRounds: 40, chunkSize: 8, samples: 4 });
const plain = (b: Uint8Array): RunBundleV1 =>
  JSON.parse(new TextDecoder().decode(b)) as RunBundleV1;

async function seeded() {
  const repo = createRepo(createMemoryBackend());
  await repo.importRun(run, { origin: 'user' });
  return { repo, id: run.meta.definitionId, runId: run.meta.runId };
}

describe('validateDefinitionName', () => {
  it('trims, requires text, caps the length and allows anything else', () => {
    expect(validateDefinitionName('  Martingale  ')).toEqual({ ok: true, name: 'Martingale' });
    expect(validateDefinitionName('   ').ok).toBe(false);
    expect(validateDefinitionName('').ok).toBe(false);
    expect(validateDefinitionName('x'.repeat(DEFINITION_NAME_MAX)).ok).toBe(true);
    expect(validateDefinitionName('x'.repeat(DEFINITION_NAME_MAX + 1)).ok).toBe(false);
    expect(validateDefinitionName('Ünï ✓ <b>').ok).toBe(true);
  });
});

describe('renameDefinition', () => {
  it('changes only the name: definitionId, runKey, simKey and run ids stay', async () => {
    const { repo, id, runId } = await seeded();
    const before = await repo.getRun(runId);
    const rec = await repo.renameDefinition(id, '  Better name ');
    expect(rec.definition.name).toBe('Better name');
    const after = await repo.getDefinition(id);
    expect(after?.id).toBe(id);
    expect(after?.runIds).toEqual([runId]);
    expect(after?.definition).toEqual({ ...run.definition, name: 'Better name' });
    expect(await repo.getRun(runId)).toEqual(before);
    expect((await repo.listRunsOfDefinition(id)).map((r) => r.runId)).toEqual([runId]);
    // the keys are functions of ids and versions, not of the name
    const m = run.meta;
    expect(await runKey(id, m.gameVersion, m.coreVersion)).toBe(m.runKey);
    expect(await simKey(rec.definition, m.gameVersion, m.coreVersion)).toBe(m.simKey);
    expect(await simKey(run.definition, m.gameVersion, m.coreVersion)).toBe(m.simKey);
    // ... while a content hash of the renamed definition would differ (why the id is pinned)
    expect(await definitionId(rec.definition)).not.toBe(id);
  });

  it('resolves the live name: loadRun has no stale copy, run meta has no name', async () => {
    const { repo, id, runId } = await seeded();
    await repo.renameDefinition(id, 'Fresh');
    expect((await repo.loadRun(runId))?.definition.name).toBe('Fresh');
    expect(JSON.stringify(await repo.getRun(runId))).not.toContain(run.definition.name);
  });

  it('rejects bad names and unknown ids, allows duplicate names', async () => {
    const { repo, id } = await seeded();
    await expect(repo.renameDefinition(id, '  ')).rejects.toThrow();
    await expect(repo.renameDefinition(id, 'x'.repeat(DEFINITION_NAME_MAX + 1))).rejects.toThrow();
    await expect(repo.renameDefinition('0'.repeat(64), 'A')).rejects.toThrow(/no longer exists/);
    expect((await repo.getDefinition(id))?.definition.name).toBe(run.definition.name);
    await repo.renameDefinition(id, run.definition.name); // same name: fine
    const other = { ...run.definition, name: 'Other', run: { ...run.definition.run, seed: 9 } };
    await repo.putDefinition({
      v: 1,
      id: await definitionId(other),
      definition: other,
      createdAt: 'a',
      updatedAt: 'a',
      origin: 'user',
      runIds: [],
    });
    await repo.renameDefinition(await definitionId(other), 'Dup');
    await repo.renameDefinition(id, 'Dup');
    expect((await repo.listDefinitions()).filter((d) => d.definition.name === 'Dup')).toHaveLength(
      2,
    );
  });

  it('bumps updatedAt and keeps createdAt', async () => {
    const { repo, id } = await seeded();
    const a = await repo.getDefinition(id);
    const b = await repo.renameDefinition(id, 'Later');
    expect(b.createdAt).toBe(a?.createdAt);
    expect(b.updatedAt >= (a?.updatedAt ?? '')).toBe(true);
  });
});

describe('exports after a rename', () => {
  it('a renamed run file imports (the id is checked against the name it was minted with)', async () => {
    const { repo, id, runId } = await seeded();
    await repo.renameDefinition(id, 'Renamed once');
    await repo.renameDefinition(id, 'Renamed twice');
    const data = await repo.loadRun(runId);
    const bytes = await encodeRunBundle(data!, { gzip: false });
    const b = plain(bytes);
    expect(b.definitionId).toBe(id);
    expect(b.definition.name).toBe('Renamed twice');
    expect(b.definitionIdName).toBe(run.definition.name);
    const dec = await decodeRunBundle(bytes, 'roulette');
    if ('error' in dec) throw new Error(dec.error);
    expect(dec.data.meta.definitionId).toBe(id);
    expect(dec.data.meta.runKey).toBe(run.meta.runKey);
    // importing on a fresh device keeps the exported name and still round-trips
    const fresh = createRepo(createMemoryBackend());
    await fresh.importRun(dec.data);
    const rec = await fresh.getDefinition(id);
    expect(rec?.definition.name).toBe('Renamed twice');
    const again = await encodeRunBundle((await fresh.loadRun(dec.data.meta.runId))!, {
      gzip: false,
    });
    expect(plain(again).definitionIdName).toBe(run.definition.name);
    expect(await decodeRunBundle(again, 'roulette')).toHaveProperty('data');
  });

  it('keeps the name it had at export time; an unrenamed export has no extra field', async () => {
    const { repo, id, runId } = await seeded();
    const early = await encodeRunBundle((await repo.loadRun(runId))!, { gzip: false });
    await repo.renameDefinition(id, 'After');
    expect(plain(early).definition.name).toBe(run.definition.name);
    expect(plain(early).definitionIdName).toBeUndefined();
    expect(await decodeRunBundle(early, 'roulette')).toHaveProperty('data');
  });

  it('renaming back removes the idName; a damaged definition still fails', async () => {
    const { repo, id, runId } = await seeded();
    await repo.renameDefinition(id, 'Temp');
    await repo.renameDefinition(id, run.definition.name);
    const bytes = await encodeRunBundle((await repo.loadRun(runId))!, { gzip: false });
    expect(plain(bytes).definitionIdName).toBeUndefined();
    await repo.renameDefinition(id, 'Temp');
    const b = plain(await encodeRunBundle((await repo.loadRun(runId))!, { gzip: false }));
    b.definition = { ...b.definition, session: { ...b.definition.session, bankroll: 1 } };
    const r = await decodeRunBundle(new TextEncoder().encode(JSON.stringify(b)), 'roulette');
    expect('error' in r && r.error).toContain('definitionId');
  });

  it('a gallery-trimmed export of a renamed run still imports', async () => {
    const { repo, id, runId } = await seeded();
    await repo.renameDefinition(id, 'Trimmed');
    const bytes = await encodeRunBundle((await repo.loadRun(runId))!, {
      gzip: false,
      trimForGallery: true,
    });
    expect(await decodeRunBundle(bytes, 'roulette')).toHaveProperty('data');
  });
});
