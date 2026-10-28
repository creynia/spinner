# Gallery

Curated result bundles (`<slug>.spinner.json.gz`), exported from Analyze → Export with "Gallery trim"
(48 checkpoints, at most 6 samples). The build lists them in `gallery/index.json` (with headline
numbers computed by `@core/analysis` from the decoded bundle) and the app opens them read-only at
`#/gallery`. Order comes from `order.json`. Limits (decisions #8): at most 2 MB per bundle and 20 MB for
the folder, checked by `npm run gallery:check` and in CI.

The committed bundles were made with the real app: 10,000 sessions of 500 spins, seed 2026, European
wheel, $5,000 bankroll, $25 unit. To remake them (after an engine change, since results must match the
current game and core versions):

```sh
npm run build
GALLERY_MAKE=1 PORT=4173 npx playwright test gallery-make --project=desktop --workers=1
```

`tests/e2e/gallery-make.spec.ts` drives Define, Run, Analyze and Export, then adds the notes and tags
(and recomputes the definition id, which covers them). Only the orchestrator or the integration WP
commits bundles.
