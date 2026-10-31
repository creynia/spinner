// Launcher for the ladder calculator (docs/research/plan.md section 3), same Vite module runner as
// sim.mjs. Usage: node scripts/research/ladder.mjs --c 18 --base 500 --unit 500 --max 500000
// --bankroll 511500 --spins 500 [--json]
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
  const mod = await runner.import('/scripts/research/ladder.ts');
  await mod.main(process.argv.slice(2));
} finally {
  await server.close();
}
