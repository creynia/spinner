# Questions for the user (decided by the orchestrator while the user was offline)

Each entry is a question the orchestrator would have asked the user. It was decided on the recommended option so work could continue; the decision is recorded in `decisions.md` and is reversible. Review these and say which to change.

| # | Date | Source | Question | Decided | Alternatives | Cost to change later |
|---|---|---|---|---|---|---|
| 1 | 2026-10-28 | game.md | A strategy asks for a bet above the table maximum. | Cut it to the maximum and record the change in the trace and the summary (visible, never silent). | Reject the bet; stop the session. | Low: one branch in roulette `reconcile`. |
| 2 | 2026-10-28 | game.md | The $5,000 maximum applies to… | Each outside bet separately. | Total outside per spin; total of all bets per spin. | Low: a rules field. |
| 3 | 2026-10-28 | game.md | Triple-zero table layout (basket, splits with 000) could not be confirmed from a reliable source. | Kept as designed in game.md. | Drop the basket and extra zero splits. If you know the real layout, describe it. | Low: catalog entries. |
| 4 | 2026-10-28 | game.md | Bankroll can't cover the full desired bet. | Bet what is left if it meets the minimum; otherwise the session busts. | Reject → bust immediately. | Low. |
| 5 | 2026-10-28 | harness-data-analysis.md | Phone worker count on many-small-core phones (Pixel 6a). | `min(cores − 1, 8)`, 1 on weak phones, to be measured on a real device during polish. | Fixed 2 on phones. | Low. |
| 6 | 2026-10-28 | layouts.md Q1 | Does a saved layout carry a default chip value? | No; the stage picks, preselecting the smallest standard chip that meets the table minimums. | Store a default on the layout. | Low: one optional field. |
| 7 | 2026-10-28 | layouts.md Q2 | Bankroll can't fund the whole layout. | The table's existing rule: fund spots in placement order, cut over-max spots; previewed in the editor. | Shrink all spots evenly; skip the spin; end the session. | Low: a stage option later, no contract change. |
| 8 | 2026-10-28 | layouts.md Q3 | Should experiments follow later edits to a saved layout? | No; each stage keeps its copy and Define offers Update / Keep. | Update everywhere automatically, or a bulk "update all" tool. | Low. |
| 9 | 2026-10-28 | layouts.md Q4 | How do you remove chips? | An Add / Remove toggle (plus right-click on desktop); long-press opens a bet sheet with −/+. | Tap a stack to remove; an eraser mode. | Low: UI only. |
| 10 | 2026-10-28 | layouts.md Q5 | Should presets show as chips by default? | No; "Edit on the table" converts a stage on request. | Convert all presets. | Medium: preset definition ids, the pinned id vectors and existing "already ran" matches change; traces do not. |
| 11 | 2026-10-28 | PR #29 review | The board didn't fit on a phone with a bet-type row and a Call bets tab. | Both moved into one corner button ("Auto ▾") that opens a sheet. The whole table fits without scrolling. | Keep visible rows and let the page scroll; put the lock in the editor toolbar. | Low: UI only. |
| 12 | 2026-10-28 | PR #29 | Built-in layouts and chip values. | Six built-ins: James Bond, Voisins, Tiers, Orphelins, zero neighbours (`neighbours:0:2`) and two dozens (5 chips each). Voisins, Tiers and Orphelins are separate layouts. Chips: $1, $5, $25, $100, $500, $1,000. | Different set; one combined "French call bets" layout. | Low: data only. |

## Checks only you can do

The build VM cannot reach github.io or a real phone, so these PLAYBOOK §15 items are still open:

1. **Phone check.** Open https://creynia.github.io/spinner/ on a mid-range Android, install it as a PWA, then run Settings → Benchmark (10,000 × 500). Check that it finishes under 90 s (the phone budget; 20 s is the laptop budget, PLAYBOOK §7.2) and the layout works at 360 px. The build VM measured 6.8–9.1 s on 3 Workers (see `docs/perf.md`). Add a row to `docs/perf.md` (device, browser, workers, ms, rounds/s), as harness-data-analysis.md §14 asks.
   - **2026-10-28, partly done:** on a Pixel 11 Pro in current Chrome, the benchmark took 4.0 s on 6 Workers (1.26M rounds/s), and the layout looked good in portrait and landscape. That phone is a flagship, so the mid-range (Pixel 6a class) run that the 90 s budget is written for is still open. It was then installed as an app; the installed app shows the runs made earlier in the Chrome tab, as expected, because both share the same origin storage.
2. **Update path on the live site.** After the next deploy, Settings → Check for updates should show the toast, and the SHA in About should change. The e2e test covers this against two local builds only.
3. **Phone sleep mid-run.** Lock the phone during a run, unlock it, and check that the run resumes, or offers Resume, and that the finished run has all its sessions and the same headline results as an uninterrupted run with the same seed.
