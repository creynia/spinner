import { fileURLToPath } from 'node:url';

const src = (p: string): string => fileURLToPath(new URL(`../src/${p}`, import.meta.url));

/** One alias table for Vite and Vitest; mirrors `paths` in tsconfig.base.json. */
export const aliases = [
  { find: /^@core$/, replacement: src('core/index.ts') },
  { find: /^@core\//, replacement: src('core/') },
  { find: /^@game\//, replacement: src('game/') },
  { find: /^@app\//, replacement: src('app/') },
];
