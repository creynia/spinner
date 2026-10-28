# Decisions (authoritative)

This file overrides every design doc under `docs/design/` and `PLAYBOOK.md`. When a design doc disagrees with this file, this file wins. Changes are made only by the orchestrator.

## Kickoff answers (2026-10-28)

| # | Topic | Decision |
|---|---|---|
| 1 | Pool size | **4** Sonnet agents at once (implementers, reviewers, debuggers share it). The container has 4 cores: run heavy checks (e2e, perf) one at a time when possible. |
| 2 | Game rules | **European single-zero is the default.** Presets: `european` (default), `american` (double zero), `triple-zero` (0, 00, 000). Rule flags: `laPartage` and `enPrison` (even-money bets only, single-zero wheels; mutually exclusive). **All bet families are simulated:** inside (straight, split, street, corner, six-line, basket/top-line per wheel), outside (red/black, odd/even, low/high, dozens, columns), and **call/neighbour bets** (voisins du zéro, tiers du cylindre, orphelins, jeu zéro, neighbours `n±k`) on single-zero wheels, expanded into their component chips. |
| 3 | Table limits | **High-limit table:** $25 minimum, $5,000 maximum. Classes: *outside* min $25 / max $5,000 per bet; *inside* min $25 total across inside bets per spin, min $1 per inside chip, max $500 per straight-up, with per-bet maxima scaled so the max payout does not exceed 35 × $500 = $17,500 (split $1,000, street $1,500, corner $2,000, six-line $3,000, basket by its payout); *call* bets are limited by their component chips. Limits are rule fields so users can override them. |
| 4 | Pace | Default **40 spins/hour** (live wheel). Pace preset `electronic` at **100 spins/hour**. Definitions may override. |
| 5 | Default run | **10,000 sessions × 500 spins.** Perf budget device: **mid-range Android** (Pixel 6a class): < 90 s; 4-core laptop < 20 s; CI uses a generous bound. |
| 6 | Merge | The orchestrator **may merge** PRs into `main` once reviewed by a pool reviewer (not the author) and CI is green on the latest head. |
| 7 | Repo | Public, **MIT**. Branching: `main` is the integration branch; all work happens on `claude/spinner-*` branches and lands through PRs into `main`. |
| 8 | Gallery | **Yes.** Curated result bundles committed under `gallery/`, listed by a build-time `gallery/index.json`, openable read-only at `#/gallery`. ≤ 2 MB per bundle, ≤ 20 MB folder, enforced in CI. |
| 9 | Single-file build | **No** in v1 (chip). |
| 10 | Presets day one | Full classic set: flat, Martingale, Grand Martingale, Fibonacci, d'Alembert, Labouchere, Paroli, 1-3-2-6, Oscar's Grind, James Bond, dozens progression (two dozens, Martingale-style), and the §3.6 example `red-mart-then-flat`. |
| 11 | Disclaimer | **Settings/About only** (and the README). No line on Home, none on Analyze verdicts. Wording: "Every roulette bet has a house edge; no betting system changes it. This is a simulation for understanding risk, not advice. If gambling is a problem for you, seek help (e.g. a national gambling helpline)." |

## Process decisions

- Prior art in creynia/crappy is **not available** to this session; spikes design from `PLAYBOOK.md` alone.
- Spikes: game, strategy, harness-data-analysis, architecture (PLAYBOOK §13.2), output under `docs/design/`.
- Money is integer cents; `unit` defaults to 2500 ($25) to match the table minimum.

## Reconciliation (filled in after the spikes)

_Pending._
