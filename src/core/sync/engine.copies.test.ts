// Conflict copies through the engine: the copy-id chain contract of sync.md §7.7, rule by rule.
//   1. the id `copyOf` returns goes into `syncMeta.copies`;
//   2. a loser is skipped when any id of its chain is in `copies`;
//   3. ... or when an index entry / incoming remote entry of the chain is its copy (`isCopyOf`);
//   4. `taken` holds only chain ids whose live content differs.
//
// KNOWN LIMIT (accepted): a copy is an ordinary record. If the user edits it, another device that
// has not seen the edit still holds the old copy, and the two versions of the copy's key resolve
// by the ordinary rules, which may make one more copy (of the copy's losing version) there. Nothing
// is lost; the last test exercises it.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyIdChain, copyOf } from './merge';
import { entryOf } from './fingerprint';
import {
  dump,
  group,
  groupBody,
  makeDevice,
  marks,
  newSpy,
  records,
  userDel,
  userPut,
  worldClock,
  wrapRemote,
  type Dev,
  useIdb,
} from './engine-testkit';
import { createMemoryRemote } from './memory-remote';
import { hlcOf } from './testkit';
import type { SyncEntry } from '../contracts/sync';

const IDS = ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc'];

useIdb(() => new IDBFactory());

let clock: () => number;
beforeEach(() => {
  clock = worldClock();
  vi.spyOn(Date, 'now').mockImplementation(() => clock());
});
afterEach(() => vi.restoreAllMocks());

async function trio(idb: boolean) {
  const inner = createMemoryRemote();
  const spy = newSpy();
  const minted = new Set<string>();
  const violations: string[] = [];
  const devs: Dev[] = [];
  for (const id of IDS) {
    devs.push(
      await makeDevice({
        id,
        idb,
        now: clock,
        minted,
        violations,
        remote: wrapRemote(inner, { spy }),
      }),
    );
  }
  const settle = async (rounds = 4): Promise<void> => {
    for (let r = 0; r < rounds; r++)
      for (const d of devs) expect((await d.cycle()).outcome).toBe('ok');
  };
  return { devs, settle, spy, inner, violations };
}

const copiesOf = async (d: Dev): Promise<string[]> =>
  (await d.raw.get<{ v: string[] }>('syncMeta', 'copies'))?.v ?? [];

const idsOf = async (d: Dev): Promise<string[]> => [...(await records(d, 'group')).keys()].sort();

/** x is edited concurrently by a and b (after a shared v0); returns the id of the copy. */
async function conflict(devs: Dev[], settle: () => Promise<void>): Promise<string> {
  const [a, b] = devs as [Dev, Dev, Dev];
  await userPut(a, 'group', group('x', 'v0'));
  await settle();
  await userPut(a, 'group', group('x', 'A'));
  await userPut(b, 'group', group('x', 'B'));
  await settle();
  const ids = (await idsOf(a)).filter((i) => i !== 'x');
  expect(ids).toHaveLength(1);
  return ids[0]!;
}

describe.each([false, true])('copies (idb %s)', (idb) => {
  it('rule 1: the id copyOf returns is stored in syncMeta.copies, with a notice; no other copy exists', async () => {
    const { devs, settle } = await trio(idb);
    const copy = await conflict(devs, settle);
    expect(copy).toMatch(/^x-[0-9a-f]{6}$/);
    const makers = [];
    for (const d of devs) if ((await copiesOf(d)).includes(copy)) makers.push(d);
    expect(makers.length).toBeGreaterThan(0);
    for (const d of makers) {
      const n =
        (await d.raw.get<{ v: { copyId?: string; message: string }[] }>('syncMeta', 'conflicts'))
          ?.v ?? [];
      expect(n.filter((x) => x.copyId === copy)).toHaveLength(1);
      expect(n.find((x) => x.copyId === copy)!.message).toMatch(/was changed on two devices/);
    }
    for (const d of devs) expect(await idsOf(d)).toEqual(['x', copy].sort());
  });

  it('rule 2: a deleted copy stays deleted on every device, also those that never made it', async () => {
    const { devs, settle } = await trio(idb);
    const copy = await conflict(devs, settle);
    const maker = (
      await Promise.all(devs.map(async (d) => ((await copiesOf(d)).includes(copy) ? d : null)))
    ).find(Boolean)!;
    await userDel(maker, 'group', copy);
    await settle(5);
    for (const d of devs) expect(await idsOf(d), d.id).toEqual(['x']);
    // and it stays that way, however long the devices keep syncing
    await settle(5);
    for (const d of devs) expect(await idsOf(d), d.id).toEqual(['x']);
    // the copy id is remembered
    expect(await copiesOf(maker)).toContain(copy);
  });

  it('rule 3: the loser and its copy arrive together on a third device: still one copy', async () => {
    const { devs, settle } = await trio(idb);
    const [a, b, c] = devs as [Dev, Dev, Dev];
    await userPut(a, 'group', group('m', 'v0'));
    await a.cycle();
    await b.cycle();
    await userPut(a, 'group', group('m', 'A'));
    await userPut(b, 'group', group('m', 'B'));
    await a.cycle();
    await b.cycle();
    await a.cycle(); // a now also publishes the copy it made
    // c has never synced: it reads both losers AND the copy in one go
    const r = await c.cycle();
    expect(r.outcome).toBe('ok');
    await settle();
    for (const d of devs) {
      const ids = await idsOf(d);
      expect(
        ids.filter((i) => i !== 'm'),
        d.id,
      ).toHaveLength(1);
    }
  });

  it('rules 3 and 4: an unrelated record at <slug>-<hex6> pushes the copy to the 12-digit id, once', async () => {
    const find = async (): Promise<string> => {
      const w = await trio(idb);
      return conflict(w.devs, w.settle);
    };
    const first = await find();
    clock = worldClock();
    const { devs, settle } = await trio(idb);
    const [a, b, c] = devs as [Dev, Dev, Dev];
    await userPut(a, 'group', group('x', 'v0'));
    await settle();
    await userPut(c, 'group', group(first, 'unrelated'));
    await c.cycle();
    await userPut(a, 'group', group('x', 'A'));
    await userPut(b, 'group', group('x', 'B'));
    await settle();
    const ids = await idsOf(a);
    expect(ids).toHaveLength(3);
    expect(groupBody((await records(a, 'group')).get(first))).toBe('unrelated');
    const longer = ids.find((i) => i !== 'x' && i !== first)!;
    expect(longer.startsWith(first)).toBe(true);
    expect(longer.length).toBe(first.length + 6);
    const snapshot = await dump(a);
    // rule 2/3: it is not remade, not once per cycle and not on devices that never made it
    for (let i = 0; i < 6; i++) await settle(1);
    for (const d of devs) expect(await dump(d)).toBe(snapshot);
    const makers = (
      await Promise.all(devs.map(async (d) => ((await copiesOf(d)).includes(longer) ? d : null)))
    ).filter(Boolean) as Dev[];
    expect(makers.length).toBeGreaterThan(0);
    // `copies` holds the id copyOf returned (the 12-digit one), never the first-choice id
    for (const d of devs) expect(await copiesOf(d)).not.toContain(first);
    // deleting the 12-digit copy keeps it deleted
    await userDel(makers[0]!, 'group', longer);
    await settle(5);
    for (const d of devs) expect(await idsOf(d)).toEqual(['x', first].sort());
  });

  it('every cycle walks the chain of every loser: a stale loser that comes back is not copied again', async () => {
    const { devs, settle, inner } = await trio(idb);
    const [a, b] = devs as [Dev, Dev, Dev];
    const copy = await conflict(devs, settle);
    // a peer lib that still publishes the old, conflicting entry as a maximal one is re-read
    // (its version changes) and folded again; the copy exists, so nothing new is made
    const before = await dump(a);
    const loserLib = (await inner.list()).find((f) => f.name.includes(b.id))!;
    await inner.update(loserLib.id, await inner.download(loserLib.id)); // new version, same content
    await settle(2);
    expect(await dump(a)).toBe(before);
    expect(await idsOf(a)).toEqual(['x', copy].sort());
  });

  it('copies survive a re-seed: the own lib is deleted by hand, nothing is re-copied, a deleted copy stays deleted', async () => {
    const { devs, settle, inner } = await trio(idb);
    const [a] = devs as [Dev, Dev, Dev];
    const copy = await conflict(devs, settle);
    const maker = (
      await Promise.all(devs.map(async (d) => ((await copiesOf(d)).includes(copy) ? d : null)))
    ).find(Boolean)!;
    await userDel(maker, 'group', copy);
    await settle(3);
    const copiesBefore = await copiesOf(maker);
    for (const f of (await inner.list()).filter((f) => f.name.startsWith(`lib.${maker.id}`))) {
      await inner.delete(f.id);
    }
    maker.restart();
    await settle(4);
    expect(await copiesOf(maker)).toEqual(copiesBefore);
    for (const d of devs) expect(await idsOf(d)).toEqual(['x']);
    expect(await marks(a)).toEqual([]);
  });

  it('known limit: a user edit of a copy is never lost, even if another device acts on the old copy', async () => {
    const { devs, settle } = await trio(idb);
    const [a, b] = devs as [Dev, Dev, Dev];
    const copy = await conflict(devs, settle);
    await userPut(a, 'group', group(copy, 'EDITED', 'renamed copy'));
    await userPut(b, 'group', group(copy, 'EDITED-B', 'other rename'));
    await settle(5);
    const bodies = [...(await records(a, 'group')).values()].map(groupBody);
    expect(bodies).toContain('EDITED');
    expect(bodies).toContain('EDITED-B');
    for (const d of devs) expect(await dump(d)).toBe(await dump(a));
    // the contract: copy-of-copy never happens, the edits just became two versions of one key
    for (const id of await idsOf(a))
      expect(id).toMatch(/^x(-[0-9a-f]{6})?([0-9a-f]{6})?$|^x-[0-9a-f]{6}-[0-9a-f]{6}$/);
  });
});

describe('copy id chain (merge.ts contract used by the engine)', () => {
  it('copyOf returns the first chain id that is not taken', async () => {
    const loser = await entryOf(
      'group',
      'x',
      group('x', 'L') as never,
      hlcOf(5, IDS[1]!),
      undefined,
      IDS[1]!,
      1,
    );
    const chain = copyIdChain(loser);
    expect(chain.length).toBeGreaterThan(2);
    const mint = { hlc: hlcOf(6, IDS[0]!), self: IDS[0]!, counter: 1 };
    expect(((await copyOf(loser, new Set(), mint)) as SyncEntry).id).toBe(chain[0]);
    expect(((await copyOf(loser, new Set([chain[0]!]), mint)) as SyncEntry).id).toBe(chain[1]);
  });
});
