# Contributing to spinner

Thanks for helping people understand roulette risk. Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first. The design documents in [`docs/design/`](docs/design/) are authoritative: `decisions.md` wins, then the other design documents, then [`PLAYBOOK.md`](PLAYBOOK.md).

## Setup

Prerequisite: Node >= 22.12 (see `.nvmrc`).

```sh
npm ci
npm run dev
```

## Branch and pull request flow

1. Branch from an up-to-date `main`. Work on branches named `claude/spinner-<topic>` (for example `claude/spinner-infra`); one branch per work package.
2. Commit early and often, and push your branch.
3. Open a pull request **into `main`**. Never push to `main` directly.
4. Run `npm run check` (and `npm run build` if you touched anything that is built) before every push. CI runs the same, plus the build, the end-to-end tests and the perf budget.
5. A reviewer who did not write the change reviews it; address the findings, wait for green CI, then it is merged.

Keep PRs focused. Use conventional-ish commit messages: `feat: ...`, `fix: ...`, `docs: ...`, `test: ...`, `chore: ...`.

## Scripts

| Script                  | What it does                                                                |
| ----------------------- | --------------------------------------------------------------------------- |
| `npm run dev`           | Vite dev server                                                             |
| `npm run build`         | Typecheck and build the PWA into `dist/`                                    |
| `npm run preview`       | Serve `dist/` under `/spinner/`                                             |
| `npm test`              | Unit tests (Vitest)                                                         |
| `npm run test:e2e`      | Build, then Playwright end-to-end tests at four viewports                   |
| `npm run test:perf`     | Build, then the perf budget                                                 |
| `npm run lint`          | ESLint (also enforces the import boundaries)                                |
| `npm run typecheck`     | TypeScript                                                                  |
| `npm run format`        | Prettier (write)                                                            |
| `npm run gallery:check` | Fails if a gallery bundle is over 2 MB or the folder over 20 MB             |
| `npm run check`         | lint + typecheck + format check + gallery check + unit tests (what CI runs) |

## How the code is organised

The architecture map is [`docs/design/architecture.md`](docs/design/architecture.md). The rules that matter most:

- **`src/core` imports nothing outside itself.** It is game-agnostic and kept extractable; see [`src/core/README.md`](src/core/README.md). ESLint and `tests/build/layering.test.ts` enforce it.
- **Money is integer cents.** EV and variance use exact fractions (`src/core/money`).
- Vocabulary is fixed by `PLAYBOOK.md` section 2; do not invent synonyms.

## Adding a gallery bundle

The gallery is a set of curated result bundles under `gallery/`, listed by the build in `gallery/index.json`.

1. Run the strategy, open it in **Analyze**, then **Export**, then **For the gallery**. This makes a trimmed `<slug>-<runId8>.spinner.json.gz`.
2. Commit it under `gallery/` (plain files; Git LFS stays off). Optionally list file names in `gallery/order.json` to set the display order; otherwise they sort by name.
3. Limits: at most 2 MB per bundle and 20 MB for the folder. `npm run gallery:check` and the build both enforce them, and the build validates the header (game is roulette). Checking the digest and computing the headline numbers is planned, once core-store's decoder is wired in; until then do not commit bundles.

Only the maintainers commit bundles to `main` (see [`gallery/README.md`](gallery/README.md)).

## End-to-end tests locally

```sh
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci
npx playwright install chromium          # or: export PLAYWRIGHT_BROWSERS_PATH=/path/to/browsers
PORT=4173 npm run test:e2e
```

The offline spec (`tests/e2e/offline.spec.ts`) loads the built app, goes offline, reloads and expects it to render, which proves the service-worker precache.

## Ideas to pick up

Deferred, self-contained ideas are collected in [`docs/chips.md`](docs/chips.md). Open an issue or PR and link it there when you start one.

## CI notes

- A GitHub Pages deploy can time out in "updating_pages", and the next one then fails with "deployment in progress". This is a GitHub-side flake: re-run the failed job from the Actions tab.
- The service worker precaches every built file except gallery bundles (those are cached the first time they are opened). Its cache name changes with the build, so each deploy shows "Update available" to installed copies.
