// Lints in-memory snippets at fake paths and expects the `spinner/boundaries` rule (or the DOM
// globals ban) to fire, so the layering rules in eslint.config.js cannot silently stop working
// (architecture.md §4.3). An edge change edits CORE_ALLOWED and this file in one commit.
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

// The fake files do not exist, so the type-aware project service cannot load them: lint without
// type information and switch the type-checked rules off. The layering rules still run.
const typed = Object.fromEntries(
  tseslint.configs.recommendedTypeChecked.flatMap((c) =>
    Object.keys(c.rules ?? {}).map((r) => [r, 'off'] as const),
  ),
);
const eslint = new ESLint({
  cwd: process.cwd(),
  overrideConfig: [
    { languageOptions: { parserOptions: { projectService: false, project: false } }, rules: typed },
  ] as never,
});

async function violations(filePath: string, code: string): Promise<string[]> {
  const [res] = await eslint.lintText(code, { filePath });
  return (res?.messages ?? [])
    .filter((m) => m.ruleId === 'spinner/boundaries' || m.ruleId === 'no-restricted-globals')
    .map((m) => `${m.ruleId}: ${m.message}`);
}

type Case = [name: string, path: string, code: string];

const rejects: Case[] = [
  ['core -> game (relative)', 'src/core/strategy/x.ts', "import '../../game/roulette';"],
  [
    'core -> game from 4 levels deep',
    'src/core/strategy/a/b/c.ts',
    "import '../../../../game/roulette';",
  ],
  ['core -> app via a detour', 'src/core/strategy/x.ts', "import '../../core/../app/x';"],
  ['core uses an alias', 'src/core/strategy/x.ts', "import '@core/money';"],
  ['core -> package.json', 'src/core/strategy/x.ts', "import '../../../package.json';"],
  ['core -> preact', 'src/core/strategy/x.ts', "import 'preact';"],
  ['analysis -> harness', 'src/core/analysis/x.ts', "import '../harness';"],
  ['contracts -> money', 'src/core/contracts/x.ts', "import '../money';"],
  ['contracts -> rng', 'src/core/contracts/x.ts', "import '../rng';"],
  ['a core module -> the core barrel', 'src/core/strategy/x.ts', "import '..';"],
  ['a core test -> game', 'src/core/strategy/x.test.ts', "import '../../game/roulette';"],
  ['game -> app', 'src/game/roulette/x.ts', "import '../../app/routes';"],
  ['game -> a deep core file', 'src/game/roulette/x.ts', "import '@core/strategy/compile';"],
  ['game -> core by relative path', 'src/game/roulette/x.ts', "import '../../core/money';"],
  ['game -> @core/ui', 'src/game/roulette/x.ts', "import '@core/ui';"],
  ['game -> preact', 'src/game/roulette/x.ts', "import 'preact';"],
  ['game -> another game', 'src/game/roulette/x.ts', "import '@game/craps';"],
  ['workers -> app', 'src/workers/x.ts', "import '../app/routes';"],
  ['workers -> @core/ui', 'src/workers/x.ts', "import '@core/ui';"],
  ['pwa -> app', 'src/pwa/x.ts', "import '../app/routes';"],
  ['app -> a deep core file', 'src/app/x.ts', "import '@core/harness/pool';"],
  ['app -> a deep sync file', 'src/app/x.ts', "import '@core/sync/merge';"],
  ['app -> a deep game file', 'src/app/x.ts', "import '@game/roulette/engine';"],
  ['app -> core/testing', 'src/app/x.ts', "import '@core/testing';"],
  ['dynamic import() in core', 'src/core/strategy/x.ts', "void import('../../app/x');"],
  ['re-export in core', 'src/core/strategy/x.ts', "export * from '../../game/roulette';"],
  [
    'new URL(...) in core',
    'src/core/strategy/x.ts',
    "export const u = new URL('../../workers/sim.worker.ts', import.meta.url);",
  ],
  ['sync -> harness', 'src/core/sync/x.ts', "import '../harness';"],
  ['sync -> strategy', 'src/core/sync/x.ts', "import '../strategy';"],
  ['sync -> game', 'src/core/sync/x.ts', "import '../../game/roulette';"],
  ['sync -> preact', 'src/core/sync/x.ts', "import 'preact';"],
  ['a core module -> sync', 'src/core/analysis/x.ts', "import '../sync';"],
  ['the store -> sync', 'src/core/store/x.ts', "import '../sync';"],
  ['oauth -> app', 'src/oauth/return.ts', "import '../app/routes';"],
  ['oauth -> app by alias', 'src/oauth/return.ts', "import '@app/services/sync';"],
  ['oauth -> app via a detour', 'src/oauth/return.ts', "import '../pwa/../app/x';"],
  ['oauth -> core store', 'src/oauth/return.ts', "import '@core/store';"],
  ['oauth -> the core barrel', 'src/oauth/return.ts', "import '@core';"],
  ['oauth -> game', 'src/oauth/return.ts', "import '@game/roulette';"],
  ['oauth -> preact', 'src/oauth/return.ts', "import 'preact';"],
  ['document in core', 'src/core/money/x.ts', 'export const a = document.title;'],
  ['window in game', 'src/game/roulette/x.ts', 'export const a = window;'],
  ['localStorage in workers', 'src/workers/x.ts', 'export const a = localStorage;'],
];

const allows: Case[] = [
  ['strategy -> money', 'src/core/strategy/x.ts', "import '../money';\nexport const a = 1;"],
  ['strategy -> contracts file', 'src/core/strategy/x.ts', "import '../contracts/strategy';"],
  ['core/ui -> preact', 'src/core/ui/x.tsx', "import 'preact';\nexport const a = 1;"],
  ['core/ui -> analysis', 'src/core/ui/x.ts', "import '../analysis';\nexport const a = 1;"],
  [
    'core test -> vitest and testing',
    'src/core/strategy/x.test.ts',
    "import 'vitest';\nimport '../testing';",
  ],
  ['core test -> fake-indexeddb', 'src/core/store/x.test.ts', "import 'fake-indexeddb/auto';"],
  [
    'game -> contracts and money',
    'src/game/roulette/x.ts',
    "import '@core/contracts/game';\nimport '@core/money';",
  ],
  [
    'game ui -> game, core/ui and preact',
    'src/game/roulette/ui/x.tsx',
    "import '..';\nimport '@core/ui';\nimport 'preact';",
  ],
  [
    'workers -> harness and the game',
    'src/workers/x.ts',
    "import '@core/harness';\nimport '@game/roulette';",
  ],
  [
    'app -> core/ui, game ui and spawn',
    'src/app/x.tsx',
    "import '@core/ui';\nimport '@game/roulette/ui';\nimport '../workers/spawn';",
  ],
  // Reconciliation R5: CORE_VERSION lives in contracts/version.ts, importable by every module.
  ['harness -> contracts/version', 'src/core/harness/x.ts', "import '../contracts/version';"],
  ['experiment -> contracts/version', 'src/core/experiment/x.ts', "import '../contracts/version';"],
  ['store -> contracts/version', 'src/core/store/x.ts', "import '../contracts/version';"],
  ['core/ui -> contracts/version', 'src/core/ui/x.ts', "import '../contracts/version';"],
  ['contracts -> contracts', 'src/core/contracts/game.ts', "import type { A } from './strategy';"],
  ['app -> contracts by alias', 'src/app/x.ts', "import '@core/contracts/version';"],
  [
    'sync -> contracts, experiment and store',
    'src/core/sync/x.ts',
    "import '../contracts/sync';\nimport '../experiment';\nimport '../store';",
  ],
  ['sync -> itself', 'src/core/sync/engine.ts', "import './merge';"],
  ['core test -> sync', 'src/core/store/x.test.ts', "import '../sync';"],
  ['the core barrel -> sync', 'src/core/index.ts', "export * from './sync';"],
  ['app -> the sync entry', 'src/app/x.ts', "import '@core/sync';"],
  [
    'oauth -> contracts, pwa and itself',
    'src/oauth/return.ts',
    "import '@core/contracts/sync';\nimport '../core/contracts/sync';\nimport '../pwa/x';\nimport './helper';",
  ],
  ['DOM globals in oauth', 'src/oauth/return.ts', 'export const a = location.hash;'],
  ['tests are unrestricted', 'tests/app/x.test.ts', "import '../../src/core/strategy/compile';"],
  ['DOM globals in the app', 'src/app/x.ts', 'export const a = document.title;'],
];

describe('layering lint (architecture.md §4.3)', () => {
  it.each(rejects)('rejects: %s', async (_name, path, code) => {
    expect((await violations(path, code)).length).toBeGreaterThan(0);
  });
  it.each(allows)('allows: %s', async (_name, path, code) => {
    expect(await violations(path, code)).toEqual([]);
  });
});

describe('the contract set exists and src/core/version.ts does not (decisions.md R5)', () => {
  it('has no core/version module in the allow matrix', async () => {
    expect(
      (await violations('src/core/harness/x.ts', "import '../version';")).length,
    ).toBeGreaterThan(0);
  });
});
