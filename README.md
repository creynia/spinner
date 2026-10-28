# spinner

A roulette **strategy lab**: define a betting strategy (which may change from one spin to the next), run it over thousands of seeded simulated sessions in your browser, and analyze the distribution of outcomes: average result, volatility, bust risk, drawdowns, and how the strategy actually behaved.

Static web app for GitHub Pages; no backend, no accounts. Everything stays on your device.

## Use it

- **Open it:** <https://creynia.github.io/spinner/>
- **Add to Home screen (Android/Chrome):** open the link, tap the Chrome menu (three dots), then **Add to Home screen** (or **Install app**). On iPhone/iPad (Safari): tap **Share**, then **Add to Home Screen**. It launches full screen and works offline after the first load.
- **Share a definition:** build a strategy in **Define**, then use **Share link**. The link carries the whole definition (nothing is uploaded), so anyone who opens it lands in Define with your strategy filled in, ready to run with the same seed.
- **Export a run:** open a finished run in **Analyze**, then **Export**. You get a run file (`.spinner.json`, gzipped when the browser supports it) that **Import** reads back byte for byte, a summaries CSV for spreadsheets, and the definition as JSON. Results live in your browser's storage only, so export anything you want to keep or send to someone.
- **Updates:** the installed app updates itself and shows "Update available · Reload". If it doesn't, open **Settings**, then **Check for updates**, and tap **Reload** on the toast. If none shows, close the app completely and open it again.
- **Gallery:** curated result bundles open read-only from **More**, then **Gallery**. A bundle you open is kept for offline use.

## Is this gambling advice?

No. Every roulette bet has a house edge; no betting system changes it. This is a simulation for understanding risk, not advice. If gambling is a problem for you, seek help (e.g. a national gambling helpline).

## Develop

Requires Node >= 22.12 (see `.nvmrc`).

```sh
npm ci
npm run dev        # local dev server
npm run check      # lint, typecheck, format check, gallery size check, unit tests
npm run build      # dist/ (the PWA, service worker and gallery index)
npm run test:e2e   # Playwright (builds first; see CONTRIBUTING.md)
```

The plan is in [PLAYBOOK.md](PLAYBOOK.md) and the design documents are in [`docs/design/`](docs/design/) (start with `decisions.md`, which wins over everything else). The game-agnostic core is [`src/core`](src/core/README.md). See [CONTRIBUTING.md](CONTRIBUTING.md) to get involved.

### Deploying

`main` deploys to GitHub Pages through `.github/workflows/pages.yml` (Pages source: GitHub Actions). If a deploy fails with "deployment in progress", re-run the failed job.

## License

[MIT](LICENSE)
