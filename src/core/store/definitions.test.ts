import { describe, expect, it } from 'vitest';
import { definitionId, experimentName, runKey, simKey } from '../experiment';
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
  it('is metadata: definition, id, runKey, simKey and run ids stay; the hash still matches', async () => {
    const { repo, id, runId } = await seeded();
    const before = await repo.getRun(runId);
    const rec = await repo.renameDefinition(id, '  Better name ');
    expect(rec.displayName).toBe('Better name');
    expect(experimentName(rec)).toBe('Better name');
    const after = await repo.getDefinition(id);
    expect(after?.id).toBe(id);
    expect(after?.runIds).toEqual([runId]);
    expect(after?.definition).toEqual(run.definition);
    expect(await definitionId(after!.definition)).toBe(id);
    expect(await repo.getRun(runId)).toEqual(before);
    expect((await repo.listRunsOfDefinition(id)).map((r) => r.runId)).toEqual([runId]);
    const m = run.meta;
    expect(await runKey(id, m.gameVersion, m.coreVersion)).toBe(m.runKey);
    expect(await simKey(after!.definition, m.gameVersion, m.coreVersion)).toBe(m.simKey);
  });

  it('resolves the live name: loadRun carries displayName, run meta has no name', async () => {
    const { repo, id, runId } = await seeded();
    await repo.renameDefinition(id, 'Fresh');
    const data = await repo.loadRun(runId);
    expect(data && experimentName(data)).toBe('Fresh');
    expect(data?.definition.name).toBe(run.definition.name);
    expect(JSON.stringify(await repo.getRun(runId))).not.toContain(run.definition.name);
  });

  it('rejects bad names and unknown ids, allows duplicate names', async () => {
    const { repo, id } = await seeded();
    await expect(repo.renameDefinition(id, '  ')).rejects.toThrow();
    await expect(repo.renameDefinition(id, 'x'.repeat(DEFINITION_NAME_MAX + 1))).rejects.toThrow();
    await expect(repo.renameDefinition('0'.repeat(64), 'A')).rejects.toThrow(/no longer exists/);
    expect((await repo.getDefinition(id))?.displayName).toBeUndefined();
    const other = { ...run.definition, name: 'Other', run: { ...run.definition.run, seed: 9 } };
    const oid = await definitionId(other);
    await repo.putDefinition({
      v: 1,
      id: oid,
      definition: other,
      createdAt: 'a',
      updatedAt: 'a',
      origin: 'user',
      runIds: [],
    });
    await repo.renameDefinition(oid, 'Dup');
    await repo.renameDefinition(id, 'Dup');
    expect(
      (await repo.listDefinitions()).map(experimentName).filter((n) => n === 'Dup'),
    ).toHaveLength(2);
  });

  it('renaming back to the definition name clears displayName; double rename works', async () => {
    const { repo, id } = await seeded();
    const a = await repo.getDefinition(id);
    await repo.renameDefinition(id, 'One');
    const two = await repo.renameDefinition(id, 'Two');
    expect(two.displayName).toBe('Two');
    expect(two.createdAt).toBe(a?.createdAt);
    expect(two.updatedAt >= (a?.updatedAt ?? '')).toBe(true);
    const back = await repo.renameDefinition(id, run.definition.name);
    expect('displayName' in back).toBe(false);
    expect(back.displayNameAt).toBeTruthy();
    expect(back.displayNameAt).toBe(back.updatedAt);
    expect(two.displayNameAt).toBeTruthy();
    expect(experimentName(back)).toBe(run.definition.name);
  });
});

describe('exports after a rename', () => {
  it('carries displayName beside the unchanged definition; import on a fresh store keeps it', async () => {
    const { repo, id, runId } = await seeded();
    await repo.renameDefinition(id, 'Renamed once');
    await repo.renameDefinition(id, 'Renamed twice');
    const bytes = await encodeRunBundle((await repo.loadRun(runId))!, { gzip: false });
    const b = plain(bytes);
    expect(b.definitionId).toBe(id);
    expect(b.definition).toEqual(run.definition);
    expect(b.displayName).toBe('Renamed twice');
    const dec = await decodeRunBundle(bytes, 'roulette');
    if ('error' in dec) throw new Error(dec.error);
    expect(dec.data.meta.runKey).toBe(run.meta.runKey);
    const fresh = createRepo(createMemoryBackend());
    await fresh.importRun(dec.data);
    const rec = await fresh.getDefinition(id);
    expect(rec?.displayName).toBe('Renamed twice');
    expect(rec?.definition).toEqual(run.definition);
    // rename back on the fresh store clears it, and the next export has no field
    await fresh.renameDefinition(id, run.definition.name);
    const again = await encodeRunBundle((await fresh.loadRun(dec.data.meta.runId))!, {
      gzip: false,
    });
    expect(plain(again).displayName).toBeUndefined();
  });

  it('keeps the name it had at export time; an unrenamed export has no extra field', async () => {
    const { repo, id, runId } = await seeded();
    const early = await encodeRunBundle((await repo.loadRun(runId))!, { gzip: false });
    await repo.renameDefinition(id, 'After');
    expect(plain(early).displayName).toBeUndefined();
    expect(await decodeRunBundle(early, 'roulette')).toHaveProperty('data');
  });

  async function bundleRenamedAt(name: string, at: string | null) {
    const other = createRepo(createMemoryBackend());
    await other.importRun(run);
    const id = run.meta.definitionId;
    if (name) {
      await other.renameDefinition(id, name);
      const rec = (await other.getDefinition(id))!;
      await other.putDefinition(at ? { ...rec, displayNameAt: at } : rec);
    }
    const bytes = await encodeRunBundle((await other.loadRun(run.meta.runId))!, { gzip: false });
    const dec = await decodeRunBundle(bytes, 'roulette');
    if ('error' in dec) throw new Error(dec.error);
    return { bytes, data: dec.data };
  }
  async function localRenamedAt(name: string, at: string) {
    const { repo, id } = await seeded();
    await repo.renameDefinition(id, name);
    await repo.putDefinition({ ...(await repo.getDefinition(id))!, displayNameAt: at });
    return { repo, id };
  }
  const fresh = (data: Awaited<ReturnType<typeof bundleRenamedAt>>['data']) => ({
    ...data,
    meta: { ...data.meta, runId: `${data.meta.definitionId.slice(0, 16)}-zzzzzzzz` },
  });

  it('import: a newer remote displayNameAt takes the remote name', async () => {
    const { repo, id } = await localRenamedAt('Local', '2026-01-01T00:00:00.000Z');
    const r = await bundleRenamedAt('Remote', '2026-02-01T00:00:00.000Z');
    await repo.importRun(fresh(r.data));
    const rec = await repo.getDefinition(id);
    expect(rec?.displayName).toBe('Remote');
    expect(rec?.displayNameAt).toBe('2026-02-01T00:00:00.000Z');
    expect(rec?.definition).toEqual(run.definition);
  });

  it('import: an older remote displayNameAt keeps the local name', async () => {
    const { repo, id } = await localRenamedAt('Local', '2026-03-01T00:00:00.000Z');
    const r = await bundleRenamedAt('Remote', '2026-02-01T00:00:00.000Z');
    await repo.importRun(fresh(r.data));
    expect((await repo.getDefinition(id))?.displayName).toBe('Local');
  });

  it('import: no times on either side keeps the local name; a timed remote beats an untimed local', async () => {
    const { repo, id } = await seeded();
    await repo.renameDefinition(id, 'Local');
    const { displayNameAt: _a, ...untimed } = (await repo.getDefinition(id))!;
    await repo.putDefinition(untimed);
    const noTime = await bundleRenamedAt('Remote', null);
    const { displayNameAt: _b, ...rest } = noTime.data as typeof noTime.data & {
      displayNameAt?: string;
    };
    await repo.importRun(fresh(rest));
    expect((await repo.getDefinition(id))?.displayName).toBe('Local');
    const timed = await bundleRenamedAt('Remote', '2026-02-01T00:00:00.000Z');
    await repo.importRun(fresh(timed.data));
    expect((await repo.getDefinition(id))?.displayName).toBe('Remote');
  });

  it('import: a newer rename-back tombstone clears the local name, also for an existing run', async () => {
    const { repo, id } = await localRenamedAt('Local', '2026-01-01T00:00:00.000Z');
    const back = await bundleRenamedAt(run.definition.name, '2026-02-01T00:00:00.000Z');
    expect(plain(back.bytes).displayName).toBeUndefined();
    expect(plain(back.bytes).displayNameAt).toBe('2026-02-01T00:00:00.000Z');
    // same runId and digest as a stored run: reported as existing, but the rename still merges
    const same = await repo.importRun(back.data);
    expect(same.status).toBe('exists');
    const rec = await repo.getDefinition(id);
    expect(rec?.displayName).toBeUndefined();
    expect(rec?.displayNameAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('a damaged definition still fails the id check; a trimmed export imports', async () => {
    const { repo, id, runId } = await seeded();
    await repo.renameDefinition(id, 'Temp');
    const b = plain(await encodeRunBundle((await repo.loadRun(runId))!, { gzip: false }));
    b.definition = { ...b.definition, session: { ...b.definition.session, bankroll: 1 } };
    const r = await decodeRunBundle(new TextEncoder().encode(JSON.stringify(b)), 'roulette');
    expect('error' in r && r.error).toContain('definitionId');
    const t = await encodeRunBundle((await repo.loadRun(runId))!, {
      gzip: false,
      trimForGallery: true,
    });
    expect(await decodeRunBundle(t, 'roulette')).toHaveProperty('data');
  });
});
