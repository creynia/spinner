// One lazily created worker pool (architecture.md §6.4); runs outlive screens, so it lives here.
import { createPool, type SimPool } from '@core';
import { spawnSimWorker } from '../../workers/spawn';

let pool: SimPool | null = null;

export function poolSize(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(cores - 1, 8));
}

export function getPool(): SimPool {
  pool ??= createPool({ spawn: spawnSimWorker, size: poolSize() });
  return pool;
}
