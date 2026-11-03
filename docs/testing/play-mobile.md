# Play mode on phones: test plan

Reported on a Pixel 11 Pro (Chrome, Android), not on desktop:

1. During longer sessions the screen **moves around and zooms out** when buttons are tapped.
2. The page **does not fit**: the table plus the bottom bar(s) are taller than the screen, so you either zoom out to see the action bar or zoom in and frame the rest poorly.

Reproduced in Playwright (Pixel 7 emulation, 412×775): at load the board spans y=377–889 under a sticky action bar at y=670–714, so the bar covers the board. After the first spin `scrollY` jumps 0 → 525, and taps on Spin are intercepted alternately by `.play-bar` and `.play-grid`, so the layout is shifting under the finger.

## Target devices (CSS px)

| Name | Viewport | Why |
|---|---|---|
| phone-360 | 360×780 | small Android |
| phone-390 | 390×844 | iPhone-class, the existing `phone` project |
| pixel-pro | 412×915 | Pixel Pro class, installed app / full screen |
| pixel-pro-chrome | 412×780 | Pixel Pro with Chrome's address bar and gesture bar showing |
| phone-short | 412×700 | short viewport (keyboard, split screen) |
| landscape | 844×390 | existing `phone-landscape` project |

Specs loop over these with `page.setViewportSize` inside the `phone` project (and `test.skip` in the others), so `playwright.config.ts` (a shared file) is untouched.

## Suites (tests/e2e/play-mobile/)

| ID | File | Asserts |
|---|---|---|
| S1 | `fit.spec.ts` | On every portrait size: the session strip, the result line, the **whole board**, the chip rack and the action bar are all inside the viewport at scrollY 0 with no overlap (the bar never covers the board or the rack); the app nav bar does not cover the action bar; no horizontal overflow. |
| S2 | `stability.spec.ts` | 150 real taps (Spin / Rebet & spin, chip changes, bet taps, ×2, Undo): `scrollY` stays put, the action bar and board rects do not move by more than 1px, `visualViewport.scale` stays 1, `scrollWidth === clientWidth`, and `document.elementFromPoint` at the Spin button's centre is the Spin button every time (nothing covers it). |
| S3 | `zoom-guards.spec.ts` | Viewport meta is `width=device-width, initial-scale=1`; every interactive element in the Play screen (buttons, board cells, chip radios, segmented controls) computes `touch-action: manipulation` (no double-tap zoom on fast repeated taps); every text input/select in Play sheets is ≥16px (no focus zoom); nothing in Play is wider than the viewport. |
| S4 | `long-session.spec.ts` | A 1,000-spin session (built by the real core with a seeded RNG and written to `spinner:play:session`) plus extreme numbers (bankroll $9,999,999, net −$123,456): header, result strip, stats panel (opened), last-spins log and history list stay inside the viewport width; the page height stays bounded (log/strip capped); S1's fit still holds. |
| S5 | `sheets.spec.ts` | On phone sizes, the Layouts, More, Session and Save-as-layout sheets fit the viewport and scroll internally; closing each restores the previous `scrollY` and the bar position; landscape 844×390: Spin, Rebet and ×2 are reachable without page zoom. |
| S6 | `desktop-controls.spec.ts` | Desktop (≥1024px, run in the `desktop` project at 1280×800 and 1440×900): the action bar (Undo, Clear, Rebet, ×2, Spin) sits **directly under the board, inside the left column, left of the Stats panel** (its left/right edges within the board column, its top within 24px of the board/chip-rack bottom). After 300 spins (the last-spins log in Stats grows), the action bar's rect is unchanged (±1px) and it never moves to the bottom of the screen. Written by the first fix-baton holder (added after the writers started). |
| R | existing suites | `npm run check` and the whole Playwright suite (all four projects) stay green; Play is axe-clean on phone. |

## Fix expectations (what the fixers aim at)

- Phone portrait Play is a **one-screen layout**: compact header, result line, board sized to the space left (`dvh` aware), chip rack and action bar docked together above the app nav. No sticky element floats over content.
- Spinning never moves the page: results replace content of fixed size; no focus or scroll jumps; toasts do not shift layout.
- `touch-action: manipulation` across the Play screen; inputs ≥16px.
- Nothing grows with session length beyond fixed caps.
- **Desktop (user report):** the action bar must not sit after the whole two-column grid (the growing Stats log pushes it down). Put it in the board column right under the board and chip rack, to the left of Stats, static (not sticky to the viewport bottom on desktop). Phone keeps the docked bottom layout.

## Batons (who may edit what)

| Path | Owner |
|---|---|
| `tests/e2e/play-mobile/<suite>.spec.ts` | that suite's writer (Write phase), then the baton holder |
| `tests/e2e/play-mobile/helpers.ts` | S1 writer creates it; read-only for other writers; baton holder after |
| `src/app/screens/Play/**`, `src/app/styles/**`, `src/game/roulette/ui/**`, `src/core/ui/**` | the **fix baton** holder only (one fixer at a time, passed in order with a handoff note) |
| `package.json`, tsconfigs, ESLint, `playwright.config.ts`, `vite.config.ts`, `src/app/routes.tsx` | orchestrator only |

Resources: every agent sets its own `PORT` (writers 4301–4305, fixers 4310+) and `PW_WORKERS=1`. Writers never build; the orchestrator builds `dist` before the Write phase, and the fix-baton holder rebuilds after each change.
