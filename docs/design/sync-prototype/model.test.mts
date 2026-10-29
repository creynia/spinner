// Review B1: the lost update when both devices push before either pulls, plus transitive descent,
// edit-vs-delete, and a seeded fuzz interleaving pull/push/edit at step granularity.
import { describe, expect, it } from 'vitest';
import { Device, merge, Remote, type Entry } from './model.mts';

function world(n: number) {
  let t = 1000;
  const clock = () => (t += 1);
  const remote = new Remote();
  const devs = Array.from({ length: n }, (_, i) => new Device(`d${i}`, remote, clock));
  const settle = () => {
    for (let r = 0; r < 3; r++) for (const d of devs) (d.pull(), d.push());
  };
  const dump = (d: Device) => JSON.stringify([...d.store].sort(([a], [b]) => (a < b ? -1 : 1)));
  return { devs, settle, dump };
}

describe('merge rule (B1)', () => {
  it('the exact race: B pushes without having seen A1 (pull before A writes)', () => {
    const remote = new Remote();
    let t = 0;
    const clock = () => (t += 1);
    const a = new Device('a', remote, clock);
    const b = new Device('b', remote, clock);
    a.edit('x', 'v0');
    a.push();
    b.pull();
    a.edit('x', 'A1');
    b.edit('x', 'B1');
    a.pull();
    b.pull(); // both pull: nothing new
    a.push(); // A writes A1
    b.push(); // B writes B1, never saw A1  -> the old design lost A1 here
    for (let i = 0; i < 3; i++) (a.pull(), a.push(), b.pull(), b.push());
    expect([...a.store.values()].map((v) => v.body).sort()).toEqual(['A1', 'B1']);
    expect(a.store.size).toBe(2); // the id + exactly one conflicted copy
    expect(JSON.stringify([...a.store].sort())).toBe(JSON.stringify([...b.store].sort()));
  });

  it('a transitive descendant is not a conflict (A -> C -> D chain)', () => {
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
    a.pull(); // a still has e1 as base; e3 descends from it through e2
    expect(a.store.get('s')?.body).toBe('e3');
    expect(a.store.size).toBe(1);
    settle();
    for (const x of devs) expect(x.store.size).toBe(1);
  });

  it('a concurrent edit beats a delete, whichever HLC is higher', () => {
    const { devs, settle } = world(2);
    const [a, b] = devs as [Device, Device];
    a.edit('l', 'v0');
    a.push();
    b.pull();
    b.edit('l', 'B-edit');
    a.del('l'); // later edit time, still loses to the edit
    a.pull();
    b.pull();
    b.push();
    a.push();
    settle();
    expect(a.store.get('l')?.body).toBe('B-edit');
    expect(b.store.get('l')?.body).toBe('B-edit');
  });

  it('merge is commutative and associative on the winner', () => {
    const e = (dev: string, w: number, vv: Record<string, number>, body: string): Entry => ({
      id: 'k', hlc: [w, 0, dev], basis: null, vv, deleted: false, value: { name: 'k', body },
    });
    const x = e('a', 5, { a: 2 }, 'x');
    const y = e('b', 7, { a: 1, b: 1 }, 'y');
    const z = e('c', 6, { a: 1, c: 1 }, 'z');
    const w1 = merge(merge(x, y).winner, z).winner;
    const w2 = merge(x, merge(y, z).winner).winner;
    const w3 = merge(merge(z, x).winner, y).winner;
    expect(w1.value?.body).toBe('y');
    expect(w2.value?.body).toBe('y');
    expect(w3.value?.body).toBe('y');
    expect(w1.vv).toEqual({ a: 2, b: 1, c: 1 });
  });

  it('seeded fuzz: 3 devices, 400 steps interleaved per call, all converge, last edits survive', () => {
    for (let seed = 1; seed <= 30; seed++) {
      let s = seed;
      const rnd = (n: number) => ((s = (s * 1103515245 + 12345) >>> 0) >>> 8) % n;
      const { devs, settle, dump } = world(3);
      const ids = ['p', 'q', 'r'];
      for (let step = 0; step < 400; step++) {
        const d = devs[rnd(3)]!;
        const op = rnd(10);
        const id = ids[rnd(3)]!;
        if (op < 4) d.edit(id, `${d.id}-${step}`);
        else if (op < 5) d.del(id);
        else if (op < 8) d.pull();
        else d.push();
      }
      // remember every device's unpushed or last local value per id
      const lastLocal = devs.flatMap((d) => [...d.dirty.keys()].map((id) => d.store.get(id)?.body).filter(Boolean));
      settle();
      const a = dump(devs[0]!);
      for (const d of devs) expect(dump(d), `seed ${seed}`).toBe(a);
      const bodies = new Set([...devs[0]!.store.values()].map((v) => v.body));
      for (const b of lastLocal) expect(bodies.has(b!), `seed ${seed} lost ${b}`).toBe(true);
    }
  });
});
