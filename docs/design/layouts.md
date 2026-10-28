# Table layouts and tap-to-place chips (design spike)

Spike output for the owner's request (2026-10-28):

> "I want an easier way to build table bets so I can just tap chips onto the board instead of having
> a multi step flow for each chip I put out. I want to be able to built table layouts and save them
> off and them use them as layouts in multiple experiments. The layout should be generically defined
> with single denomination chips and then when I select the layout to be used in a stage of an
> experiment, I should be able to select what denomination I want to use."

Authority: `decisions.md` > this file > the other design docs > code. Where this file proposes a
contract change, it is listed in §10 and only lands through WP-L0 (§12) with the orchestrator's
sign-off.

**Summary.**

- A **layout** is a new library entity: a named, game-tagged set of bet spots, each holding a whole
  number of identical chips. It has no money value of its own.
- A stage *uses* a layout by **copying** it into an `x-chips` block, together with a **chip value**:
  a denomination in cents, the strategy unit, or a progression.
- The builder compiles that block into ordinary `LayoutSpec` rows, such as
  `{ bet, amount: chips × value }`, using expression forms that already exist.
- The interpreter, worker, validator, plugin, run bundles and golden traces are therefore
  unchanged. Runs stay self-contained, and an older build still runs a definition that uses layouts.
- The tap-to-place editor is a generic shell in `core/ui` around a game-supplied `ChipBoard` (an
  optional `GameUi.chips` addition). It is reachable from Library → Layouts and inline from every
  stage.

A throwaway prototype confirmed the compile path on the real code (since deleted):

- `normalizeStrategy` keeps a stage `x-chips` block.
- `validateStrategy` reports nothing for `{ times: [14, { prog: 'm' }] }` rows.
- A Martingale on `track: 'round'` doubles every spot of a James Bond + voisins layout after each
  losing spin, then resets.
- James Bond lifted to chips at `{ units: 1 }` compiles to a byte-identical `layout`.

---

## 0. Decisions at a glance

| # | Question | Decision | Main alternative (rejected) |
|---|---|---|---|
| D1 | What a layout is | `ChipLayout { schema, id, name, game, variant, spots: { bet, chips }[] }`, chip counts only, no money | Spots with amounts in cents (that is a strategy, not a reusable shape) |
| D2 | Where it lives | New IndexedDB store `layouts` (DB v2, structural upgrade only) plus a Library tab | A kind of strategy in the `strategies` store (pollutes strategy lists and types) |
| D3 | How a stage uses it | **Ref plus frozen copy**: `stage['x-chips'] = { v, spots, chip, from?: { id, hash, name } }` | A pure reference resolved at normalize time (breaks bundle self-containment and `definitionId` stability) |
| D4 | Compile path | The builder writes `LayoutSpec` rows from `x-chips` with the existing `times`/`units`/`prog` expressions. **No interpreter, worker or validator change.** | A first-class `Stage.chips` field expanded by the compiler (contract and interpreter change; an older app could not run it) |
| D5 | Denomination | Per stage, `chip: Cents \| { units: 1 } \| { prog: p }`. A spot's amount is `chips × chip value` | A denomination stored in the layout (the owner asked for it at use time) |
| D6 | Progressions | `chip: { prog: m }`: the whole layout scales with `m`. `m.base` is the starting chip value, and `track: 'round'` is the default for progressions the panel creates | A new `{ progMult }` expression (contract and interpreter change; kept as a chip) |
| D7 | Limits, partial bets | Unchanged: roulette `reconcile` per spot (cut to max, OQ1; bet what fits in order, OQ4). The editor and stage panel run a **reconcile dry run** and show every cut before a run | Layout-atomic funding (new semantics; §3.5 and open question Q2) |
| D8 | Call bets | One spot per call bet (`voisins`, `neighbours:17:2`). Its `chips` is the total chip count, a multiple of its pieces, so one tap adds `pieces` chips | Expanding into component spots (loses the single resolution and progression tracking) |
| D9 | Editor | Tap to add. An **Add / Remove** tool toggle. Undo/redo/clear. A **bet-type lock** for big targets on phones. A spot sheet and a spot list for precision and accessibility | Long-press to remove; a sheet for every tap (today's multi-step flow) |
| D10 | Inline chips | Yes: every stage can tap chips without saving a layout, and save them as a layout later | Library-only layouts (more steps for a one-off) |
| D11 | Existing presets | **Not migrated** (goldens untouched). Chip-shaped stages, such as James Bond's, can be lifted on demand ("Edit on the table") with identical rows | Rewriting presets to `x-chips` (changes `definitionId`s for no behaviour gain) |
| D12 | Versions | No `CORE_VERSION`, plugin version, `STRATEGY_SCHEMA`, `DEFINITION_SCHEMA` or bundle-version bump. `DB_VERSION` 1 → 2. New `LAYOUT_SCHEMA = 1` | Bumping `CORE_VERSION` (would orphan resume and re-simulation of every existing run while no output changes) |

---

## 1. Prior art

- **crappy:**
  - Its "layouts" (`src/sim/ui/layouts/*`) are table *geometry* (portrait/landscape regions), the
    same role as `src/game/roulette/ui/geometry.ts`.
  - Its sandbox bet sets are `BetInit[]` with dollar amounts, persisted in localStorage and in share
    links as `bets=pass-line:10,come@6:5`.
  - Placement works like this: a `ChipRack` radiogroup holds the denominations
    (`[100, 500, 2500, 10000, 50000]` cents, default $5), a region tap opens a bet sheet, and a stack
    tap opens the edit sheet.
  - What we take:
    - the chip-rack radiogroup and its denominations, for the stage's chip-value picker;
    - "regions as data" for hit testing.
  - What we drop: the sheet-per-tap flow, which is the multi-step flow the owner wants gone.
- **PLAYBOOK Appendix B** ("importing crappy sandbox layouts as a stage") is satisfied in shape:
  - `ChipLayout` is game-tagged and lives in core, so a future craps app can import a crappy `bets=`
    list. Each `type:dollars` becomes `{ bet, chips: dollars / denom }` for the list's common
    denomination.
  - That importer is not part of this feature (no craps plugin exists here); it is recorded as a
    chip.
- **spinner today:**
  - Stage layouts are `LayoutSpec[]` rows edited one at a time: Add bet → BetPicker → amount
    editor sheet → close.
  - `Board` (`board.tsx`) already draws chips from `Chip { spot, cents }` and has hit regions for
    cells, outside boxes and fine-pointer hot zones.
  - `chipsOf` (`chips.ts`) already expands call bets into their component spots for display.

---

## 2. Data model (D1, D8)

### 2.1 Types (new `src/core/contracts/layout.ts`, game-agnostic)

```ts
import type { BetId, Cents } from './game';
import type { Slug } from './strategy';

export const LAYOUT_SCHEMA = 1 as const;
/** Same as the stage layout limit after flattening (strategy.md §2.1). */
export const MAX_LAYOUT_SPOTS = 64;
/** Chips on one spot; 1000 × $1 already exceeds every roulette inside maximum. */
export const MAX_CHIPS_PER_SPOT = 1000;

/** One bet spot with a whole number of identical chips. */
export interface LayoutSpot {
  bet: BetId;      // canonical id (aliases are rewritten on save, as definitions do)
  chips: number;   // integer 1..MAX_CHIPS_PER_SPOT; call bets: a multiple of the game's step
}

/** A reusable table layout: a shape, no money. */
export interface ChipLayout {
  schema: typeof LAYOUT_SCHEMA;
  id: Slug;          // library key, /^[a-z][a-z0-9-]{0,39}$/, stable across renames
  name: string;      // 1..80 chars
  game: string;      // plugin id ('roulette')
  /** Rules preset the board was drawn on ('european' | 'american' | 'triple-zero'). */
  variant: string;
  notes?: string;    // <= 4000 chars
  tags?: Slug[];     // <= 16
  /** 1..64 spots, unique bets, in placement order (that order is the funding order, §3.5). */
  spots: LayoutSpot[];
  [ext: `x-${string}`]: unknown;
}

/** IndexedDB record of the `layouts` store (keyPath `id`, index `byUpdated`). */
export interface LayoutRecord {
  v: 1;
  id: Slug;
  layout: ChipLayout;
  /** layoutHash(layout): sha256 hex of canonicalJson({ game, variant, spots sorted by bet }). */
  hash: string;
  createdAt: string;
  updatedAt: string;
  derivedFrom?: Slug;          // duplicated from
  origin: 'user' | 'import' | 'builtin';   // 'builtin' = a saved copy of a built-in layout
}

/** What one chip is worth in a stage (D5, D6). */
export type ChipValue =
  | Cents              // a denomination, e.g. 500 = $5 chips
  | { units: 1 }       // the strategy unit (follows the Session card's Unit)
  | { prog: Slug };    // the current amount of a progression (the layout scales with it)

/** The value of a stage's `x-chips` key (D3). Ignored by the interpreter. */
export interface StageChips {
  v: 1;
  spots: LayoutSpot[];          // the frozen copy, 1..64
  chip: ChipValue;
  /** Where the copy came from; absent for chips placed inline. */
  from?: { id: Slug; hash: string; name: string; builtin?: true };
}
export const STAGE_CHIPS_KEY = 'x-chips' as const;

/** Export file for one or more layouts (`<slug>.layout.json`). */
export const LAYOUT_FILE_FORMAT = 'casino-lab-layout' as const;
export interface LayoutFileV1 {
  format: typeof LAYOUT_FILE_FORMAT;
  version: 1;
  app: { id: string; version: string };
  layouts: ChipLayout[];        // 1..500
}
```

### 2.2 Settled points

- **Identity.**
  - `id` is a slug allocated from the name at creation (`corners-and-red`, then `-2`, `-3` …,
    like strategy duplicates) and never changes. Renames change only `name`.
  - `hash` identifies the *content*: game, variant and spots, sorted by bet so that placement order
    alone does not make a layout "different". It is not a key.
  - Two library layouts may have the same name.
- **Variant ("which wheels").**
  - `variant` records the board the layout was drawn on; it is a rules preset id, so it stays
    generic. Applicability to other wheels is **derived, not stored**: for each preset of
    `plugin.rules.presets`, the compiled spots go through `validateStrategy` with that preset's
    rules. The preset applies when no `E_UNKNOWN_BET` or `E_BET_UNAVAILABLE` comes back.
  - The Library shows badges ("European · American", or "European only" for a layout with
    `voisins` or `split:0-1-2`…).
  - A stage on a wheel that lacks a spot gets the normal validator errors on the generated rows.
- **Validation** (`validateChipLayout`, §5.3):
  - schema;
  - slug, name and notes lengths;
  - the game matches;
  - 1..64 spots;
  - integer chips in 1..1000;
  - no duplicate canonical bet;
  - every bet available on `variant`, reusing the strategy validator by compiling to a throwaway
    one-stage strategy and mapping `/stages/0/layout/i/bet` to `/spots/i/bet`;
  - aliases rewritten to the canonical id, with the warning `W_LAYOUT_ALIAS`. The strategy
    validator has no alias warning; it only rejects ids it cannot parse.
  - An empty layout is a draft state only: Save requires at least one spot.
- **Call bets and neighbours** (D8):
  - One spot, `bet: 'voisins' | 'tiers' | 'orphelins' | 'jeu-zero' | 'neighbours:<p>:<k>'`.
  - `chips` is the total chip count: voisins ×1 = 9 chips, `neighbours:17:2` ×1 = 5 chips. This
    matches game.md §3.3, where a call bet's `amount` is its total.
  - The game's `step(bet)` (§6.2) is the number of chips one tap adds and removes, so counts stay
    multiples of the pieces. `reconcile` would round a stray count down anyway (adjusted `rounded`).
  - A plain spot that is also a call-bet component (`split:17-20` plus `orphelins`) stays a
    separate spot. Per-spot maxima add up across them in `reconcile` (game.md §4).
- **Multi-chip spots:** `chips: n`. There is one spot per bet; stacking is the count.
- **Default denomination:** none is stored in a layout. The owner wants it picked at use time.
  - The stage picker preselects the **smallest standard denomination at which the layout passes
    the table minimums** (§3.4).
  - The editor's preview value is a per-device convenience, not part of the layout.
  - This is open question Q1.
- **Built-in layouts** (read-only, listed like the strategy presets, in
  `src/game/roulette/layouts.ts`):
  - James Bond (`high` 14, `sixline:13-…-18` 5, `straight:0` 1);
  - Voisins, Tiers and Orphelins (each ×1);
  - Zero and neighbours (`neighbours:0:2` ×1);
  - Two dozens (`dozen:1` 1, `dozen:2` 1).

  Opening one offers "Duplicate to edit"; `from.builtin` marks stages that copied one.

---

## 3. A stage uses a layout (D3–D7)

### 3.1 By reference plus frozen copy

The stage stores a **copy** of the spots, plus `from: { id, hash, name }` for provenance. The
interpreter never looks at the library. Alternatives considered:

| Option | Reproducible runs | Bundles self-contained | Edit propagation | Verdict |
|---|---|---|---|---|
| Pure reference (`{ layoutRef: id }`, resolved in `normalizeDefinition` like `strategy: { ref }`) | Only because normalization inlines it, after which the ref is gone, as with strategy refs today | Yes after normalize | Silent: a re-normalized draft picks up edits | Rejected: the stage could not show its source after save, and the inline step needs a contract change in `NormalizeContext` |
| Embedded snapshot only | Yes | Yes | None (no link back) | Rejected: "use in multiple experiments" wants "this came from layout X" |
| **Ref plus frozen copy** | **Yes** | **Yes** | **Explicit**: the stage shows "Layout X changed since this stage used it: Update / Keep" | **Chosen** |

- **Editing a layout after runs exist** never touches runs or saved definitions:
  - A run bundle embeds the normalized definition, and with it `x-chips.spots` and the compiled
    rows.
  - Saved definitions are immutable (an edit saves a new definition, the existing Define
    behaviour).
- **What changes after an edit:**
  - Open a definition in Define whose `from.hash` no longer equals the library record's `hash`. The
    stage panel shows the banner; Update re-copies the spots (a new `definitionId`), Keep dismisses
    it for the session.
  - Library → layout → "Used in": the saved definitions whose stages have `from.id === id`, found by
    a scan of `definitions` (cheap; at most a few thousand records).
- **Editing chips in a stage that came from a layout** keeps `from`. The panel then reads
  "Corners and red (edited)", because `sameSpots(spots, library spots)` is false. It offers "Save
  as new layout" and "Update layout Corners and red".
- **Deleting a library layout** leaves every stage's copy working. Its `from` then reads
  "Corners and red (deleted)".

### 3.2 Representation in the strategy JSON

`x-` keys are allowed anywhere, kept by `normalizeStrategy`, hashed into `definitionId`, and ignored
by the interpreter (strategy.md §2; checked by the prototype). A stage that uses chips looks like
this:

```json
{
  "id": "play",
  "x-chips": {
    "v": 1,
    "chip": 500,
    "from": { "id": "corners-and-red", "hash": "9f2c…", "name": "Corners and red" },
    "spots": [
      { "bet": "red", "chips": 2 },
      { "bet": "corner:1-2-4-5", "chips": 1 },
      { "bet": "voisins", "chips": 9 }
    ]
  },
  "layout": [
    { "bet": "red", "amount": 1000 },
    { "bet": "corner:1-2-4-5", "amount": 500 },
    { "bet": "voisins", "amount": 4500 },
    { "bet": "dozen:3", "amount": { "units": 1 }, "when": { "cmp": ["net", "<", 0] } }
  ],
  "rules": []
}
```

- **Generated prefix.**
  - The first `spots.length` rows of `layout` are generated, in spot order. The remaining rows are
    manual ("Other bets"), such as the `when`-guarded dozen above.
  - No per-row marker is written, which keeps the JSON and hashes tidy.
  - The builder model checks the prefix on load (§7.1). A mismatch, for example after hand-editing
    the JSON, marks the chips **stale**: every row is shown as manual, with the banner "These chips
    no longer match this stage's bets (edited as JSON): Rebuild bets from chips / Forget chips".
  - The interpreter runs `layout` as written, so a stale block can never change a run.
- **First-decided wins** (strategy.md §3.5.1): a manual row for a bet that is also a chip spot is
  ignored, and the builder flags it `W_CHIPS_SHADOWED`.
- **`extends`:**
  - A child stage's flattened layout is its rows, then its parent's (strategy.md §3.6), so parent
    chip spots the child lacks are still placed.
  - The chips panel shows them as "Inherited from *flat*: 3 spots" (read-only, faded on the
    thumbnail).
  - Override a spot by giving the child the same bet.

### 3.3 Denomination and the compile rule (D5, D6)

Each spot compiles to one row: `{ bet, amount: chipAmount(chips, chip) }`.

| `chip` | Amount written | Example (3 chips) | Notes |
|---|---|---|---|
| `d` (cents) | literal `chips × d` | `1500` for $5 chips | Exact integer; the panel's chip rack |
| `{ units: 1 }` | `{ units: chips }` | `{ "units": 3 }` | Follows the strategy unit; the exact form presets already use (lift, §7.3) |
| `{ prog: p }` | `chips == 1 ? { prog: p } : { times: [chips, { prog: p }] }` | `{ "times": [3, { "prog": "m" }] }` | The layout scales with `p` |

- **Does a Martingale multiply the whole layout? Yes**, when the stage's chip value is
  `{ prog: m }`:
  - every spot is `chips × amount(m)`, and `amount(m) = mult(k) × base` (strategy.md §7.4), so the
    layout's shape is kept at every level;
  - `m.base` is "the starting chip", and the panel shows and edits it as the denomination
    ("Chip value: follows *m*, starting at $5").
- **The panel's "New progression for these chips"** creates a progression with:
  - the kind the user picks;
  - `base` = the selected denomination, in literal cents;
  - `track: 'round'`, so a spin "wins" when the round's net is positive (the right result for a
    multi-spot layout);
  - `feed` left at `'sized'`: the progression only learns from rounds whose rows read it (§7.2;
    every generated row reads `{ prog: m }`).
- **Several stages may share one progression with different layouts.** They share its level, which
  is the existing semantics.
- **A non-constant `base`** (such as `{ pctOfBankroll: 2 }`) still works, because the expression is
  evaluated as usual. The panel then shows the base as a formula and cannot preview money.
- **Rejected alternatives:**
  - `{ times: [chips, d, { div: [{ prog: m }, base] }] }`, a denomination times a multiplier.
    It is correct only for constant bases and is harder to read.
  - A new `{ progMult: p }` expression. It is clean, but it changes the contract and the
    interpreter; it is kept as a chip in case per-stage denominations on one shared progression
    are wanted later.
- **Exactness:**
  - Literal amounts are exact integers.
  - `times` of an integer count and an integer-cents `prog` is exact well below 2^53, and amounts
    are floored at the boundary anyway (strategy.md §4.3).
  - Prototype check: 14 × $5 × 2^k produced exactly 7000, 14000 and 28000.

### 3.4 Limits, affordability and partial bets (D7; open-questions.md items 1 and 4)

Nothing changes in the engine or `reconcile`. The consequences of its per-spot policy for a layout
are made **visible before a run**:

| Situation | `reconcile` today (unchanged) | What the editor and stage panel show |
|---|---|---|
| A spot above its max (a straight with $600 on it) | Cut to the max (`clamped`), OQ1 | That spot's chip is red-ringed: "Straight 17: $600 → $500 (table max)" |
| Inside chips total below $25 | Every inside and call entry rejected (`inside-min-total`) | Banner "Inside bets total $15; the table needs $25. Use $5 chips or more." |
| An outside spot below $25 | Rejected (`below-min`) | "Red: $5 is below the $25 outside minimum" |
| Bankroll short | Earlier spots funded in full, then reduced; spots below their minimum rejected (OQ4) | Under the session bankroll: "With $300 cash: 3 of 5 spots placed"; it lists which |
| Progression top level above a max | Cut at that level | "At level 6 ($160 a chip) straight 0 is cut to $500" (computed from `progressionTop`, §5.1) |

- **How the checks are computed.** `checkAtTable(plugin, rules, rows, bankroll)` (§6.3) runs the
  real `plugin.reconcile` on a fresh `createState({ rules, rng, bankroll })` and reads `rejected`
  and `adjusted`. It is generic, needs no game code, and is exactly what the run will do.
- **Funding order** is the spot order, which is placement order. The spot list (§4.5) shows the
  order and lets the user move a spot up or down for that reason.
- **Default chip value:**
  - the smallest of the standard denominations (`GameUi.chips.denominations`; roulette
    `[100, 500, 2500, 10000, 50000, 100000]`) at which `checkAtTable` at a large bankroll reports no
    rejection and no `clamped`;
  - when none qualifies, the smallest one, flagged.
- **Table max per spin** (`maxTotalPerSpin`, null by default) is shown as a total check when it is
  set.
- **Layout-atomic funding** ("if the whole layout can't be afforded, shrink every spot evenly", or
  "skip the spin") is a product choice; see Q2.
  - "Shrink evenly" can later be generated without contract changes as
    `chip = { min: [V, { floorTo: [{ div: ['bankroll', totalChips] }, 100] }] }`. Because the
    expression reads `{ prog }`, arming still works.
  - It is not in these WPs.

### 3.5 Compile path

```
library ChipLayout ──copy──► stage.x-chips { spots, chip, from }
                                   │ builder model toJson (core/ui/builder, via core/strategy/chips.compileChips)
                                   ▼
                    stage.layout = [generated rows…, manual rows…]   ← the only thing the interpreter reads
                                   ▼
            normalizeDefinition → definitionId → worker → reconcile → engine   (all unchanged)
```

- The harness, worker protocol, `reconcile`, traces, summaries, breakdowns and bundle codec need
  no change.
- `definitionId` changes only for definitions that carry `x-chips`, because the block is hashed.
  That is intended: provenance is part of the experiment, just as `name` is.
- `simKey` (which ignores names) still includes `x-chips.from.name`. Renaming a library layout does
  not touch existing definitions, so this only matters for two definitions that differ by layout
  name alone. That is acceptable, and it is documented.

---

## 4. The tap-to-place editor (D9)

One editor, two hosts:

- **Library → Layouts** edits a saved `ChipLayout` (name, variant, spots).
- **A stage's "Edit chips"** edits `x-chips.spots` in a full-screen sheet, and can "Save as
  layout".

Phone first: 360 px portrait, 390 px, landscape at 844 × 390 (the e2e viewport) and 915 × 412
(Pixel class).

### 4.1 Portrait (360 × 780)

```
┌──────────────────────────────────────┐
│ ←  Corners and red            [Save] │ 48  header (name is a field in ⋯)
│ [ Table ][ Call bets ][ List ]       │ 44  tabs (Call bets: European only)
│ (●Add)(○Remove)   ↶  ↷   Clear  ⋯   │ 48  tool row (sticky)
│ Bet: [Auto][1][Split][Street][Corner][Line] │ 44  bet-type lock (game row, h-scroll)
│ ┌────┬────┬────────────────────────┐ │
│ │    │    │           0            │ │
│ │1–18│    ├───────┬───────┬────────┤ │
│ │    │1st │   1   │   2 ② │   3    │ │ board: Board geometry, scaled to
│ ├────┤ 12 ├──●────┼───────┼────────┤ │ 328 px (cell ≈ 74 × 42 px)
│ │EVEN│    │   4   │   5   │   6    │ │ ② = chip with a count badge
│ ├────┤    │  ...  │       │        │ │ ● = chip on a line (split 1|4)
│ │RED③│    │       │       │        │ │
│ │ ...│ ...│  34   │  35   │  36    │ │
│ ├────┴────┼───────┼───────┼────────┤ │
│ │         │  2:1  │  2:1  │  2:1   │ │
│ └─────────┴───────┴───────┴────────┘ │
│ 12 chips · 6 spots · Preview $5: $60 ✓│ 40  status (sticky bottom, aria-live)
└──────────────────────────────────────┘
```

The header, tabs, tool row, lock and status take 224 px and the board ≈ 600 px. The tool row and
status are sticky, so the page scrolls only the board at 360 × 780; there is no horizontal scroll
(e2e asserts it).

### 4.2 Landscape (844 × 390 and wider; `useOrientation` → `landscape` above 600 px)

```
┌──────────────────────────────────────────────────────────┬──────────────┐
│ ← Corners and red                                         │ [Save]       │
├──────────────────────────────────────────────────────────┤ (●Add)       │
│ ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬───┐              │ (○Remove)    │
│ │  │ 3│ 6│ 9│12│15│18│21│24│27│30│33│36│2:1│              │ ↶   ↷  Clear │
│ │0 │ 2│ 5│ 8│11│14│17│20│23│26│29│32│35│2:1│              │ Bet: Auto ▾  │
│ │  │ 1│ 4│ 7│10│13│16│19│22│25│28│31│34│2:1│              │ Call bets ▸  │
│ │  ├──┴──┴──┴──┼──┴──┴──┴──┼──┴──┴──┴──┤   │              │ 12 chips     │
│ │  │  1st 12   │  2nd 12   │  3rd 12   │   │              │ 6 spots      │
│ │  │1–18│EVEN│ RED │BLACK│ODD │19–36  │   │              │ $5: $60 ✓    │
│ └──┴────┴────┴─────┴─────┴────┴───────┴───┘              │ List ▸       │
└──────────────────────────────────────────────────────────┴──────────────┘
                     board ≈ 632 px wide (cell ≈ 44 × 50 px)              rail 180 px
```

The rail holds the tool, history, lock and totals. "Call bets" and "List" open as side sheets.
On a desktop at 1024 px or wider, the list sits permanently under the rail.

### 4.3 Interactions

- **Tap a spot: add.** In Add mode, a tap adds `step(bet)` chips (1, or a call bet's pieces). The
  spot's chip shows the count: "3", or "9" for voisins.
  - The covered pockets flash for 300 ms; with reduced motion they stay highlighted until the next
    tap.
  - The status line reads "Split 1 and 4 · 2 chips".
- **Remove: an explicit tool** (Add | Remove segmented control, also the `E` key). In Remove mode,
  a tap takes `step(bet)` chips off; at 0 the spot disappears.
  - Tapping an empty spot in Remove mode does nothing and announces "No chips on Split 1 and 4".
  - Fine pointer bonus: a right-click removes one step in either mode (the context menu is
    suppressed on the board only).
  - Rejected alternatives:
    - long-press to remove: it is hidden, collides with the OS context menu and text selection,
      and we want long-press for the spot sheet;
    - tapping a stack to remove: it collides with stacking more chips, the most common action.
- **Long-press a number (500 ms), or Enter on it with the keyboard:** opens the existing bet sheet
  "Bets on 17", extended with a − n + stepper per row.
  - It reaches every inside bet containing the number with a ≥ 48 px row each.
  - This is the precision path and the WCAG 2.5.8 equivalent control for small line zones.
- **Undo / redo / clear:**
  - The history is a stack of immutable spot arrays (≤ 200 entries, in memory, per editor
    session).
  - Clear is an ordinary undoable step, so it needs no confirm.
  - Shortcuts: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y.
  - Buttons are disabled at the ends, and each step is announced ("Undid: Split 1 and 4, 1 chip").
- **Limits:**
  - Adding a 65th spot is refused with "A layout holds at most 64 spots". The limit lowers by the
    stage's manual and inherited rows when editing a stage.
  - More than 1000 chips on a spot is refused.
- **Count badge:** the chip face shows the chip count in the layout editor. With a preview value
  set, the status shows money and the chip's accessible name gives both: "3 chips, $15".
  - The read-only `TableView` (Watch) keeps showing money.

### 4.4 Which bet a tap means (roulette `ChipBoard`)

Inside bets are small on a phone: a horizontal line between two rows is 17.5 px of slack at 360 px.
There are two complementary mechanisms, both pure functions in `geometry.ts` with exhaustive unit
tests.

1. **Auto (the default): edge bands.**
   - A tap within 10 board units of a cell edge also takes in the pocket across that edge.
   - Within 10 units of a corner, it takes in the three pockets around the corner.
   - The tapped pocket set maps to the unique legal bet with exactly that set (`betAt(board,
     point)`):
     - centre → straight;
     - an edge between two numbers → split;
     - an edge to the zero row → zero split;
     - a corner → corner, or trio at the zero row;
     - the outer edge (the street side, `board.edge`) → street;
     - an outer corner → six line;
     - the zero-row corner on number 1's dozen side (the `basket` anchor) → basket.
   - When no legal bet matches (the 000-trio side, for instance), the tap falls back to the
     straight.
   - At 360 px a straight's target is ≈ 56 × 25 px, a vertical-line split ≈ 17 × 25 px and a corner
     ≈ 17 × 17 px.
2. **Bet-type lock: Straight | Split | Street | Corner (corner, trio, basket) | Line (six line).**
   - When locked, a tap anywhere in a cell picks the bet of that family that contains the tapped
     pocket and whose `anchorOf` is **nearest** to the tap point (`betNearest(board, point,
     family)`).
   - So every inside bet gets a large target:
     - Split: the four triangles of the cell, each ≈ 74 × 21 px at 360 px;
     - Corner: the four quadrants;
     - Line: the cell's halves;
     - Street: the whole cell.
   - In the 0 cell, Split picks the nearest zero split along its edge, and Corner picks the nearest
     trio or basket.
   - The lock is per device (localStorage, try/catch) and shows in the status ("Split mode").

Outside boxes are always direct (≥ 54 × 96 units). Fine-pointer hover highlights the covered
pockets of the bet a click would take, which reuses `covered`.

### 4.5 Call bets, neighbours and the spot list

- **Call bets tab** (European only; hidden on other wheels, and layouts with call spots are
  flagged on them):
  - It reuses `CallsPanel`: four sector rows (voisins, tiers, orphelins, jeu zéro), each with its
    pocket count, its components and a **− n + stepper** in steps of its pieces.
  - **Neighbours:** a centre-pocket grid, a k stepper (1–9, default 2) and an "Add" button
    (+2k+1 chips). Placed neighbour spots are listed with steppers.
  - On the board, call-bet chips are drawn **expanded** as dashed "ghost" chips on their component
    spots, so they are distinguishable from plain chips on the same spot. They are labelled in the
    status ("Voisins ×1, 9 chips").
- **Racetrack.** A tappable racetrack is deferred, as game.md §12.2 already makes it display-only on
  phones and chips.md lists the racetrack as later.
- **List tab** (also the screen-reader-first editor). It shows one row per spot, in funding order,
  each with:
  - the bet name;
  - − n + buttons;
  - a remove button;
  - move up and move down;
  - at a preview value, the money and any table-check message.

  "Add a bet" opens the existing `BetPicker` (Table | Call bets | Type an id) and adds one step. The
  whole layout can be built here without touching the board.

### 4.6 Accessibility

- Every board region stays a `<g role="button" tabindex=0>`. Its accessible name includes the chip
  count and the tool: "Straight 17 (black), 2 chips, pays 35 to 1. Adds a chip."
  - Outside boxes: Enter or Space applies the current tool; Delete or Backspace removes one step.
  - Number cells: Enter opens the bet sheet (keyboard users cannot aim at edge zones).
- The tool and the bet-type lock are radio groups (`role="radiogroup"`, arrow keys), and the tabs
  follow the existing roving-tabindex pattern.
- One polite live region (`aria-live="polite"`) announces every change and every undo or redo.
  Table-check problems use `role="status"`, never `alert`.
- Colour is never the only cue: chips carry their count, and a clamped or rejected spot gets a ring
  plus a "!" glyph and text in the list.
- Hot zones keep `aria-hidden` (as today). The sheet and the list are the equivalent controls.
- e2e runs axe (`expectAxeClean`) in every state: an empty editor, with chips, the sheet open,
  Remove mode, the Call bets tab, the List tab, landscape, and the stage panel.

### 4.7 Placement in the app

- **Library → new "Layouts" tab** (fourth tab, `#/library?tab=layouts`; no route change):
  - Cards show a read-only thumbnail (a `TableView` of the spots at the preview value, or counts),
    the name, the spot and chip count, and variant badges.
  - Actions: Open, Duplicate, Export, Delete (with confirm: "stages that used it keep their copy"),
    "Use in a new experiment" (→ `#/define?layout=<id>`) and "Used in (n)".
  - Built-in layouts are listed first with a "Built-in" pill.
  - "New layout" asks for the wheel (default: the app's default preset), then opens the editor.
- **Editor page** at `#/library?tab=layouts&edit=<id|new>`:
  - It renders full-page inside the Library screen, which keeps `routes.tsx` (a baton) untouched,
    and Android Back closes it.
  - Leaving with unsaved edits asks "Discard changes?".
- **Define, inside each stage card** (the new primary path, above today's rows):

```
┌ Stage 1: play  [entry] ─────────────────── Stage settings ⋯ ┐
│ Chips on the table                                           │
│ ┌──────────────┐  Corners and red · 6 spots · 12 chips       │
│ │ (thumbnail)  │  Chip value  ($1)(●$5)($25)($100)($500) ⋯  │
│ │              │              ( ) follows progression [m ▾] │
│ └──────────────┘  $60 a spin · ✓ fits this table             │
│ [Edit chips] [Use a saved layout] [Save as layout]           │
│                                                              │
│ Other bets (advanced)                                        │
│  bet Dozen 3 for 1 unit when net < 0            ↑ ↓ ✕       │
│ [Add bet]                                                    │
│ Rules …                                                      │
```

- **Chip value options:** the chip rack (a radiogroup, crappy's pattern), "⋯" (custom amount, or
  "strategy unit ($25)"), and "follows progression".
- **"Edit on the table"** replaces "Edit chips" on a stage without chips whose rows are all
  chip-shaped (§7.3). It lifts them with no change to `layout`.
- **"Use a saved layout"** opens a sheet listing library and built-in layouts with thumbnails.
  Picking one copies it and sets `from`; when the stage already had chips, the stage's manual rows
  are kept.
- A new strategy (`emptyStrategy`) keeps its single `red` row, which lifts to chips at `{ units: 1 }`.
  So the first thing a new user sees is a board with one chip on Red.

---

## 5. Core logic (pure, node-tested)

### 5.1 `src/core/strategy/chips.ts` (new file in an existing core module; no ESLint change)

```ts
export function chipAmount(chips: number, chip: ChipValue): Expr;
export function compileChips(c: StageChips): LayoutSpec[];                    // §3.3
export function readStageChips(stage: unknown): StageChips | null;           // shape-checked x-chips
export function splitStageLayout(stage: Stage): {
  chips: StageChips | null; manual: LayoutSpec[]; stale: boolean;           // §3.2 prefix rule
};
export function withStageChips(stage: Stage, chips: StageChips | null): Stage; // writes x-chips, regenerates the prefix
export function liftRows(rows: readonly LayoutSpec[]): StageChips | null;    // §7.3, `chip` chosen by the rows
export function adjustSpot(
  spots: readonly LayoutSpot[], bet: BetId, delta: number,
  lim?: { maxSpots?: number; maxChips?: number },
): { spots: LayoutSpot[]; refused?: 'max-spots' | 'max-chips' | 'none-to-remove' };
export function sameSpots(a: readonly LayoutSpot[], b: readonly LayoutSpot[]): boolean; // order-insensitive
export function validateChipLayout(x: unknown, ctx: ValidationContext | null): Diagnostic[];
export function validateStageChips(def: StrategyDefinition): Diagnostic[];   // builder-level (§5.3)
export function progressionTop(spec: ProgressionSpec, unit: Cents): Cents | null; // top-level amount, constant bases
```

`liftRows` accepts only rows with no `when`, `parent`, `working` or `label`, and amounts all of one
of the following forms. The first `n` rows that qualify are lifted, and the rest stay manual.

- `{ units: n }`, where n is a positive integer → `chip: { units: 1 }`;
- `{ prog: p }` or `{ times: [n, { prog: p }] }`, all with the same `p` → `chip: { prog: p }`;
- a positive integer literal, only when the stage's `x-chips.chip` is a number. A lone literal row
  without `x-chips` is ambiguous, so it is not lifted.

### 5.2 `src/core/store/layouts.ts` (core-store)

```ts
export function layoutHash(l: ChipLayout): Promise<string>;   // sha256Hex(canonicalJson({ game, variant, spots: sorted }))
export function allocLayoutId(name: string, taken: ReadonlySet<string>): Slug;
export function encodeLayoutFile(layouts: ChipLayout[], app: { id: string; version: string }): string; // canonical JSON
export function decodeLayoutFile(text: string): LayoutFileV1;  // throws LayoutFileError (code + message)
// Repo additions (repo.ts):
//   listLayouts(): Promise<LayoutRecord[]>            // newest first (byUpdated)
//   getLayout(id): Promise<LayoutRecord | undefined>
//   putLayout(rec): Promise<void>
//   deleteLayout(id): Promise<void>
```

### 5.3 Diagnostics (new codes, English messages in `chips.ts`)

| Code | Severity | Where | When |
|---|---|---|---|
| `E_LAYOUT_SCHEMA` | error | layout | `schema` missing or not 1 (newer → "made with a newer version") |
| `E_LAYOUT_SPOTS` | error | layout `/spots` | 0 spots (on save) or more than 64 |
| `E_LAYOUT_CHIPS` | error | `/spots/i/chips` | not an integer in 1..1000 |
| `E_LAYOUT_DUP_BET` | error | `/spots/i/bet` | the same canonical bet twice |
| `E_UNKNOWN_BET`, `E_BET_UNAVAILABLE` | as in the validator | `/spots/i/bet` | reused through the throwaway strategy |
| `W_LAYOUT_ALIAS` | warning | `/spots/i/bet` | an alias was rewritten to its canonical id |
| `E_CHIPS_SHAPE` | error | `/stages/s/x-chips` | malformed `x-chips` (the builder then treats the stage as plain rows) |
| `W_CHIPS_STALE` | warning | `/stages/s/x-chips` | the generated prefix differs from `compileChips` |
| `W_CHIPS_SHADOWED` | warning | `/stages/s/layout/r` | a manual row for a bet that is a chip spot (ignored by the interpreter) |
| `W_CHIPS_TABLE` | warning | `/stages/s/x-chips/spots/i` | the table check (§3.4) cuts or rejects this spot at the session bankroll |

- **Existing validator diagnostics on generated rows** (`E_BELOW_MIN` for an outside spot below
  $25 at a literal denomination, `W_BELOW_MIN_POSSIBLE` for a constant inside total below $25,
  `E_BET_UNAVAILABLE`, `E_UNKNOWN_PROG`) carry the paths `/stages/s/layout/i` with
  `i < spots.length`. The chips panel maps them to spot `i`, rings that chip and lists the message.
  `pathToElementId` gains a `b-chips-<s>` target for them.
- Stage-level codes come from `validateStageChips`. Define merges them into the diagnostics it
  already shows, so the strategy validator is not touched and the goldens are safe.
- `W_CHIPS_TABLE` comes from the UI's table check.

---

## 6. Core/game split and the `GameUi` addition

### 6.1 Core (`src/core/ui/layout/`, inside the existing `core/ui` module)

- `LayoutEditor`, the generic shell:
  - the header (name, Save, ⋯ with rename, variant and notes);
  - the tool row (Add/Remove, undo, redo, clear);
  - the tabs (Table, which hosts the game's `ChipBoard`; List, generic; and any extra panels the
    game provides);
  - the status line and live region;
  - keyboard shortcuts and the unsaved-changes guard.
- `useChipHistory(initial)`: the undo/redo/clear reducer over `LayoutSpot[]`.
- `ChipRack`: the denomination radiogroup.
- `SpotList`: the List tab, using the catalog for names and `GameUi.BetPicker` for "Add a bet".
- `checkAtTable(plugin, rules, rows, bankroll): TableCheck` (§3.4):

  ```ts
  { total, perSpot: { bet, asked, placed, status: 'ok' | 'adjusted' | 'rejected', reason?: string }[],
    affordable }
  ```

  It uses `sessionRng` from `core/rng` to make a state. Core/ui may import rng.
- `defaultDenom(...)` (§3.4).
- `LayoutThumb`: a read-only `TableView` of the spots, at a value or as counts.

### 6.2 Game (`src/game/roulette/ui/`), contract addition in `src/core/ui/game-ui.ts`

```ts
export interface ChipBoardProps<R = unknown> {
  rules: R;
  spots: readonly LayoutSpot[];
  tool: 'add' | 'remove';
  /** Preview chip value in cents for labels, or null to show counts. */
  chipValue: Cents | null;
  /** Ask the shell to change a spot; `delta` is ± the game's step for that bet. */
  onAdjust(bet: BetId, delta: number): void;
  /** The spot changed last: its covered pockets are highlighted. */
  last?: BetId | null;
  /** Per-spot problems from the table check (ringed chips). */
  flagged?: ReadonlyMap<BetId, string>;
}
export interface ChipsUi<R = unknown> {
  /** Board plus the game's own panels (roulette: the Table and Call bets tabs, the bet-type lock). */
  ChipBoard: ComponentType<ChipBoardProps<R>>;
  /** Chips one tap adds or removes (roulette call bets: their pieces). */
  step(bet: BetId): number;
  /** Denominations for the chip rack, ascending, cents. */
  denominations: readonly Cents[];
}
export interface GameUi<R = unknown> {
  TableView: ComponentType<TableViewProps<R>>;
  BetPicker: ComponentType<BetPickerProps<R>>;
  OutcomeGlyph: ComponentType<OutcomeGlyphProps>;
  /** Optional (additive): tap-to-place chips. Absent: the builder shows rows only. */
  chips?: ChipsUi<R>;
}
```

- **Roulette supplies:**
  - `ChipBoard` (`chip-board.tsx`): `Board` in a new `mode: 'place'` with point hit-testing through
    `betAt`/`betNearest`, the count chips, ghost call chips, flashes and rings. It includes the lock
    row, the Call bets tab, and the long-press and Enter sheet with steppers.
  - `step` (pieces from `betDef`).
  - The denominations.
  - Built-in layouts as data.
- `Board`'s `Chip` gets optional `count?: number` and `ghost?: boolean`. These are internal, not
  contract types, and `TableView` and `BetPicker` keep their behaviour; `ui.test.tsx` must still
  pass unchanged.
- The pure `GamePlugin` contract is **untouched**. The table check uses `reconcile`, `createState`
  and `limits`, which already exist. Availability uses the validator, which reads the catalog.

---

## 7. Builder integration and presets (D10, D11)

### 7.1 Builder model (`core/ui/builder/model.ts`)

- `StageCard` gains `chips: StageChips | null` and `chipsStale: boolean`.
  - `fromJson` reads them through `splitStageLayout`. `layout: LayoutRow[]` then holds only the
    manual rows, or every row when the chips are stale.
  - `toJson` writes `x-chips` and the regenerated prefix through `withStageChips`.
- The laws in `model.ts` still hold:
  - `toJson(fromJson(d))` deep-equals `normalizeStrategy(d)`, including for stale stages, which
    round-trip verbatim;
  - `fromJson(toJson(m))` equals `m`.
- `x-chips` moves from `extra` into the model. Older builders carried it in `StageCard.extra`
  anyway, so a definition edited in an older build keeps its block, at worst stale.

### 7.2 Builder UI

- `ChipsPanel` (§4.7) sits above the rows in every stage card, and the "Layout" heading becomes
  "Chips on the table" and "Other bets".
- The editor opens in a full-screen `Sheet`. It edits `x-chips.spots` with the stage's chip value
  as the preview.
- Picking "follows progression → New…" creates the progression (§3.3) through the existing
  progression editor, prefilled.
- `BuilderEnv` gains optional `chips?: {`
  - `ui: ChipsUi;`
  - `plugin: GamePlugin<…>;`
  - `layouts: { list(): Promise<LayoutChoice[]>; save(l: ChipLayout): Promise<Slug> };`
  - `bankroll: Cents;`
  - `}`

  When `env.chips` is absent the builder is today's builder.

### 7.3 Presets and migration

- **No preset changes.** The JSON files, golden traces and the pinned `definitionId` vectors stay
  byte-identical.
- **All 12 presets are chip-shaped** (checked: every row has no `when`, and its amount is
  `{ units: n }` or `{ prog: p }`), so each can be lifted on demand with `layout` unchanged:
  - flat-red (`{ units: 1 }`);
  - James Bond (`{ units: n }`);
  - two-dozens (`{ prog: d }`);
  - the progressions on red (`{ prog: m }`);
  - `red-mart-then-flat`, whose two stages each lift separately.
- A golden-equivalence test proves it (§11): lift, compile, compare `layout` deep-equal, simulate,
  compare the trace byte-equal.

---

## 8. Storage, export and import (D2)

- **IndexedDB `DB_VERSION` 1 → 2:**
  - `DB_UPGRADES[2]` creates the `layouts` store (keyPath `id`, index `byUpdated: updatedAt`);
  - `STORE_NAMES` appends `'layouts'`, which the memory backend picks up;
  - the upgrade is structural only. Every v1 store and record is untouched, and records still
    migrate lazily via `v`.
  - The existing open path already loops `DB_UPGRADES[old+1 … new]`.
  - Edge cases:
    - Another tab still on v1: `onblocked`, then the existing "close other spinner tabs" message.
    - An older build meeting a v2 database (rollback): `VersionError`, then the memory fallback
      with "data from a newer version" (§9.3). Nothing is deleted.
- **App repo (`src/app/services/db.ts`):**
  - `keyOf('layouts')` returns `rec.id`. Today's `default` branch would return `runId`, a real bug
    to avoid.
  - `deleteAll` covers the new store automatically.
  - `exportDefinitions` adds `layouts: LayoutRecord[]`. `AllData` stays `v: 1`, because the field
    is optional and additive: old files import with no layouts, and an older build ignores the
    field.
- **A single layout file:** `<slug>.layout.json`, `LayoutFileV1`, written as canonical JSON.
  - Library → layout → Export writes one layout; "Export all layouts" writes many.
  - The Import screen's `peekFormat` routes `casino-lab-layout` to `decodeLayoutFile`, then
    `validateChipLayout`, then save (`origin: 'import'`):
    - same id and same hash: "already in your library";
    - same id, other hash: a new id `<id>-2`, with the note "imported as".
  - A craps layout file is refused with "this file is for a different game".
- **Run bundles and the gallery:** no format change. The bundle's normalized definition carries
  `x-chips` (the copy) and the compiled rows. A bundle is self-contained, and a gallery run made
  with chips shows them in Define ("Copy definition") with `from` pointing at a layout that may
  not exist on this device ("Corners and red, not in your library: Save as layout").
- **Share links:** carry `x-chips` like any other key. A 64-spot stage adds ≈ 2–3 kB raw, well
  under 1 kB after deflate, and far under `SHARE_LINK_MAX_CHARS` (tested).

---

## 9. Compatibility

| Thing | Version | Effect |
|---|---|---|
| Old definitions and share links (no `x-chips`) | `schema: 1` | Unchanged; rows shown as "Other bets", with "Edit on the table" when chip-shaped |
| New definitions in an older build | `schema: 1` | Run identically (`x-` ignored); the old builder keeps `x-chips` in `extra` |
| Old run bundles and gallery bundles | `version: 1` | Load unchanged; re-simulation allowed (core and game versions unchanged) |
| IndexedDB | 1 → 2 | Additive store; v1 data intact; rollback goes to the memory fallback, never deletes |
| `AllData` export | `v: 1` | Optional `layouts`; both directions load |
| Layout files | new, `version: 1` | `version > 1` refused with "made with a newer version" |
| `CORE_VERSION`, `roulette.version` | unchanged | No output that feeds `runKey`/`simKey`/`resultsDigest` changes, so resume and Watch re-simulation of existing runs keep working. **Orchestrator call**: `contracts/version.ts` says to bump on any contract change; this spike recommends not to, because it is an additive type and an optional UI member only |
| Golden traces and definitionId vectors | unchanged | Enforced by the existing tests plus §11's golden-equivalence test |

---

## 10. Contract change list

| File | Change | Version | Reason |
|---|---|---|---|
| `src/core/contracts/layout.ts` (new) | `LAYOUT_SCHEMA`, `MAX_LAYOUT_SPOTS`, `MAX_CHIPS_PER_SPOT`, `LayoutSpot`, `ChipLayout`, `LayoutRecord`, `ChipValue`, `StageChips`, `STAGE_CHIPS_KEY`, `LAYOUT_FILE_FORMAT`, `LayoutFileV1` (types and constants only) | new `LAYOUT_SCHEMA = 1`; `CORE_VERSION` unchanged (recommended) | Layouts are game-agnostic and shared by core/store, core/strategy, core/ui and the app. contracts/ imports only `./game` and `./strategy` |
| `src/core/ui/game-ui.ts` | Add `ChipBoardProps`, `ChipsUi`, and optional `GameUi.chips?` | additive optional member, no bump | The game draws the board and knows call-bet steps; the core owns the editor |
| `src/core/index.ts` (barrel, append) | `export * from './contracts/layout'` | – | – |
| `src/core/ui/index.ts` (append, orchestrator-granted) | `export * from './layout'` | – | – |
| `src/core/contracts/strategy.ts` | **none**. `x-chips` uses the documented `x-` extension; `Stage` stays as is and `readStageChips` does the cast | – | Keeps the interpreter and validator untouched |
| `src/core/contracts/{game,experiment,run,protocol}.ts` | **none** | – | – |
| `src/core/store/backend.ts` (not a contract; versioned) | `DB_VERSION = 2`, `STORE_NAMES` + `'layouts'`, `DB_UPGRADES[2]` | DB 2 | New library entity |

`decisions.md` should record D3, D4, D5, D7, D12 and the `CORE_VERSION` call when WP-L0 lands.

---

## 11. Testing strategy

| Piece | Unit (Vitest node/dom) | Golden / integration | e2e (Playwright, four projects) |
|---|---|---|---|
| Contracts (L0) | `contracts.test.ts`: `rouletteUi` (with and without `chips`) assignable to `GameUi`; `StageChips` and `ChipLayout` sample objects type-check; `CORE_VERSION` still `0.1.0` | All existing goldens green | – |
| Chip math (L1) | `chipAmount` table (§3.3); `compileChips` order; `liftRows` accepts and rejects each form; `lift ∘ compile = id` and `compile ∘ lift = rows` (property test, 500 random layouts); `splitStageLayout` stale detection; `adjustSpot` steps, limits and removal; `sameSpots`; `validateChipLayout` every code; `progressionTop` against the validator's top for all kinds | `tests/build/roulette-chips.test.ts`: every chip-shaped preset lifted and compiled gives deep-equal `layout`, then `simulate` gives a byte-equal trace against `src/game/roulette/__fixtures__/golden`; a chips × Martingale stage doubles all spots (the prototype case, pinned); `normalizeStrategy` keeps `x-chips`; the flat-red `definitionId` vector is unchanged | – |
| Store (L2) | Memory and IDB (fake-indexeddb) suites: a v1 DB with records opens as v2 with records intact and `layouts` present; CRUD and `byUpdated` order; `layoutHash` vector (pinned hex for the James Bond layout); `allocLayoutId`; the layout file encode → decode → encode is byte-identical; `decodeLayoutFile` error codes; `db.ts` export/import with and without `layouts`, an old `AllData` fixture, `keyOf('layouts')`, `deleteAll` | – | – |
| Roulette board (L3) | `geometry.test.ts`: for every wheel × orientation, every fixed inside bet is reachable by `betAt` from some point and by `betNearest` in its family; every point of the number block maps to a legal bet on that wheel; zone sizes at 360 px are reported and pinned (straight ≥ 24 px tall); `chip-board.test.tsx`: tap adds with `step`, Remove mode, right-click, the call stepper ×pieces, neighbours add 2k+1, the Enter sheet's steppers, aria names with counts, the lock radiogroup; `ui.test.tsx` unchanged and green; built-in layouts validate | – | – |
| Editor shell (L4) | `history.test.ts` (undo/redo/clear/limit/no-op dedupe); `LayoutEditor.test.tsx` with a fake `ChipBoard` (tool switch, shortcuts, live-region text, 64-spot refusal, unsaved guard); `SpotList` (steppers, reorder, add through a fake picker); `check.test.ts` with the core/testing coin plugin (rejected, adjusted and affordable mapping); `defaultDenom` | Roulette `checkAtTable` cases mirror game.md §8.1 rows 1–10 (in L1's tests/build file, since core cannot import the game) | – |
| Builder (L5) | Model laws with `x-chips` (fresh, stale, extends); `ChipsPanel` (chip rack → literal rows, `units`, a progression creates `base` + `track: 'round'`, the stale banner's Rebuild and Forget, `W_CHIPS_SHADOWED`); "Edit on the table" lift on James Bond leaves `layout` untouched | Define's `builder.test.tsx` cases still green | – |
| Library and Import (L6) | Layouts tab list, built-ins, duplicate, delete confirm, "Used in" scan; editor page save, rename and Back guard; Import routes a layout file (new, exists, renamed, foreign game, newer version) | – | – |
| Define wiring and e2e (L7) | Define integration: build chips, save, run Quick check; the definition holds the compiled rows | `runs.integration.test.tsx` case with chips | `tests/e2e/layouts.spec.ts` at phone-360, phone, phone-landscape and desktop: create a layout by tapping (straight, split via the lock, voisins), undo/redo, Remove, save; use it in a new experiment at $5 with a Martingale; Quick check verdict; reopen the library layout, edit, see the stale banner in Define; keyboard-only path on desktop (Tab, Enter, sheet steppers); axe in every state (§4.6); tap targets ≥ 44 px for buttons; no horizontal overflow; screenshots for `docs/screenshots` |

- **Perf.** No impact is expected: the worker, the interpreter and the compiled rows are the same
  kinds of `LayoutSpec` as today (a 64-spot stage costs like 64 rows).
  - L7 runs `tests/perf/budget.spec.ts` once under the browser baton and records the number.
  - The editor re-renders the SVG per tap, with 64 spots at most and memoized geometry. A dom test
    asserts that 200 taps finish in under 1 s in happy-dom, as a smoke check.

---

## 12. Work packages

Rules: files listed are owned exclusively by that WP; everything else is read-only to it. Batons are
granted by the orchestrator. Each WP ends green on `npm run check`, which covers typecheck, lint,
unit tests and build; for each WP, Vitest runs through `/home/user/bin/res cpu <agent> --`. e2e runs
through `/home/user/bin/res browser <agent> --`.

### DAG and waves

```
Wave 1:  L0 contracts + stubs
            │
Wave 2:  ┌──┴───────┬───────────┬────────────┐
         L1 chips   L2 store    L3 roulette  L4 editor shell
         (core/     (core/store  ChipBoard    (core/ui/layout)
         strategy)   + db.ts)    + built-ins
            │   ╲      │           │   ╱        │
Wave 3:     └────L5 builder ◄──────┼──┴────────┘   (L1, L4; L3 for its dom tests via a fake)
                    │   L6 Library + Import ◄── L1, L2, L3, L4
                    │        │
Wave 4:             └──► L7 Define wiring + e2e ◄── L5, L6 (and L3)
```

### WP-L0 Contracts and frozen stubs (wave 1, one agent, first)

- **Owns:**
  - `src/core/contracts/layout.ts` (new);
  - `src/core/contracts/contracts.test.ts` (append);
  - `src/core/ui/game-ui.ts`;
  - stub files with the frozen signatures of §5–§6, each throwing `not implemented` or rendering
    `null`:
    - `src/core/strategy/chips.ts`;
    - `src/core/store/layouts.ts`;
    - `src/core/ui/layout/index.ts`;
    - `src/core/ui/layout/types.ts`.
- **Batons:**
  - `src/core/contracts/*` and `game-ui.ts` (the contract);
  - `src/core/index.ts` (append the layout contract export);
  - `src/core/ui/index.ts` (append `export * from './layout'`);
  - `src/core/strategy/index.ts` and `src/core/store/index.ts` (append the stub exports);
  - the orchestrator adds the `decisions.md` entry.
- **Acceptance:**
  - Types compile.
  - `rouletteUi` still satisfies `GameUi` with no `chips`.
  - `CORE_VERSION` is unchanged.
  - `npm run check` is green with every golden and definitionId vector untouched.
  - The stubs' signatures match §5.1, §5.2 and §6 exactly. Later WPs may not change them without
    asking the orchestrator.
- **Tests:** the `contracts.test.ts` additions (§11 row 1).

### WP-L1 Chip math (wave 2)

- **Owns:**
  - `src/core/strategy/chips.ts` and `chips.test.ts`;
  - `src/core/strategy/__fixtures__/chips/*`;
  - `tests/build/roulette-chips.test.ts`.
- **Depends on:** L0.
- **Batons:** none. The strategy barrel export was appended in L0. `validate.ts`, `compile.ts` and
  `normalize.ts` are **not** touched.
- **Acceptance:**
  - Every function of §5.1 behaves as specified.
  - All the codes of §5.3 that `chips.ts` owns are implemented.
  - The lift and compile laws hold.
  - The golden-equivalence test passes for every chip-shaped preset (european, plus James Bond on
    american).
  - The chips × Martingale doubling is pinned.
- **Tests:** §11 rows 2 and 5 (the `checkAtTable` roulette cases), in `tests/build`.

### WP-L2 Store, files and app repo (wave 2)

- **Owns:**
  - `src/core/store/backend.ts`, `repo.ts`, `layouts.ts` and `index.ts`, plus their tests;
  - `src/core/store/__fixtures__/layouts/*`;
  - `src/app/services/db.ts` (+ test).
- **Depends on:** L0.
- **Batons:** none. `STORE_NAMES` is core-store's own file.
- **Acceptance:**
  - DB v2 upgrade with no data loss (fake-indexeddb test seeded at v1).
  - Repo CRUD for layouts.
  - The layout file codec is canonical and round-trips.
  - `AllData` carries `layouts` additively, and an old `AllData` fixture still imports.
  - `keyOf('layouts')` is fixed.
  - `deleteAll` clears layouts.
- **Tests:** §11 row 3.

### WP-L3 Roulette ChipBoard and built-in layouts (wave 2)

- **Owns:**
  - `src/game/roulette/ui/chip-board.tsx` (new) and its test;
  - `src/game/roulette/ui/geometry.ts`: additive `betAt`, `betNearest`, `zoneSizes`;
  - `src/game/roulette/ui/board.tsx`: additive `mode: 'place'`, `Chip.count`, `Chip.ghost`, flash
    and ring;
  - `src/game/roulette/ui/chips.ts`: `stepOf`;
  - `src/game/roulette/ui/bet-picker.tsx`: export `CallsPanel` and `BetSheet` with optional
    steppers, keeping the default behaviour;
  - `src/game/roulette/ui/index.ts` (`rouletteUi.chips`);
  - `src/game/roulette/ui/ui.css`;
  - `src/game/roulette/layouts.ts` (built-ins) and its test;
  - `src/game/roulette/index.ts` (append `BUILTIN_LAYOUTS`).
- **Depends on:** L0. It uses L1's `validateChipLayout` only in a test, which may be `it.todo`
  until L1 merges; the orchestrator rebases.
- **Batons:** none.
- **Acceptance:**
  - Every behaviour of §4.3–§4.6 is covered.
  - The `betAt` and `betNearest` coverage properties hold for all wheels and both orientations.
  - The 360 px zone sizes are pinned.
  - `TableView`, `BetPicker` and `ui.test.tsx` are unchanged in behaviour.
  - The built-ins are valid.
- **Tests:** §11 row 4.

### WP-L4 Generic editor shell (wave 2)

- **Owns:** `src/core/ui/layout/*`:
  - `LayoutEditor.tsx`, `history.ts`, `ChipRack.tsx`, `SpotList.tsx`, `LayoutThumb.tsx`;
  - `check.ts`, `denoms.ts`, `layout.css`;
  - `index.ts`, filling L0's stub exports;
  - tests.
- **Depends on:** L0.
- **Batons:** none (the `core/ui` barrel line was added in L0).
- **Acceptance:**
  - §4.1–§4.3 and §4.6 work with any `ChipsUi`, proven with a fake `ChipBoard` and the coin
    plugin.
  - `checkAtTable` maps `Reconciliation` generically.
  - The history limit and shortcuts work.
  - Portrait and landscape shells (the `wide` prop) match the wireframes; this is checked in L7's
    e2e.
- **Tests:** §11 row 5 (dom and node).

### WP-L5 Builder integration (wave 3)

- **Owns:** `src/core/ui/builder/*`:
  - `model.ts`, `Builder.tsx`, `env.ts`, `describe.ts`, `builder.css`;
  - the new `ChipsPanel.tsx` and `LayoutPickSheet.tsx`;
  - `model.test.ts`, plus new dom tests;
  - `index.ts` (its own barrel).
- **Depends on:** L1 and L4. L3 is not needed: the tests use a fake `ChipsUi`.
- **Batons:** none.
- **Acceptance:**
  - §7.1 laws, including stale and `extends` cases.
  - The §4.7 stage panel.
  - The chip rack, unit and progression options write exactly the §3.3 forms.
  - A new progression gets `base = denom` and `track: 'round'`.
  - The stale banner works.
  - "Edit on the table" lifts presets without changing `layout`.
  - `env.chips` absent gives the old builder, byte-for-byte the same output.
  - `src/app/screens/Define/builder.test.tsx` is still green; L5 may not edit it, so it reports a
    break instead.
- **Tests:** §11 row 6.

### WP-L6 Library Layouts tab and Import (wave 3)

- **Owns:**
  - `src/app/screens/Library/*`: `index.tsx`, `library.css`, `library.test.tsx`, and the new
    `Layouts.tsx` and `LayoutPage.tsx`;
  - `src/app/screens/Import/*`: `importFile.ts`, `index.tsx` and their tests;
  - `src/app/services/layouts.ts` (new): list, save, duplicate, delete, export, "used in", built-in
    merge, and `libraryVersion` touches through `Define/data.ts`'s exported store, read-only.
- **Depends on:** L1, L2, L3 and L4.
- **Batons:** none (no route change; §4.7).
- **Acceptance:**
  - §4.7 Library behaviour, the editor page at both orientations, the unsaved guard and Back.
  - Import of layout files with every outcome of §8.
  - The tab keeps its query param and the existing tabs are unchanged.
- **Tests:** §11 row 7.

### WP-L7 Define wiring, end-to-end and perf check (wave 4)

- **Owns:**
  - `src/app/screens/Define/*`:
    - `index.tsx`: `env.chips`, the `?layout=<id>` start, and merging `validateStageChips` and the
      table-check warnings;
    - `doc.ts`, `data.ts`, `define.css`, and the tests there;
  - `tests/e2e/layouts.spec.ts` (new);
  - `tests/e2e/define.spec.ts` (append);
  - `docs/screenshots/layouts-*` (via `SHOTS_DIR`).
- **Depends on:** L5 and L6 (and L3 at runtime).
- **Batons:** none expected. If the e2e needs a new helper in `tests/e2e/helpers.ts`, ask for it.
- **Acceptance:**
  - The full owner flow at four viewports: tap a layout, save it, use it in two definitions at
    different denominations, run, and edit the layout to see the stale banner.
  - Axe is clean in every state, there is no horizontal overflow, and the tap targets pass.
  - The keyboard-only path works.
  - `tests/perf/budget.spec.ts` is unchanged within noise; record the run in the PR.
  - Docs follow-ups are listed for the orchestrator: game.md §12, strategy.md §13, architecture.md
    §6.3 and the chips.md entries.
- **Tests:** §11 row 8.

---

## 13. Chips (deferred, for `docs/chips.md`)

- A tappable racetrack on desktop for call bets and neighbours (game.md §12; it needs the
  racetrack drawing anyway).
- "Shrink evenly" or "skip the spin" funding for a layout (§3.4; Q2 decides whether it is wanted).
- A `{ progMult: p }` expression, if stages sharing one progression need different denominations
  (§3.3).
- Import crappy sandbox `bets=` lists as layouts, when a craps app shares this core (§1).
- Zoom (2×) on the phone board, if the bet-type lock proves insufficient in the owner's phone check.
- Sweeping the chip value (`/strategy/stages/0/x-chips/chip`) needs the compile step in the sweep
  path. Until then, sweep the unit (`chip: { units: 1 }`) or the progression base.

---

## 14. Open questions (genuine product calls; the swarm proceeds on the default)

| # | Question | Default (recommended) | Alternatives | Cost to change later |
|---|---|---|---|---|
| Q1 | Does a layout carry a default denomination? | **No.** The stage picks; it preselects the smallest standard chip that meets the table minimums | Store an optional `preferredDenom` in the layout | Low: one optional field |
| Q2 | When the bankroll can't fund the whole layout (or a progression level), what happens? | **The table's existing rule**: spots are funded in placement order, the last ones are reduced or dropped, and over-max spots are cut (open questions 1 and 4); the editor previews it | Shrink every spot evenly; skip the spin; end the session | Low: generated expression (§3.4), no contract change |
| Q3 | After editing a saved layout, should experiments that used it change? | **No.** Each stage keeps its copy, so runs stay reproducible; Define shows "Layout changed: Update / Keep" | Offer "Update everywhere", which saves new definitions for every user | Medium: a bulk tool in Library |
| Q4 | How do I remove chips? | **An Add / Remove toggle** (plus right-click on desktop); long-press opens the bet list | Long-press removes; tapping a stack removes | Low: one handler |
| Q5 | Should the built-in presets show as chips by default? | **No.** They stay as they are; "Edit on the table" converts a stage on request without changing its bets | Convert every preset stage to chips | Low, but changes preset `definitionId`s |
