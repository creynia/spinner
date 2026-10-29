// The merge model (sync.md §7.4, rev 3).
// - B1: the lost update when both devices push before either pulls.
// - Transitive descent; an edit beats a delete.
// - N1: reset, then edit. N2: fold-order independence. N3: the same copy made on two devices.
// - A seeded fuzz at step granularity, with copy-count checks.
import { describe, expect, it } from 'vitest';
import { Device, fold, foldSig, isCopyId, Remote, type Entry } from './model.mts';

function world(n: number) {
  let t = 1000;
  const clock = () => (t += 1);
  const remote = new Remote();
  const devs = Array.from({ length: n }, (_, i) => new Device(`d${i}`, remote, clock));
  const settle = () => {
    for (let r = 0; r < 4; r++) for (const d of devs) (d.pull(), d.push());
  };
  const dump = (d: Device) => JSON.stringify([...d.store].sort(([a], [b]) => (a < b ? -1 : 1)));
  return { devs, remote, settle, dump };
}
const bodies = (d: Device) => [...d.store.values()].map((v) => v.body).sort();

const SEEDS = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.MODEL_SEEDS ?? 100);

describe('merge model', () => {
  it('B1: B pushes without having seen A1: both kept, one copy, same on both', () => {
    const { devs, settle, dump } = world(2);
    const [a, b] = devs as [Device, Device];
    a.edit('x', 'v0');
    a.push();
    b.pull();
    a.edit('x', 'A1');
    b.edit('x', 'B1');
    a.pull();
    b.pull();
    a.push();
    b.push(); // never saw A1
    settle();
    expect(bodies(a)).toEqual(['A1', 'B1']);
    expect(a.store.size).toBe(2);
    expect(dump(a)).toBe(dump(b));
  });

  it('a transitive descendant is not a conflict (A -> C -> D)', () => {
    const { devs, settle } = world(3);
    const [a, c, d] = devs as [Device, Device, Device];
    a.edit('s', 'e1');
    a.push();
    c.pull();
    c.edit('s', 'e2');
    c.push();
    d.pull();
    d.edit('s', 'e3');
    d.push();
    a.pull();
    expect(a.store.get('s')?.body).toBe('e3');
    expect(a.store.size).toBe(1);
    settle();
    for (const x of devs) expect(x.store.size).toBe(1);
  });

  it('a concurrent edit beats a later delete', () => {
    const { devs, settle } = world(2);
    const [a, b] = devs as [Device, Device];
    a.edit('l', 'v0');
    a.push();
    b.pull();
    b.edit('l', 'B-edit');
    a.del('l');
    a.pull();
    b.pull();
    b.push();
    a.push();
    settle();
    expect(a.store.get('l')?.body).toBe('B-edit');
    expect(b.store.get('l')?.body).toBe('B-edit');
  });

  it('N1: push 3 edits, lose the own lib, reset, edit: the new edit survives', () => {
    const { devs, remote, settle } = world(2);
    const [a, b] = devs as [Device, Device];
    for (const v of ['1', '2', '3']) (a.edit('k', v), a.push());
    b.pull();
    b.push(); // the peer's lib now holds a's {d0: 3}
    remote.libs.delete('d0'); // own lib gone (GC'd as stale / deleted by hand)
    a.reset(); // re-seed; vvCounter survives
    a.edit('k', 'NEW');
    a.pull();
    a.push();
    settle();
    expect(a.store.get('k')?.body).toBe('NEW');
    expect(b.store.get('k')?.body).toBe('NEW');
    expect(a.store.size).toBe(1); // NEW descends from '3' (counter 4 > 3): no conflict
  });

  it('N2: the fold result does not depend on the read order (all permutations)', () => {
    const e = (dev: string, w: number, vv: Record<string, number>, body: string | null): Entry => ({
      id: 'k', hlc: [w, 0, dev], basis: null, vv, deleted: body === null,
      value: body === null ? null : { name: 'k', body },
    });
    const sets: Entry[][] = [
      [e('a', 5, { a: 2 }, 'x'), e('b', 7, { a: 1, b: 1 }, 'y'), e('c', 6, { a: 1, c: 1 }, 'z')],
      [e('a', 5, { a: 2 }, 'x'), e('b', 7, { a: 1, b: 1 }, null), e('c', 9, { a: 2, c: 1 }, 'z'), e('d', 3, { a: 1 }, 'w')],
      [e('a', 5, { a: 1 }, 'same'), e('b', 6, { b: 1 }, 'same'), e('c', 4, { c: 1 }, 'other')],
    ];
    const perms = <T,>(xs: T[]): T[][] =>
      xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
    for (const set of sets) {
      const sigs = new Set(perms(set).map((p) => foldSig(fold(p))));
      expect(sigs.size).toBe(1);
    }
    // set 0: three concurrent live entries -> winner y (higher HLC), losers x and z
    const f0 = fold(sets[0]!);
    expect(f0.winner.value?.body).toBe('y');
    expect(f0.losers.map((l) => l.value?.body)).toEqual(['x', 'z']);
    // set 2: two equivalent entries collapse to the lowest HLC, vv joined, and are no loser of each other
    const f2 = fold(sets[2]!);
    expect(f2.winner.value?.body).toBe('same');
    expect(f2.winner.hlc[2]).toBe('a');
    expect(f2.winner.vv).toEqual({ a: 1, b: 1 });
    expect(f2.losers.map((l) => l.value?.body)).toEqual(['other']);
  });

  it('N3: two devices create the same conflicted copy: no copy of the copy', () => {
    const { devs, settle } = world(3);
    const [a, b, c] = devs as [Device, Device, Device];
    a.edit('m', 'v0');
    a.push();
    b.pull();
    c.pull();
    a.edit('m', 'A');
    b.edit('m', 'B');
    a.push();
    b.push();
    // c sees the conflict and creates the copy; so do a and b, independently
    c.pull();
    a.pull();
    b.pull();
    c.push();
    a.push();
    b.push();
    settle();
    for (const d of devs) {
      expect(d.store.size).toBe(2);
      expect([...d.store.keys()].filter(isCopyId)).toHaveLength(1);
      expect([...d.store.values()].some((v) => /\(.*\) \(/.test(v.name))).toBe(false);
    }
  });

  it('seeded fuzz: 3 devices, 400 steps, converge, keep last edits, no copy of a copy', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      let s = seed;
      const rnd = (n: number) => ((s = (s * 1103515245 + 12345) >>> 0) >>> 8) % n;
      const { devs, settle, dump } = world(3);
      const ids = ['p', 'q', 'r'];
      for (let step = 0; step < 400; step++) {
        const d = devs[rnd(3)]!;
        const op = rnd(11);
        const id = ids[rnd(3)]!;
        if (op < 4) d.edit(id, `${d.id}-${step}`);
        else if (op < 5) d.del(id);
        else if (op < 8) d.pull();
        else if (op < 10) d.push();
        else if (rnd(2) === 0) d.remote.libs.delete(d.id); // own lib lost: the index is kept (§7.9 step 6)
        else d.replace(); // Replace: local wiped, vvCounter kept (N1)
      }
      const lastLocal = devs.flatMap((d) =>
        [...d.dirty.keys()].filter((id) => !isCopyId(id)).map((id) => d.store.get(id)?.body).filter(Boolean),
      );
      settle();
      const first = dump(devs[0]!);
      for (const d of devs) expect(dump(d), `seed ${seed}`).toBe(first);
      const all = new Set([...devs[0]!.store.values()].map((v) => v.body));
      for (const b of lastLocal) expect(all.has(b!), `seed ${seed} lost ${b}`).toBe(true);
      // copies are only of the three base ids, and each content is copied at most once
      for (const id of devs[0]!.store.keys()) expect(id, `seed ${seed}`).toMatch(/^[pqr](-[0-9a-z]{6})?$/);
      const copyBodies = [...devs[0]!.store].filter(([k]) => isCopyId(k)).map(([, v]) => `${v.name}|${v.body}`);
      expect(new Set(copyBodies).size, `seed ${seed}`).toBe(copyBodies.length);
    }
  }, 600_000);
});
