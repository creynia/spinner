// `isActive` and `onRunChange` (WP-S5a): what the sync service waits on before a first sync or
// Replace, and what tells it a run reached done (its bundle uploads 10 s later).
import { describe, expect, it } from 'vitest';
import type { HarnessRunController, RunProgress } from '@core';
import { setRepoForTests, createMemoryRepo } from '@app/services/db';
import { adoptController, isActive, onRunChange } from '@app/services/runs';

function fakeController(runId: string) {
  const subs = new Set<(p: RunProgress) => void>();
  const c = {
    runId,
    subscribe: (fn: (p: RunProgress) => void) => {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  } as unknown as HarnessRunController;
  const emit = (status: RunProgress['status']) =>
    subs.forEach((fn) => fn({ runId, status } as RunProgress));
  return { c, emit };
}

describe('isActive / onRunChange', () => {
  it('tracks running and queued runs, per run and overall, and tells the listeners', () => {
    setRepoForTests(createMemoryRepo());
    const seen: string[] = [];
    const off = onRunChange((e) => seen.push(`${e.runId}:${e.status}:${e.active}`));
    expect(isActive()).toBe(false);
    const a = fakeController('run-a');
    const b = fakeController('run-b');
    adoptController(a.c);
    adoptController(b.c);
    a.emit('queued');
    expect(isActive()).toBe(true);
    expect(isActive('run-a')).toBe(true);
    expect(isActive('run-b')).toBe(false);
    a.emit('running'); // still live: no second notification
    b.emit('running');
    a.emit('done');
    expect(isActive()).toBe(true); // run-b still goes
    expect(isActive('run-a')).toBe(false);
    b.emit('paused');
    expect(isActive()).toBe(false);
    expect(seen).toEqual([
      'run-a:queued:true',
      'run-b:running:true',
      'run-a:done:false',
      'run-b:paused:false',
    ]);
    off();
    a.emit('running');
    expect(seen).toHaveLength(4);
    a.emit('error');
    setRepoForTests(null);
  });
});
