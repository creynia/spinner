# CI

`.github/workflows/ci.yml` runs on pull requests and on pushes to `main`. Jobs run in parallel:

| Job | What | Notes |
|---|---|---|
| `lint` | `npm run lint`, `npm run format:check` | |
| `typecheck` | `npm run typecheck` | |
| `unit` | `npm run test:coverage` | v8 coverage; fails below the floors in `vitest.config.ts`; the totals go to the job summary and the `coverage` artifact |
| `gallery` | `npm run gallery:check` | |
| `check` | aggregate | succeeds only when the four jobs above did; keeps the historical check name |
| `build` | `npm run build` | uploads `dist` |
| `e2e (n/4)` | `npx playwright test --shard=n/4` | four shards of the Playwright suite on the built `dist` |
| `e2e` | aggregate | succeeds only when every shard did; keeps the historical check name |
| `perf` | Node perf suite and the Playwright `perf` project | |

`node_modules` is cached (keyed by `.nvmrc` and `package-lock.json`); a cache hit skips `npm ci`.

The `e2e (n/4)` and `perf` jobs run in the official Playwright image (`mcr.microsoft.com/playwright:v<version>-noble`), which ships Chromium and its system packages, so there is no browser download or apt install. Keep its tag equal to `@playwright/test` in `package.json`: `tests/build/ci-playwright-image.test.ts` fails when they differ. Those jobs keep their own `node_modules` cache (`node-modules-playwright-image-…`), since the container is not the runner's environment.

## Coverage

`npm run test:coverage` runs the unit tests with v8 coverage of `src/` (tests, fixtures and the chart gallery excluded) and a 30 s test timeout, since instrumentation slows the Monte Carlo oracle tests. The floors are just under the coverage measured on `main` when coverage was introduced:

| Statements | Branches | Functions | Lines |
|---|---|---|---|
| 86.60 % | 78.59 % | 82.71 % | 88.72 % |

Raise the floors in `vitest.config.ts` when coverage goes up; never lower them to make a change pass.

## Playwright projects

`tests/e2e/play-mobile` loops over its own phone viewports, so it runs only in the `phone` project (and its desktop suite only in `desktop`); `playwright.config.ts` ignores those files in the other projects instead of starting a page per test to skip it.
