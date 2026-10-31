import { dirname, relative, resolve, sep } from 'node:path';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// ---- Layering (docs/design/architecture.md §4) -----------------------------------------------
// One local rule resolves every import specifier (relative at any depth, @core/@game/@app aliases,
// dynamic import(), re-exports, `new URL('…', import.meta.url)`) to a repo path, classifies the
// importer and the target into zones, and checks the allow matrix below. Resolving instead of
// globbing means a relative import cannot slip through by being deeper or by taking a detour.

const ROOT = import.meta.dirname;
const CORE_MODULES = [
  'contracts',
  'money',
  'rng',
  'strategy',
  'experiment',
  'harness',
  'store',
  'analysis',
  'sync',
  'ui',
];
/** Which core modules each core module may import (itself is always allowed). */
const CORE_ALLOWED = {
  contracts: [],
  money: ['contracts'],
  rng: ['contracts'],
  strategy: ['contracts', 'money', 'rng'],
  experiment: ['contracts', 'money', 'strategy'],
  harness: ['contracts', 'money', 'rng', 'strategy', 'experiment'],
  store: ['contracts', 'money', 'experiment'],
  analysis: ['contracts', 'money'],
  sync: ['contracts', 'experiment', 'store'],
  ui: ['contracts', 'money', 'rng', 'strategy', 'experiment', 'harness', 'store', 'analysis'],
  testing: [
    'contracts',
    'money',
    'rng',
    'strategy',
    'experiment',
    'harness',
    'store',
    'analysis',
    'sync',
  ],
};
/** Bare packages each zone may import (tests additionally get TEST_PACKAGES). */
const PREACT = ['preact', 'preact/hooks', 'preact/jsx-runtime'];
const TEST_PACKAGES = [
  'vitest',
  '@testing-library/preact',
  'fake-indexeddb',
  'fake-indexeddb/auto',
];

/** Zone of a repo-relative posix path. */
function zoneOf(p) {
  let m;
  if (p === 'src/core/index.ts') return { zone: 'core', mod: 'index' };
  if ((m = /^src\/core\/([^/.]+)(\/|\.ts$|$)/.exec(p))) return { zone: 'core', mod: m[1] };
  if ((m = /^src\/game\/([^/]+)\/ui(\/|$)/.exec(p))) return { zone: 'game-ui', game: m[1] };
  if ((m = /^src\/game\/([^/]+)(\/|$)/.exec(p))) return { zone: 'game', game: m[1] };
  if (p.startsWith('src/workers/')) return { zone: 'workers' };
  if (p.startsWith('src/pwa/')) return { zone: 'pwa' };
  if (p.startsWith('src/oauth/')) return { zone: 'oauth' };
  if (p.startsWith('src/app/')) return { zone: 'app' };
  return { zone: 'other' }; // tests/, build/, configs, anything outside src
}

function toRepoPath(spec, file) {
  const clean = spec.replace(/[?#].*$/, '');
  let abs;
  if (clean === '@core') abs = resolve(ROOT, 'src/core/index.ts');
  else if (clean.startsWith('@core/')) abs = resolve(ROOT, 'src/core', clean.slice(6));
  else if (clean.startsWith('@game/')) abs = resolve(ROOT, 'src/game', clean.slice(6));
  else if (clean.startsWith('@app/')) abs = resolve(ROOT, 'src/app', clean.slice(5));
  else if (clean.startsWith('.') || clean.startsWith('/')) abs = resolve(dirname(file), clean);
  else return null; // bare package
  return relative(ROOT, abs).split(sep).join('/');
}

/** Public entry points that code outside a module may import. */
function isPublicEntry(target, p) {
  const s = p.replace(/\/index(\.tsx?)?$/, '').replace(/\.tsx?$/, '');
  if (target.zone === 'core') {
    if (target.mod === 'contracts') return true; // type files, frozen
    return s === 'src/core' || s === `src/core/${target.mod}`;
  }
  if (target.zone === 'game') return s === `src/game/${target.game}`;
  if (target.zone === 'game-ui') return s === `src/game/${target.game}/ui`;
  if (target.zone === 'workers') return s === 'src/workers/spawn';
  return true;
}

/** Returns an error message, or null when `importer` may import `spec`. */
function check(file, spec) {
  const from = relative(ROOT, file).split(sep).join('/');
  const src = zoneOf(from);
  const isTest = /\.test\.tsx?$/.test(from) || from.includes('/__fixtures__/');
  const target = toRepoPath(spec, file);

  // Bare packages.
  if (target === null) {
    if (spec.startsWith('node:')) {
      return isTest || src.zone === 'other' ? null : `${from}: node built-ins only in tests/build.`;
    }
    if (src.zone === 'other' || src.zone === 'app') return null;
    if (isTest && TEST_PACKAGES.includes(spec)) return null;
    const ui =
      src.zone === 'game-ui' || src.zone === 'pwa' || (src.zone === 'core' && src.mod === 'ui');
    if (ui && PREACT.includes(spec)) return null;
    return `${from} may not import the package '${spec}' (only ${ui ? 'preact' : 'nothing'}; architecture.md §4).`;
  }

  const dst = zoneOf(target);
  const msg = (why) => `${from} → ${spec}: ${why} (architecture.md §4).`;
  // Inside a module: anything. Across modules: the public entry only.
  const sameModule =
    (src.zone === 'core' && dst.zone === 'core' && src.mod === dst.mod) ||
    (['game', 'game-ui'].includes(src.zone) && dst.zone === src.zone && src.game === dst.game) ||
    (src.zone === dst.zone && ['workers', 'pwa', 'app', 'oauth'].includes(src.zone));

  switch (src.zone) {
    case 'core': {
      if (dst.zone !== 'core') return msg('src/core imports nothing outside src/core');
      if (spec.startsWith('@')) return msg('inside src/core use relative imports (extractable)');
      if (sameModule) return null;
      if (dst.mod === 'index') return msg('src/core modules must not import the core barrel');
      const allowed = isTest
        ? [...CORE_MODULES, 'testing']
        : (CORE_ALLOWED[src.mod] ??
          (src.mod === 'index' ? CORE_MODULES.filter((m) => m !== 'ui') : []));
      if (!allowed.includes(dst.mod)) return msg(`core/${src.mod} may not import core/${dst.mod}`);
      return null;
    }
    case 'game':
    case 'game-ui': {
      if (sameModule) return null;
      if (src.zone === 'game-ui' && dst.zone === 'game' && dst.game === src.game) return null;
      if (dst.zone === 'core') {
        if (!spec.startsWith('@core')) return msg('reach src/core through @core/…');
        if (dst.mod === 'ui' && src.zone !== 'game-ui')
          return msg('only game ui may import core/ui');
        if (dst.mod === 'testing' && !isTest) return msg('core/testing is for tests');
        return isPublicEntry(dst, target) || isTest
          ? null
          : msg('import a core module entry, not a deep file');
      }
      return msg(`src/game/${src.game} may import only @core/* and itself`);
    }
    case 'workers': {
      if (sameModule) return null;
      if (dst.zone === 'core' && dst.mod !== 'ui')
        return isPublicEntry(dst, target) ? null : msg('deep import');
      if (dst.zone === 'game') return isPublicEntry(dst, target) ? null : msg('deep import');
      return msg('src/workers may import only non-UI core and game modules');
    }
    case 'pwa':
      return sameModule ? null : msg('src/pwa imports nothing app specific');
    case 'oauth': {
      // The OAuth redirect entry runs before and apart from the app (sync.md §13 WP-S3): core
      // contracts and src/pwa only, never src/app.
      if (sameModule) return null;
      if (dst.zone === 'core' && dst.mod === 'contracts') return null;
      if (dst.zone === 'pwa') return null;
      return msg('src/oauth may import only core contracts, src/pwa and itself');
    }
    case 'app': {
      if (sameModule) return null;
      if (dst.zone === 'core' && dst.mod === 'testing') return msg('core/testing is for tests');
      return isPublicEntry(dst, target) || isTest
        ? null
        : msg('import a public entry, not a deep file');
    }
    default:
      return null; // tests/, build/, configs: unrestricted
  }
}

const boundaries = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const report = (node, source) => {
      if (!source || typeof source.value !== 'string') return;
      const error = check(context.filename, source.value);
      if (error) context.report({ node: source, message: error });
    };
    return {
      ImportDeclaration: (n) => report(n, n.source),
      ExportNamedDeclaration: (n) => report(n, n.source),
      ExportAllDeclaration: (n) => report(n, n.source),
      ImportExpression: (n) => report(n, n.source),
      // new URL('./x.worker.ts', import.meta.url)
      NewExpression(n) {
        if (n.callee.type === 'Identifier' && n.callee.name === 'URL' && n.arguments.length === 2) {
          const [a, b] = n.arguments;
          if (
            a.type === 'Literal' &&
            b.type === 'MemberExpression' &&
            b.object.type === 'MetaProperty'
          )
            report(n, a);
        }
      },
    };
  },
};

const NO_DOM = ['document', 'window', 'localStorage', 'sessionStorage', 'location', 'history'].map(
  (name) => ({ name, message: `Pure modules (core, game, workers) must not use ${name}.` }),
);

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'public/icons/**',
      'node_modules/**',
    ],
  },
  js.configs.recommended,
  { files: ['**/*.{mjs,js}'], languageOptions: { globals: { ...globals.node } } },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['*.config.ts', 'build/**/*.ts', 'scripts/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { spinner: { rules: { boundaries } } },
    rules: { 'spinner/boundaries': 'error' },
  },
  {
    files: ['src/core/**/*.ts', 'src/game/**/*.ts', 'src/workers/**/*.ts'],
    ignores: ['src/core/ui/**', 'src/game/*/ui/**', '**/*.test.ts'],
    rules: { 'no-restricted-globals': ['error', ...NO_DOM] },
  },
  prettier,
);
