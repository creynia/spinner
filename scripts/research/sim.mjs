// Launcher for the headless research runner (docs/research/plan.md). Vite's module runner gives
// the TypeScript sources the same `@core` / `@game` aliases and extensionless imports as the app,
// without a build step. Usage: node scripts/research/sim.mjs <spec.json> [options]; `run.ts` has
// the options. `sim.mjs --aggregate [paths] [--csv|--json]` runs aggregate.ts, `sim.mjs --app-data
// [--out path]` runs app-data.ts (the JSON behind the in-app Research screen).
import { fileURLToPath } from 'node:url';
import { createServer, createServerModuleRunner } from 'vite';

const root = fileURLToPath(new URL('../../', import.meta.url));
const src = (p) => `${root}src/${p}`;

const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, watch: null, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: {
    alias: [
      { find: /^@core$/, replacement: src('core/index.ts') },
      { find: /^@core\//, replacement: src('core/') },
      { find: /^@game\//, replacement: src('game/') },
      { find: /^@app\//, replacement: src('app/') },
    ],
  },
});
try {
  const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
  const args = process.argv.slice(2);
  // `--aggregate` runs the results aggregator (aggregate.ts) instead of the simulator.
  // `--app-data` runs the Research screen data pipeline (app-data.ts).
  const sub = { '--aggregate': 'aggregate', '--app-data': 'app-data' }[args[0]];
  const mod = await runner.import(`/scripts/research/${sub ?? 'run'}.ts`);
  await mod.main(sub ? args.slice(1) : args);
} finally {
  await server.close();
}
