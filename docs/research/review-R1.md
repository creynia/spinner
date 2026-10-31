# Review R1: Research screen

Scope: `src/app/screens/Research/` plus the small edits in `routes.tsx`, `router.ts`, `Nav.tsx`,
`TopBar.tsx`, `More/index.tsx`, read against `docs/design/research.md` and
`docs/research/app-plan.md` §2, §4, §7. Method: full read of every chapter component, kit, calculator,
share and CSS; every data key and prediction field checked against `data.json`; the screen rendered at
360 and 1280 px in light and dark and probed for overflow, tap targets (every `a`, `button`, `summary`,
`input`, focusable region >= 43.5 px) and axe. Numbers in `content.ts` were spot-checked against
`data.json` (chapters 0 to 8): no factual error found, so `content.ts` is untouched.

| File | Line | Severity | What | Fixed |
| --- | --- | --- | --- | --- |
| `research.css`, `index.tsx` | `.research-page` | high | At 360 px the page was 1280 px wide (`scrollWidth` 1280 > `clientWidth` 360). The shell is a grid with an `auto` column, so the nowrap chip row and the nowrap table cells (inside their scroll boxes) set the min-content width of the whole screen. Found independently of the e2e work package; its commit 9ce2b1a (`contain: inline-size` on the screen root) landed first and is kept, mine was dropped in the rebase. Checked: `scrollWidth` equals the viewport at 360 and 1280 with the containment | yes (9ce2b1a) |
| `TryIt.tsx` | 92 | high | `aria-label="Open <name> in Define"` does not contain the visible text "Open in Define": axe `label-content-name-mismatch` (serious) on all three buttons, in both themes, so axe-clean fails. Now `Open in Define: <name>` (the pattern `Use in Define: <name>` of Library), and no label while the button reads "Opening…". Same fix as 9ce2b1a (kept). `docs/design/research.md` §6/§10 still say `Open <name> in Define` and should be updated | yes (9ce2b1a) |
| `ChTry.test.tsx` | 63, 79 | low | Test names follow the new button name | yes (9ce2b1a) |
| `ChCurve.tsx` | summary | low | Tone: summary said "(root mean square)". Now "misses the measured share by about 0.8 points" | yes |
| `LadderCalculator.tsx` | `horizon` use | low | A horizon above 1,000,000 read "about spin more than 1,000,000". Now "past spin 1,000,000" (tile and live sentence) | yes |
| `ChLimits.tsx` | 548-550 | low | The label "a1 + $226 cash-out" types a number into the component. It is the spec's `stopWin: 22600` (`x1-a1-trailing.json`) and is not in `data.json` (the row's median is $232). Matches `content.ts`; no data field to read it from | no (documented) |
| `DotRows.tsx` / `ChPlacement.tsx` | 185 | low | A value equal to `clampAt` is drawn as a circle at the axis end, while the table says "500+"; only values above 500 get the triangle. Visible only for the $5-base dozen (still ahead at 500), where the predicted tick (765) already draws the triangle there. Design §5.1 says "above clampAt", so left as specified | no (documented) |
| `ChPlacement.tsx`, `ChCashout.tsx`, `ChCurve.tsx` | legends | info | Notation in legends and table heads outside the math block ("Predicted n½", "Predicted (1 − q)^W", "e^(−x)", "k"). None of the banned words. All are named by design §5, so left | no (by design) |
| `ChCashout.tsx` | 45-47 | info | On a 360 px phone the core `Bars` truncate "Cash out at 20 wins" and "20 wins + stop-loss" to "Cash out at 20..."; the table and summary carry the full text. Core behaviour | no |
| `ChTry.tsx` | 20 | info | "median net", "P(ahead)", "mean net" appear in lay copy on purpose: they are the exact Analyze labels (checked in `AnalysisView.tsx`) mapped to the lay words | no (intended) |
| `ChStart.tsx` vs `ChLimits`/`ChShapes`/`TryIt` | 47 | info | The same ladder is "Streets with a cash-out" (ch 0, design text), "c9, hybrid" (ch 6), "c9: streets to 12, stacked" (ch 8), "Keeper c9 + cash-out" (ch 9). Chapter 0's body names it c9. Names are design-fixed; left | no |
| `content.ts` vs components | n/a | info | Prose writes "90.3 %" and "−$3,210", tiles write "90.3%" and "-$3,210.44" (rounded vs exact, "about" in prose). Not an error | no |

## Checked, no finding

- Data keys: every chart reads the row or path the design lists (ch 1 `e1-spread`, ch 2 the three `observations`, ch 3 `e3a-L5..L10` plus the two Martingale rows, ch 4 `-g-stop` and `-x2` twins, ch 6 `e6-full@…` and `e8-seed3@3`, ch 7 `e7-c9`, `e7-mart:e7m-stop-W20`, `e7b-L7stop-W20`, ch 8 the five column keys). Cents are formatted through `formatMoney`; no dollar/cent mix.
- Predictions: ch 4 tick is `ln 2 / (meta.q * meta.p)` of the `-g-stop` row (dozen 159, six-line 147, 25 numbers 286, two dozens 200, as `content.ts`); ch 7 uses `meta.q` of the c9 rows (0.00356); ch 3 uses `ladder()` with base = bankroll / (2^L − 1) = $5 (L5 40, L8 295, L10 1,117, y domain 0 to 1,200).
- Calculator: `calculator.ts` equals design §7 (`e^(−q·min(W, p·S))`, typical = profit × cycles when the chance is above one half, cap loss = Σ amounts); defaults and presets equal the design (red $5 preset: bankroll $5,115, L 10).
- Try it: `TRY_RULES` overrides outside min 100 and inside minTotal 100, bankroll 500000, maxRounds 500, sessions 10000, seed 20261031; equal to `data.candidates[].rules/session`.
- DataTable fallbacks carry every plotted value (ch 2 all 30 spins and 5 series, ch 5 all 53 ladders with x, share, ceiling, k, ch 4 all four series, ch 1 p10/p90/typical/average/SD). Chart `svg`s are `role="img"` named by title and summary through `ChartFrame`; `aria-hidden` is only on legend swatches and the `$` sign.
- Colour never alone: shapes (DotRows, Scatter), dashes (LineBand, ch 2), signed labels (Bars), filled against outlined cells (board).
- Tone: no variance, quantile, skew, CVaR or expectation in any component string or in any lead. Chapter prose only uses them in math blocks.
- Dark mode: no literal colour in any Research CSS or TSX; dark screenshots at 360 px of chapters 4 and 6 are legible.
- Tap targets: no `a`, `button`, `summary`, `input` or focusable region under 43.5 px at 360 or 1280.
- Chapter numbers: eyebrow, chip `aria-label` and the file comments all count from 0.
- Shell edits (`routes.tsx`, `router.ts`, `Nav.tsx`, `TopBar.tsx`, `More/index.tsx`) match design §2.
- Not run: the e2e suite (another work package owns `tests/e2e/research.spec.ts`).
