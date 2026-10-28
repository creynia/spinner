# Questions for the user (decided by the orchestrator while the user was offline)

Each entry is a question the orchestrator would have asked the user. It was decided on the recommended option so work could continue; the decision is recorded in `decisions.md` and is reversible. Review these and say which to change.

| # | Date | Source | Question | Decided | Alternatives | Cost to change later |
|---|---|---|---|---|---|---|
| 1 | 2026-10-28 | game.md | A strategy asks for a bet above the table maximum. | Cut it to the maximum and record the change in the trace and the summary (visible, never silent). | Reject the bet; stop the session. | Low: one branch in roulette `reconcile`. |
| 2 | 2026-10-28 | game.md | The $5,000 maximum applies to… | Each outside bet separately. | Total outside per spin; total of all bets per spin. | Low: a rules field. |
| 3 | 2026-10-28 | game.md | Triple-zero table layout (basket, splits with 000) could not be confirmed from a reliable source. | Kept as designed in game.md. | Drop the basket and extra zero splits. If you know the real layout, describe it. | Low: catalog entries. |
| 4 | 2026-10-28 | game.md | Bankroll can't cover the full desired bet. | Bet what is left if it meets the minimum; otherwise the session busts. | Reject → bust immediately. | Low. |
| 5 | 2026-10-28 | harness-data-analysis.md | Phone worker count on many-small-core phones (Pixel 6a). | `min(cores − 1, 8)`, 1 on weak phones, to be measured on a real device during polish. | Fixed 2 on phones. | Low. |

## Checks only you can do

The build VM cannot reach github.io or a real phone, so these PLAYBOOK §15 items are still open:

1. **Phone check.** Open https://creynia.github.io/spinner/ on a mid-range Android, install it as a PWA, then run Settings → Benchmark (10,000 × 500). Check that it finishes under 20 s and the layout works at 360 px. The build VM measured 7.7 s on 3 Workers.
2. **Update path on the live site.** After the next deploy, Settings → Check for updates should show the toast, and the SHA in About should change. The e2e test covers this against two local builds only.
3. **Phone sleep mid-run.** Lock the phone during a run, unlock it, and check that the run resumes, or offers Resume, with the same results digest.
