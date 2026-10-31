import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { aliases } from './build/aliases.ts';

const shared = {
  plugins: [preact()],
  resolve: { alias: aliases },
  define: { __APP_VERSION__: JSON.stringify('test'), __BUILD_SHA__: JSON.stringify('test') },
};
// Anything that renders runs in happy-dom; everything else (core, game, workers, build) in node.
const domGlobs = [
  'src/app/**/*.test.{ts,tsx}',
  'src/pwa/**/*.test.{ts,tsx}',
  'src/core/ui/**/*.test.{ts,tsx}',
  'src/game/*/ui/**/*.test.{ts,tsx}',
  'tests/app/**/*.test.{ts,tsx}',
];
const exclude = ['tests/e2e/**', 'tests/perf/**', 'node_modules/**', 'dist/**'];

export default defineConfig({
  test: {
    // The shared VM runs many agents: the resource baton passes VITEST_MAX_WORKERS (default 2).
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS ?? 2),
    projects: [
      {
        ...shared,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'src/**/*.test.{ts,tsx}',
            'tests/**/*.test.{ts,tsx}',
            'scripts/research/**/*.test.ts',
          ],
          exclude: [...exclude, ...domGlobs],
        },
      },
      {
        ...shared,
        test: { name: 'dom', environment: 'happy-dom', include: domGlobs, exclude },
      },
    ],
  },
});
