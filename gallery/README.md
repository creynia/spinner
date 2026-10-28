# Gallery

Curated result bundles (`<slug>.spinner.json` or `.spinner.json.gz`), exported from Analyze → Export
→ "For the gallery". The build lists them in `gallery/index.json` and the app opens them read-only
at `#/gallery`. Limits (decisions #8): at most 2 MB per bundle and 20 MB for the folder, checked by
`npm run gallery:check` and in CI. Only the orchestrator or the integration WP commits bundles.
