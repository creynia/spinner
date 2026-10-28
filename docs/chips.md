# Chips (deferred ideas and nits)

Owned by the orchestrator. Each entry: what, where it came from, and when to pick it up.

## Deferred by decision

- **Extract `src/core` to `casino-lab-core`** and refactor crappy, baccaratton and holdumb onto it (user decision 2026-10-28; only when the user asks). Plan: `docs/design/shared-core.md` §4, `architecture.md` §5.
- **Single-file offline build** with inlined workers (decisions #9).
- **Code strategies** (a JS `decide(observation, memory)` in the worker): designed in `strategy.md`, not built in v1.
- **In-round decision policies** (UTH): `setPolicy`, policies, `exposure()`, counters, `'moves'` results, `commission` (reconciliation G10, G11).
- From PLAYBOOK Appendix B: a text syntax for conditions; sound; hosted results sync; strategy lint suggestions ("your Martingale cap is reachable in 1.5% of sessions"); importing crappy sandbox layouts as a stage; a live "what if" sweep slider; sharing a run as a link to a committed gallery bundle.

## Nits from reviews

- PR #2: `src/core/money/cents.ts` `dollars(0.29)` throws (float scaling). Use `Math.round(d * 100)` and assert it is an integer. Owner: core-strategy (money).
- PR #2: confirm the e2e smoke covers `#/more`. Owner: integration.
