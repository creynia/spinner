// Vitest config for the node-side perf tests (strategy.md §17.9, PLAYBOOK §7.2), which live in
// tests/build/perf/*.perf.test.ts because tsconfig.node.json (tests/perf) cannot import src. In
// `npm test` they are skipped (no PERF=1). Run them through the resource baton:
//
//   res cpu <me> -- env PERF=1 PERF_BUDGET_MS=20000 npx vitest run -c tests/perf/vitest.config.ts
//
// Without PERF=1 every test here is skipped.
import { defineConfig } from 'vitest/config';
import { aliases } from '../../build/aliases.ts';

export default defineConfig({
  resolve: { alias: aliases },
  define: { __APP_VERSION__: JSON.stringify('test'), __BUILD_SHA__: JSON.stringify('test') },
  test: {
    name: 'perf',
    environment: 'node',
    include: ['tests/build/perf/**/*.perf.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 600_000,
  },
});
