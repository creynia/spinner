// The in-memory remote: Drive semantics for what the engine relies on, plus the test hooks
// (`hook`, `fault` with a phase, `listingLag`).
import { describe, expect, it } from 'vitest';
import { RemoteError } from '../contracts/sync';
import { createMemoryRemote } from './memory-remote';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (b: Uint8Array): string => new TextDecoder().decode(b);

describe('createMemoryRemote', () => {
  it('creates, lists, downloads, updates and deletes; ids are opaque and never reused', async () => {
    const r = createMemoryRemote();
    const a = await r.create('lib.a', bytes('one'), { appProperties: { kind: 'lib' } });
    expect(a).toMatchObject({
      name: 'lib.a',
      bytes: 3,
      version: '1',
      appProperties: { kind: 'lib' },
    });
    expect(text(await r.download(a.id))).toBe('one');
    const u = await r.update(a.id, bytes('three'));
    expect(u).toMatchObject({ id: a.id, bytes: 5, version: '2' });
    expect(u.modifiedTime >= a.modifiedTime).toBe(true);
    expect(text(await r.download(a.id))).toBe('three');
    await r.delete(a.id);
    expect(await r.list()).toEqual([]);
    const b = await r.create('lib.a', bytes('x'));
    expect(b.id).not.toBe(a.id);
    // names are not unique, as on Drive
    await r.create('lib.a', bytes('y'));
    expect((await r.list()).map((f) => f.name)).toEqual(['lib.a', 'lib.a']);
  });

  it('a missing id is not-found; what a caller gets is a copy', async () => {
    const r = createMemoryRemote();
    for (const f of [
      () => r.download('nope'),
      () => r.update('nope', bytes('x')),
      () => r.delete('nope'),
    ]) {
      await expect(f()).rejects.toMatchObject({
        name: 'RemoteError',
        code: 'not-found',
        status: 404,
      });
    }
    const input = bytes('abc');
    const f = await r.create('n', input);
    input[0] = 0;
    const out = await r.download(f.id);
    expect(text(out)).toBe('abc');
    out[0] = 0;
    expect(text(await r.download(f.id))).toBe('abc');
    f.appProperties.x = 'y';
    expect((await r.list())[0]!.appProperties).toEqual({});
  });

  it('about() reports the account and the bytes held', async () => {
    const r = createMemoryRemote();
    await r.create('n', bytes('12345'));
    expect(await r.about()).toMatchObject({ accountId: 'memory-account', usage: 5, limit: null });
  });

  it('hook is awaited before every call, with the operation name', async () => {
    const seen: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const r = createMemoryRemote({
      hook: async (op) => {
        seen.push(op);
        if (op === 'create') await gate;
      },
    });
    let created = false;
    const p = r.create('n', bytes('x')).then(() => (created = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(created).toBe(false);
    expect(await Promise.race([r.list().then(() => 'list'), Promise.resolve('none')])).toBe('none');
    release();
    await p;
    const f = (await r.list())[0]!;
    await r.download(f.id);
    await r.update(f.id, bytes('y'));
    await r.delete(f.id);
    await r.about();
    expect(seen).toEqual(['create', 'list', 'list', 'download', 'update', 'delete', 'about']);
  });

  it("fault 'before' leaves no effect, 'after' keeps the effect but the caller sees the error", async () => {
    const calls: string[] = [];
    let phaseToFail: 'before' | 'after' | undefined;
    const r = createMemoryRemote({
      fault: (op, name, phase) => {
        calls.push(`${op}:${name ?? '-'}:${phase}`);
        return op === 'create' && phase === phaseToFail
          ? new RemoteError('network', 0, 'lost')
          : undefined;
      },
    });
    phaseToFail = 'before';
    await expect(r.create('a', bytes('1'))).rejects.toMatchObject({ code: 'network' });
    expect(await r.list()).toEqual([]);
    phaseToFail = 'after';
    await expect(r.create('b', bytes('2'))).rejects.toMatchObject({ code: 'network' });
    expect((await r.list()).map((f) => f.name)).toEqual(['b']); // the effect happened
    expect(calls).toContain('create:a:before');
    expect(calls).toContain('create:b:after');
  });

  it('a fault that ignores the phase fails the call before it has any effect', async () => {
    const r = createMemoryRemote({
      fault: (op) => (op === 'create' ? new RemoteError('server', 500, 'x') : undefined),
    });
    await expect(r.create('a', bytes('1'))).rejects.toMatchObject({ code: 'server' });
    expect(await r.list()).toEqual([]);
  });

  it('listing lag hides a fresh lib file from list() for N calls; other files and updates are unaffected', async () => {
    const r = createMemoryRemote({ listingLag: { ownLib: 2 } });
    const lib = await r.create('lib.aaaaaaaaaa.json.gz', bytes('x'));
    await r.create('spinner-sync.json', bytes('{}'));
    expect((await r.list()).map((f) => f.name)).toEqual(['spinner-sync.json']);
    expect((await r.list()).map((f) => f.name)).toEqual(['spinner-sync.json']);
    expect((await r.list()).map((f) => f.name).sort()).toEqual([
      'lib.aaaaaaaaaa.json.gz',
      'spinner-sync.json',
    ]);
    // the file itself is reachable by id all along
    expect(text(await r.download(lib.id))).toBe('x');
    await r.update(lib.id, bytes('yy'));
    expect((await r.list()).find((f) => f.id === lib.id)!.version).toBe('2');
  });

  it('honours an aborted signal', async () => {
    const r = createMemoryRemote();
    const c = new AbortController();
    c.abort();
    await expect(r.list({ signal: c.signal })).rejects.toBeDefined();
  });
});
