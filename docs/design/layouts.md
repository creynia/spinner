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
| D13 | Sweeps | A stage's numeric chip value is sweepable and recompiles the rows (§8.1); every other `x-chips` path and the compiled chip-row amounts are denied. `simKey` ignores `x-chips.from` | Denying all `x-chips` paths (loses "my layout at $5 / $25 / $100") |

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
  - Library → layout → "Used in": the saved definitions **and saved strategies** whose stages have
    `from.id === id`. It is found by scanning the `definitions` and `strategies` stores (cheap; at
    most a few thousand records).
  - The Update / Keep banner lives in the builder's chips panel. It therefore appears wherever a
    stage is edited: a definition opened in Define, and a library strategy loaded through "From
    library".
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
      { "bet": "red", "chips": 5 },
      { "bet": "corner:1-2-4-5", "chips": 1 },
      { "bet": "voisins", "chips": 9 }
    ]
  },
  "layout": [
    { "bet": "red", "amount": 2500 },
    { "bet": "corner:1-2-4-5", "amount": 500 },
    { "bet": "voisins", "amount": 4500 },
    { "bet": "dozen:3", "amount": { "units": 1 }, "when": { "cmp": ["net", "<", 0] } }
  ],
  "rules": []
}
```

This example is legal at the default table: Red $25 meets the $25 outside minimum, and the inside
chips total $50 (corner $5 plus voisins $45) against the $25 inside minimum.

- **Generated prefix.**
  - The first `spots.length` rows of `layout` are generated, in spot order. The remaining rows are
    manual ("Other bets"), such as the `when`-guarded dozen above.
  - No per-row marker is written, which keeps the JSON and hashes tidy.
  - The builder model checks the prefix on load (§7.1). A mismatch, for example after hand-editing
    the JSON, marks the chips **stale**: every row is shown as manual, with the banner "These chips
    no longer match this stage's bets (edited as JSON): Rebuild bets from chips / Forget chips".
  - The interpreter runs `layout` as written, so a stale block can never change a run.
- **First-decided wins** (strategy.md §3.5, item 1): a manual row for a bet that is also a chip spot is
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

- **Single denomination versus mixed limits.** One chip value serves spots with very different
  minimums:
  - an outside spot needs `chips × value ≥ $25`;
  - an inside chip needs only $1, but the inside chips together need $25;
  - a straight's maximum is $500.

  So a layout of "1 chip on Red, 1 chip on 17" has no legal single denomination below $25, and at
  $25 or more the straight is fine but large. The layout itself cannot be "legal"; only a
  (layout, chip value) pair can. The editor therefore shows legality *at the preview value*, and
  the List tab names the fix ("Red needs 5 chips at $5"). The default chip value (below) picks the
  smallest legal one.
- **What the check takes** (S3). `checkAtTable(plugin, rules, rows, bankroll)` takes
  **resolved rows** `readonly { bet: BetId; cents: Cents }[]`, already in cents at one chosen
  level. It never evaluates expressions.
  - The caller resolves the chip value first with L1's pure
    `resolveChipValue(chip, { unit, progressions }) → { base: Cents | null; top: Cents | null }`:

    | Chip value | `base` | `top` |
    |---|---|---|
    | a literal `d` | `d` | `d` |
    | `{ units: 1 }` | `unit` | `unit` |
    | `{ prog: p }` | `p`'s base when it is a constant (a literal or `{ units: n }`) | `progressionTop(p, unit)` |

    Both are `null` when the base is a formula. The panel then says "can't preview: the base is a
    formula".
  - It then builds rows as `cents = chips × value` per spot. A call bet's chips × value is its
    total.
  - The callers are L4's editor (one level, the preview value) and L5's chips panel (two levels).
- **How the check runs.** It applies the real `plugin.reconcile` to a fresh
  `createState({ rules, rng, bankroll })` and reads `rejected` and `adjusted`. It is generic,
  needs no game code, and is exactly what the run will do.
- **Which levels are checked** (S2). The stage panel checks **both the base level and the top
  level**: once for a literal or unit chip value (they coincide), twice for a progression.
  - At the **base** level, any spot that is rejected `below-min` (or by `inside-min-total`) is a
    warning, `W_CHIPS_TABLE`: "At the starting $5 chip, Red ($5) is below the $25 minimum and is
    dropped every spin until the progression rises." A below-minimum spot is otherwise silently
    dropped by `reconcile`, so this warning is the only signal.
  - At the **top** level, `clamped` spots are reported as in the table above.
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
│ [+][−]  [↶][↷][⌫][⋯]                │ 48  tool row (sticky, icon-only, §4.1.1)
│ Bet [Auto][1][2][3][4][6]           │ 44  bet-type lock (radiogroup "Bet type")
│ ┌────┬────┬────────────────────────┐ │
│ │    │    │           0            │ │
│ │1–18│    ├───────┬───────┬────────┤ │
│ │    │1st │   1   │   2 ④ │   3    │ │ board: Board geometry, scaled to
│ ├────┤ 12 ├──●────┼───────┼────────┤ │ 328 px (cell ≈ 74 × 42 px)
│ │EVEN│    │   4   │   5   │   6    │ │ ④ = chip with a count badge
│ ├────┤    │  ...  │       │        │ │ ● = chip on a line (split 1|4)
│ │RED⑤│    │       │       │        │ │
│ │ ...│ ...│  34   │  35   │  36    │ │
│ ├────┴────┼───────┼───────┼────────┤ │
│ │         │  2:1  │  2:1  │  2:1   │ │
│ └─────────┴───────┴───────┴────────┘ │
│ 10 chips · 3 spots · at $5: $50 ✓    │ 40  status (sticky bottom, aria-live)
└──────────────────────────────────────┘
```

The example is legal at $5 chips: Red has 5 chips ($25), and the inside chips are straight 2 ×4
plus split 1|4 ×1, a $25 inside total.

#### 4.1.1 Fit at 328 px (360 px minus two 16 px gutters)

- **Vertical fit:**
  - The header, tabs, tool row, lock and status take 48 + 44 + 48 + 44 + 40 = 224 px.
  - The board is 328 / 374 × 684 ≈ 600 px tall.
  - So at 360 × 780 the page scrolls vertically by about 45 px, with the tool row and status
    sticky.
  - There is no horizontal page scroll (e2e asserts it).
- **Tool row,** icon-only: each control is a 44 × 44 px button.
  - Its accessible name and `title` are "Add chips", "Remove chips", "Undo", "Redo", "Clear" and
    "More".
  - Add and Remove are a two-button radiogroup.
  - Width: 6 × 44 + 5 × 8 gaps = **304 px ≤ 328**.
- **Lock row:**
  - A visible label "Bet" (≈ 36 px) names the radiogroup through `aria-labelledby`; its
    accessible name is "Bet type".
  - Six 44 px options show the number of pockets covered: "Auto", "1", "2", "3", "4", "6". Their
    accessible names are "Auto", "Straight", "Split", "Street", "Corner, trio or basket" and
    "Six line".
  - Width: 36 + 6 × 44 + 6 × 4 gaps = **324 px ≤ 328**.

### 4.2 Landscape (844 × 390 and wider; `useOrientation` → `landscape` above 600 px)

```
┌──────────────────────────────────────────────────────────┬──────────────┐
│ ← Corners and red                                         │ [Save]       │
├──────────────────────────────────────────────────────────┤ (●Add)       │
│ ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬───┐              │ (○Remove)    │
│ │  │ 3│ 6│ 9│12│15│18│21│24│27│30│33│36│2:1│              │ ↶   ↷  Clear │
│ │0 │ 2│ 5│ 8│11│14│17│20│23│26│29│32│35│2:1│              │ Bet: Auto ▾  │
│ │  │ 1│ 4│ 7│10│13│16│19│22│25│28│31│34│2:1│              │ Call bets ▸  │
│ │  ├──┴──┴──┴──┼──┴──┴──┴──┼──┴──┴──┴──┤   │              │ 10 chips     │
│ │  │  1st 12   │  2nd 12   │  3rd 12   │   │              │ 3 spots      │
│ │  │1–18│EVEN│ RED │BLACK│ODD │19–36  │   │              │ $5: $50 ✓    │
│ └──┴────┴────┴─────┴─────┴────┴───────┴───┘              │ List ▸       │
└──────────────────────────────────────────────────────────┴──────────────┘
                     board ≈ 632 px wide (cell ≈ 44 × 50 px)              rail 180 px
```

The rail holds the tool, history, lock and totals. "Call bets" and "List" open as side sheets.
On a desktop at 1024 px or wider, the list sits permanently under the rail.

**Fit at 844 × 390.**

- The header is 44 px. The board gets 346 px of height; at 632 px wide it is
  632 / 712 × 280 ≈ 249 px tall, so it fits.
- The rail is 180 px wide and **compact**. These rows are 44 px each:
  - Save;
  - Add and Remove, as two icon buttons;
  - Undo, Redo and Clear, as three icon buttons;
  - "Bet type", a `Select` instead of the six-option row;
  - Call bets;
  - List.

  The status takes 40 px. With 8 px gaps that is 6 × 44 + 40 + 6 × 8 = **352 px ≤ 346 + 44**.
- The rail also gets `overflow-y: auto` as a fallback for larger text settings. The page never
  scrolls horizontally.

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
  - **Taps act on `click`, never on `pointerdown`,** so a scroll or pan never places a chip.
  - The long-press timer starts on `pointerdown` and is cancelled by moving more than 8 px or by
    `pointerup`. When it fires, it opens the sheet and swallows the following `click`.
  - The board sets:
    - `touch-action: manipulation` (pan and pinch stay, double-tap zoom goes);
    - `user-select: none` and `-webkit-touch-callout: none`;
    - `contextmenu` → `preventDefault()` in place mode only. Android Chrome fires `contextmenu`
      on a long-press, and a mouse right-click is "remove one step".
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

- **Basket and split 0-1 (explicit special case).**
  - In Auto mode, a tap within 10 units of the `basket` anchor (the corner where the zero row
    meets number 1 on its dozen side) is the **basket** (first four on European, top line on
    American and triple-zero).
  - A tap in the band along number 1's zero-side edge but away from that corner is
    **`split:0-1`**.
  - Edges of the number block with no pocket across them (the dozen side), other than that corner,
    add nothing: the tap stays a straight.
  - In lock mode, Corner picks the basket from number 1's zero-side, dozen-side quadrant (its
    nearest anchor), and Split picks `split:0-1` from number 1's zero-side triangle.
  - Unit tests pin both, for every wheel and orientation.
- **Target sizes in lock mode.** Split triangles (≈ 74 × 21 px at 360) and corner quadrants
  (≈ 37 × 21 px) still fall **under 24 px** on their short side, as do the Auto-mode line bands.
  The List tab and the long-press or Enter bet sheet (≥ 48 px rows) are the **equivalent
  controls** under WCAG 2.5.8, the same argument the existing `BetPicker` uses for its hot zones.
  Straights (≈ 56 × 25 px in Auto, the whole cell in lock mode) and outside boxes meet 24 px.
- **Hit testing in place mode:**
  - Chips get `pointer-events: none`, so a tap on a chip goes to the board underneath and the
    point decides.
  - The tap point maps to board units with the pure
    `toBoard(rect, view, clientX, clientY) = { x: view.x + (clientX − rect.left) × view.w / rect.width, y: view.y + (clientY − rect.top) × view.h / rect.height }`.
    It **includes `view.x` and `view.y`**: the viewBox is offset by `ZERO_PAD`.
  - The SVG's CSS box keeps the viewBox aspect (`aspect-ratio` set from `view`, no letterboxing),
    so the formula is exact. A unit test checks it against `getScreenCTM` in the browser e2e.

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
│ ┌──────────────┐  Corners and red · 3 spots · 15 chips       │
│ │ (thumbnail)  │  Chip value  ($1)(●$5)($25)($100)($500) ⋯  │
│ │              │              ( ) follows progression [m ▾] │
│ └──────────────┘  $75 a spin · ✓ fits this table             │
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
- **`emptyStrategy` output is unchanged** (orchestrator decision), so its tests and ids stay
  stable: a new strategy still has its single `red` `{ units: 1 }` row.
  - For a new strategy, Define's stage panel offers **"Tap chips"** as the first, primary action.
    It lifts the red row to chips (`chip: { units: 1 }`) and opens the editor; the rows are
    unchanged until the user taps.
- **Who fixes tests broken by the heading and panel change:**
  - unit tests (`src/core/ui/builder/*.test.*`, plus `src/app/screens/Define/builder.test.tsx` and
    `define.test.tsx`, for heading and panel text only): L5;
  - e2e (`tests/e2e/define.spec.ts`, `flow.spec.ts`, `shots.spec.ts`): L7.

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
export function progressionBase(spec: ProgressionSpec, unit: Cents): Cents | null; // level-0 amount, constant bases
export function resolveChipValue(
  chip: ChipValue, ctx: { unit: Cents; progressions?: Record<Slug, ProgressionSpec> },
): { base: Cents | null; top: Cents | null };                                 // §3.4 (S3)
export function isChipPath(path: string): { stage: number } | null;          // '/strategy/stages/<s>/x-chips/chip'
export function recompileStageChips(def: StrategyDefinition, stage: number): StrategyDefinition; // §8.1 sweep
```

- **`progressionTop`** (S4, decided): a **baton-free core-strategy export** from `chips.ts`, the
  file L1 owns. It is implemented from strategy.md §7.4's table, and `validate.ts` is not touched.
  - It covers the kinds with a constant base: `flat`, martingale (with `multiplier`),
    grand-martingale, fibonacci, dalembert (constant `step`), paroli, `1-3-2-6`, oscars-grind
    (`maxSteps` units), and `sequence` (the max of the constant amounts).
  - It returns `null` for labouchere and for formula bases. The cap at the latched `maxAmount`
    applies when that is constant.
  - Tests:
    - pinned against the §7.7 reference sequences;
    - cross-checked against the validator: for a red-only one-stage strategy at `limits(red).max`
      ± 1 cent, `W_PROG_ABOVE_TABLE_MAX` fires exactly when `progressionTop > max`.

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
- `checkAtTable(plugin, rules, rows: readonly { bet: BetId; cents: Cents }[], bankroll): TableCheck`
  (§3.4). The rows are already resolved to cents at one level; the caller resolves them with L1's
  `resolveChipValue`.

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

- **IndexedDB `DB_VERSION` 1 → 2** (B1: a fresh install must not break):
  - **The trap.** Today `DB_UPGRADES[1]` iterates `STORE_NAMES`. Appending `'layouts'` to
    `STORE_NAMES` *and* creating it in upgrade 2 would make a fresh install (`oldVersion` 0, which
    runs 1 then 2) create `layouts` twice. That throws `ConstraintError`, and `openStore` falls back
    to memory. The reviewer reproduced this with fake-indexeddb.
  - **The fix:**
    - add `const V1_STORE_NAMES = [ …the ten v1 names… ] as const`, frozen forever;
    - `DB_UPGRADES[1]` iterates `V1_STORE_NAMES` (using `STORE_DEFS` for keyPaths and indexes);
    - `DB_UPGRADES[2] = (db) => { if (!db.objectStoreNames.contains('layouts')) create('layouts') }`;
    - `STORE_NAMES = [...V1_STORE_NAMES, 'layouts']`, so the memory backend and `deleteAll` pick
      it up.

    Every later version follows the same rule: an upgrade creates only its own stores, each guarded
    by `contains`.
  - `STORE_DEFS.layouts = { keyPath: 'id', indexes: { byUpdated: 'updatedAt' } }`.
  - The upgrade is structural only. Every v1 store and record is untouched, and records still
    migrate lazily via `v`. The existing open path already loops `DB_UPGRADES[old+1 … new]`.
  - **Acceptance tests** (fake-indexeddb, L2):
    - a **fresh** database opened at v2 has exactly the 11 stores, each with its keyPath and
      indexes from `STORE_DEFS`, and `openStore` reports `kind: 'idb'`, not the fallback;
    - a database created at v1 and seeded with a definition, a strategy, a run with parts and a
      setting, then reopened at v2, keeps every record and gains `layouts`;
    - the memory backend has the same 11 stores;
    - the existing `expect(STORE_NAMES).toHaveLength(10)` in `backend.test.ts` becomes 11, plus
      `V1_STORE_NAMES` length 10.
  - Edge cases:
    - Another tab still on v1: `onblocked`, then the existing "close other spinner tabs" message.
    - An older build meeting a v2 database (rollback): `VersionError`, then the memory fallback
      with "data from a newer version" (§9.3). Nothing is deleted.
- **App repo (`src/app/services/db.ts`):**
  - **`keyOf` is derived from `STORE_DEFS`** instead of a hand-written switch:
    `const kp = STORE_DEFS[store].keyPath; return Array.isArray(kp) ? kp.map((k) => rec[k]) : rec[kp]`.
    Today's `default` branch returns `runId`, so a new store would silently get the wrong key.
    `tests/app/shell.test.tsx`, which imports `keyOf`, is L2-touchable for this.
  - `deleteAll` covers the new store automatically, through `STORE_NAMES`.
  - **Both repos change the same way:** `createBackendRepo`, and **`createMemoryRepo`** (the
    fallback and test fake, which duplicates export, import and deleteAll).
    - `exportDefinitions` adds `layouts: LayoutRecord[]`.
    - `deleteAll` clears layouts.
    - `importDefinitions` merges layouts by id, keeping existing ones, and returns
      `{ definitions: number; layouts: number }`.
  - **`parseAllData` carries `layouts`.** A missing field gives `[]`; a non-array is ignored.
  - The Settings import toast reads "Imported 3 definitions and 2 layouts." This one line of
    `src/app/screens/Settings/index.tsx` is L2-touchable.
  - `AllData` stays `v: 1`, because the field is optional and additive: old files import with no
    layouts, and an older build ignores the field.
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

### 8.1 Sweeps (B3, orchestrator decision)

`leafPaths` and `sweepPathAllowed` would expose `x-chips` leaves. Sweeping one would change the
`definitionId` but not the compiled rows: every variant would play the same bets. The rules
(owned by WP-L8):

- **Allowed: the chip value of a chip stage**, `/strategy/stages/<s>/x-chips/chip`, when it is a
  numeric denomination. This is the "run my layout at $5 / $25 / $100" case.
  - `applySweepValue(d, path, value)` (new, `core/experiment/pointer.ts`) is `setPointer` followed,
    when `isChipPath(path)`, by `recompileStageChips(strategy, s)`. That regenerates that stage's
    prefix rows with `compileChips` before `normalizeDefinition`.
  - `buildVariants` (`Sweep/sweep.ts`) calls it instead of `setPointer`.
  - Values must be positive integer cents. A non-integer or `≤ 0` value is a variant error ("chip
    value must be whole cents"). Values are increasing, as `parseValues` already requires.
  - `leafPaths` lists it with the label "Stage *play*: chip value".
  - A chip value of `{ units: 1 }` or `{ prog }` is not a numeric leaf there. Sweep the strategy
    unit or the progression base instead, as today.
- **Denied:**
  - every other `x-` path (`/x-chips/spots/…`, `/x-chips/from/…`, `/x-chips/v`, and any other
    `x-` key);
  - the compiled `layout/<i>/amount…` paths of a chip stage, for `i < spots.length`. Sweeping
    them would make the chips stale.
- **Signature.** `sweepPathAllowed(path, def?)` gains an optional definition. Without it, only the
  path rules apply (every `x-` path except the chip path is denied). With it, the chip-stage rows
  and the "chip must be numeric" rules apply too. Existing callers stay valid, and
  `contracts/experiment.ts`'s signature comment is updated in L0.
- **Tests:**
  - `pointer.test.ts`: allow and deny tables;
  - `sweep.test.ts`: a $5 / $25 / $100 sweep of a chip stage yields three variants whose compiled
    rows are `chips × value`, three distinct ids, and validation that runs; `leafPaths` hides the
    denied paths.

### 8.2 `simKey` ignores layout provenance

`simKey` already ignores names. It now also drops every stage's `x-chips.from`, so two definitions
that differ only by where their chips came from (or a renamed layout) still match "you already ran
this".

- **Scope.** The change is in `core/experiment/ids.ts` (WP-L8). For definitions without `x-chips`
  the input is unchanged, so every existing `simKey` is unchanged.
- **Not affected.** `definitionId` still hashes `from` (provenance is part of the saved
  experiment), and `runKey`, which builds on `definitionId`, is unchanged.

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
| `src/core/ui/index.ts` (orchestrator-granted) | Append `export * from './layout'`, and **edit** the existing `export type { BetPickerProps, GameUi, … } from './game-ui'` line to add `ChipBoardProps` and `ChipsUi` | – | – |
| `src/core/contracts/experiment.ts` (signature comment only) | `sweepPathAllowed(path, def?)`; add `applySweepValue(d, path, value)` | – | §8.1 |
| `src/core/contracts/version.ts` (comment only) | Reword "bump whenever a contract … changes" to "bump whenever anything that feeds run ids or simulation results changes" (the orchestrator's decision) | `CORE_VERSION` stays `0.1.0` | D12 |
| `src/core/contracts/strategy.ts` | **none**. `x-chips` uses the documented `x-` extension; `Stage` stays as is and `readStageChips` does the cast | – | Keeps the interpreter and validator untouched |
| `src/core/contracts/{game,run,protocol}.ts` | **none** | – | – |
| `src/core/store/backend.ts` (not a contract; versioned) | `DB_VERSION = 2`, frozen `V1_STORE_NAMES` for upgrade 1, `STORE_NAMES = [...V1, 'layouts']`, guarded `DB_UPGRADES[2]` (§8) | DB 2 | New library entity |

`decisions.md` records D1–D7, D11, D12 and the `CORE_VERSION` call (done in 2538c0f).

---

## 11. Testing strategy

| Piece | Unit (Vitest node/dom) | Golden / integration | e2e (Playwright, four projects) |
|---|---|---|---|
| Contracts (L0) | `contracts.test.ts`: `rouletteUi` (with and without `chips`) assignable to `GameUi`; `StageChips` and `ChipLayout` sample objects type-check; `CORE_VERSION` still `0.1.0` | All existing goldens green | – |
| Chip math (L1) | `chipAmount` table (§3.3); `compileChips` order; `liftRows` accepts and rejects each form; `lift ∘ compile = id` and `compile ∘ lift = rows` (property test, 500 random layouts); `splitStageLayout` stale detection; `adjustSpot` steps, limits and removal; `sameSpots`; `validateChipLayout` every code; `progressionTop`/`progressionBase` against the §7.7 reference sequences and the `W_PROG_ABOVE_TABLE_MAX` threshold (S4); `resolveChipValue` for each chip-value form; `isChipPath`; `recompileStageChips` | `tests/build/roulette-chips.test.ts`: every chip-shaped preset lifted and compiled gives deep-equal `layout`, then `simulate` gives a byte-equal trace against `src/game/roulette/__fixtures__/golden`; a chips × Martingale stage doubles all spots (the prototype case, pinned); `normalizeStrategy` keeps `x-chips`; the flat-red `definitionId` vector is unchanged | – |
| Store (L2) | Memory and IDB (fake-indexeddb) suites: a **fresh** DB opens at v2 with all 11 stores and indexes, as `idb`; a v1 DB with records opens as v2 with records intact and `layouts` present; `STORE_NAMES` length 11, `V1_STORE_NAMES` length 10; CRUD and `byUpdated` order; `layoutHash` vector (pinned hex for the James Bond layout); `allocLayoutId`; the layout file encode → decode → encode is byte-identical; `decodeLayoutFile` error codes; `db.ts` export/import with and without `layouts` on **both** `createBackendRepo` and `createMemoryRepo` (counts returned), `parseAllData` with and without `layouts`, an old `AllData` fixture, `keyOf` derived from `STORE_DEFS` for every store (`tests/app/shell.test.tsx`), `deleteAll` | – | – |
| Roulette geometry (L3a) | `geometry.test.ts`: for every wheel × orientation, every fixed inside bet is reachable by `betAt` from some point and by `betNearest` in its family; every point of the number block maps to a legal bet on that wheel; the basket versus `split:0-1` special case (§4.4) at its corner, along the edge and in lock mode; `toBoard` with a non-zero `view.x/y`; zone sizes at 360 px are reported and pinned (straight ≥ 24 px tall) | – | – |
| Roulette board (L3b) | `chip-board.test.tsx`: tap acts on `click` (not `pointerdown`), long-press opens the sheet and swallows the click, `contextmenu` suppressed, chips `pointer-events: none`, the lock radiogroup's name "Bet type", tap adds with `step`, Remove mode, right-click, the call stepper ×pieces, neighbours add 2k+1, the Enter sheet's steppers, aria names with counts, the lock radiogroup; `ui.test.tsx` unchanged and green; built-in layouts validate | – | – |
| Editor shell (L4) | `history.test.ts` (undo/redo/clear/limit/no-op dedupe); `LayoutEditor.test.tsx` with a fake `ChipBoard` (tool switch, shortcuts, live-region text, 64-spot refusal, unsaved guard); `SpotList` (steppers, reorder, add through a fake picker); `check.test.ts` with the core/testing coin plugin (rejected, adjusted and affordable mapping; rows given as resolved `{ bet, cents }`); `defaultDenom` | **`tests/build/roulette-check.test.ts` (L4-owned):** roulette `checkAtTable` cases mirror game.md §8.1 rows 1–10, plus the base-level below-minimum warning (S2) | – |
| Builder (L5) | Model laws with `x-chips` (fresh, stale, extends); base and top level table checks, with the base below-minimum `W_CHIPS_TABLE`; "Tap chips" on a new strategy leaves `emptyStrategy` output unchanged; `ChipsPanel` (chip rack → literal rows, `units`, a progression creates `base` + `track: 'round'`, the stale banner's Rebuild and Forget, `W_CHIPS_SHADOWED`); "Edit on the table" lift on James Bond leaves `layout` untouched | Define's `builder.test.tsx` cases still green | – |
| Sweep and simKey (L8) | `pointer.test.ts` allow and deny tables (§8.1); `applySweepValue` recompiles; `ids.test.ts`: `simKey` ignores `x-chips.from`, and every existing `simKey` vector is unchanged | `sweep.test.ts`: a $5 / $25 / $100 chip-value sweep gives three variants with `chips × value` rows; `leafPaths` hides the denied paths | – |
| Library and Import (L6) | Layouts tab list, built-ins, duplicate, delete confirm, "Used in" scan over definitions and strategies; editor page save, rename and Back guard; Import routes a layout file (new, exists, renamed, foreign game, newer version) | – | – |
| Define wiring and e2e (L7) | Define integration: build chips, save, run Quick check; the definition holds the compiled rows | `runs.integration.test.tsx` case with chips | `tests/e2e/layouts.spec.ts` at phone-360, phone, phone-landscape and desktop: create a layout by tapping (straight, split via the lock, voisins), undo/redo, Remove, save; use it in a new experiment at $5 with a Martingale; Quick check verdict; reopen the library layout, edit, see the stale banner in Define; keyboard-only path on desktop (Tab, Enter, sheet steppers); axe in every state (§4.6); tap targets ≥ 44 px for buttons; no horizontal overflow; screenshots for `docs/screenshots` |

- **Perf.** No impact is expected: the worker, the interpreter and the compiled rows are the same
  kinds of `LayoutSpec` as today (a 64-spot stage costs like 64 rows).
  - L7 runs `tests/perf/budget.spec.ts` once under the browser baton and records the number.
  - The editor re-renders the SVG per tap, with 64 spots at most and memoized geometry. A dom test
    asserts that 200 taps finish in under 1 s in happy-dom, as a smoke check.

---

## 12. Work packages

These rules apply to every WP:

- **Ownership.** Each WP owns its listed files exclusively; every other file is read-only to it.
  The orchestrator grants batons.
- **Done means green:** each WP ends green on `npm run check` (typecheck, lint, unit tests and
  build).
- **Resource baton:**
  - Vitest runs through `/home/user/bin/res cpu <agent> --`.
  - e2e runs through `/home/user/bin/res browser <agent> --`.

### DAG and waves

```
Wave 1:  L0 contracts + stubs
            │
Wave 2:  ┌──┴────────┬─────────────┬──────────────┬──────────────┐
         L1 chips    L2 store      L3a geometry   L4 editor shell
         (core/      (core/store   (pure)         (core/ui/layout,
         strategy)    + db.ts)        │             tests/build/roulette-check)
            │            │            ▼
Wave 2b:    │            │          L3b ChipBoard UI + built-ins ◄── L3a
            │            │            │
Wave 3:     ├──► L5 builder ◄─────────┼──── L4          (fake ChipsUi; no L3b needed)
            ├──► L8 sweep + simKey    │                  (L1 only)
            └──► L6 Library + Import ◄┴── L2, L4         (L1, L2, L3b, L4)
                    │
Wave 4:      L7 Define wiring + e2e ◄── L5, L6, L8 (and L3b)
```

Nine WPs: L3a is small, and L3b starts the moment L3a merges. At most five run at once, within the
pool of 10.

### WP-L0 Contracts and frozen stubs (wave 1, one agent, first)

- **Owns:**
  - `src/core/contracts/layout.ts` (new);
  - `src/core/contracts/contracts.test.ts` (append);
  - `src/core/contracts/version.ts` (comment reword only, D12);
  - `src/core/contracts/experiment.ts` (the signature comment for `sweepPathAllowed(path, def?)` and
    `applySweepValue`, §8.1);
  - `src/core/ui/game-ui.ts`;
  - stub files with the frozen signatures of §5, §6 and §8.1, each throwing `not implemented` or
    rendering `null`:
    - `src/core/strategy/chips.ts`;
    - `src/core/store/layouts.ts`;
    - `src/core/ui/layout/index.ts` and `types.ts`.
- **Batons:**
  - `src/core/contracts/*` and `game-ui.ts` (the contract);
  - `src/core/index.ts` (append the layout contract export);
  - `src/core/ui/index.ts`: append `export * from './layout'` **and edit** the existing
    `export type {…} from './game-ui'` line to add `ChipBoardProps` and `ChipsUi`;
  - `src/core/strategy/index.ts` and `src/core/store/index.ts` (append the stub exports).
- **Acceptance:**
  - Types compile.
  - `rouletteUi` still satisfies `GameUi` with no `chips`.
  - `CORE_VERSION` is unchanged.
  - Every golden and definitionId vector is untouched, and `npm run check` is green.
  - The stubs' signatures match §5.1, §5.2, §6 and §8.1 exactly. Later WPs may not change them
    without asking the orchestrator.
- **Tests:** the `contracts.test.ts` additions (§11 row 1).

### WP-L1 Chip math (wave 2)

- **Owns:**
  - `src/core/strategy/chips.ts` and `chips.test.ts`;
  - `src/core/strategy/__fixtures__/chips/*`;
  - `tests/build/roulette-chips.test.ts`.
- **Depends on:** L0.
- **Batons:** none. The strategy barrel export was appended in L0. `validate.ts`, `compile.ts` and
  `normalize.ts` are **not** touched; `progressionTop` lives in `chips.ts` (S4).
- **Acceptance:**
  - Every function of §5.1 behaves as specified, including `resolveChipValue`, `progressionBase`,
    `progressionTop`, `isChipPath` and `recompileStageChips`.
  - The §5.3 codes that `chips.ts` owns are implemented.
  - The lift and compile laws hold.
  - The golden-equivalence test passes for all 12 presets (european, plus James Bond on american).
  - The chips × Martingale doubling is pinned.
- **Tests:** §11 row 2. The `checkAtTable` cases are **not** here; they belong to L4 (B2).

### WP-L2 Store, files and app repo (wave 2)

- **Owns:**
  - `src/core/store/backend.ts`, `repo.ts`, `layouts.ts` and `index.ts`, plus their tests (including
    `backend.test.ts`'s store-count assertion);
  - `src/core/store/__fixtures__/layouts/*`;
  - `src/app/services/db.ts`, covering both `createBackendRepo` and `createMemoryRepo`, plus its
    tests;
  - `tests/app/shell.test.tsx`, for `keyOf` and the import counts only;
  - the import-toast line of `src/app/screens/Settings/index.tsx`.
- **Depends on:** L0.
- **Batons:** none.
- **Acceptance:**
  - B1 is fixed as §8 specifies: a frozen `V1_STORE_NAMES`, a guarded upgrade 2, and a **fresh DB
    at v2 that opens as `idb` with all 11 stores and indexes**.
  - The v1 → v2 upgrade loses no data.
  - Repo CRUD for layouts.
  - The layout file codec is canonical and round-trips.
  - `AllData` carries `layouts` additively in both repos, and `parseAllData` and
    `importDefinitions` count them.
  - An old `AllData` fixture still imports.
  - `keyOf` is derived from `STORE_DEFS`.
  - `deleteAll` clears layouts.
- **Tests:** §11 row 3.

### WP-L3a Roulette geometry (wave 2)

- **Owns:** `src/game/roulette/ui/geometry.ts`, additive only, and `geometry.test.ts` (new):
  - `betAt(board, point)` (Auto mode, §4.4);
  - `betNearest(board, point, family)` (lock mode);
  - the basket versus `split:0-1` special case;
  - `toBoard(rect, view, clientX, clientY)`;
  - `zoneSizes(board, cssWidth)`.
- **Depends on:** L0 (types only).
- **Batons:** none.
- **Acceptance:**
  - The coverage properties hold for all 3 wheels × 2 orientations.
  - The special case is pinned.
  - `toBoard` honours `view.x/y`.
  - The 360 px zone sizes are pinned.
  - The existing `anchorOf`, `hotZone` and `chipAt` behaviour is unchanged (`ui.test.tsx` is green).
  - It is pure: no DOM and no Preact.
- **Tests:** §11 row "Roulette geometry (L3a)".

### WP-L3b Roulette ChipBoard UI and built-in layouts (wave 2b, after L3a)

- **Owns:**
  - `src/game/roulette/ui/chip-board.tsx` (new) and its test;
  - `src/game/roulette/ui/board.tsx`: additive `mode: 'place'`, `Chip.count`, `Chip.ghost`, flash,
    ring, chip `pointer-events: none`, and the `click`, long-press and `contextmenu` handling of
    §4.3;
  - `src/game/roulette/ui/chips.ts` (`stepOf`);
  - `src/game/roulette/ui/bet-picker.tsx`: refactor to export `CallsPanel` and `BetSheet` with
    optional steppers, keeping the default behaviour;
  - `src/game/roulette/ui/index.ts` (`rouletteUi.chips`);
  - `src/game/roulette/ui/ui.css`;
  - `src/game/roulette/layouts.ts` (built-ins) and its test;
  - `src/game/roulette/index.ts` (append `BUILTIN_LAYOUTS`).
- **Depends on:** L0 and L3a. It uses L1's `validateChipLayout` in one test, which may be
  `it.todo` until L1 merges.
- **Batons:** none.
- **Acceptance:**
  - Every behaviour of §4.3–§4.6, including the lock radiogroup "Bet type", the icon-tool names and
    the call steppers × pieces.
  - `TableView`, `BetPicker` and `ui.test.tsx` are unchanged in behaviour.
  - The built-ins are valid.
- **Tests:** §11 row "Roulette board (L3b)".

### WP-L4 Generic editor shell and table check (wave 2)

- **Owns:**
  - `src/core/ui/layout/*`:
    - `LayoutEditor.tsx`, `history.ts`, `ChipRack.tsx`, `SpotList.tsx`, `LayoutThumb.tsx`;
    - `check.ts` (`checkAtTable` over resolved `{ bet, cents }` rows, §3.4), `denoms.ts`,
      `layout.css`;
    - `index.ts`, filling L0's stub exports;
    - tests;
  - **`tests/build/roulette-check.test.ts`** (new; B2).
- **Depends on:** L0. `resolveChipValue` comes from L1, but L4 tests pass resolved cents directly,
  so they do not wait on it.
- **Batons:** none.
- **Acceptance:**
  - §4.1–§4.3 and §4.6, with the §4.1.1 fit at 328 px and the landscape rail fit, work with any
    `ChipsUi`. This is proven with a fake `ChipBoard` and the coin plugin.
  - `checkAtTable` maps `Reconciliation` generically, and the roulette cases mirror game.md §8.1.
  - The history limit and shortcuts work.
- **Tests:** §11 row 5.

### WP-L5 Builder integration (wave 3)

- **Owns:**
  - `src/core/ui/builder/*`:
    - `model.ts`, `Builder.tsx`, `env.ts`, `describe.ts`, `builder.css`;
    - the new `ChipsPanel.tsx` and `LayoutPickSheet.tsx`;
    - `model.test.ts`, plus new dom tests;
    - `index.ts`, including `pathToElementId`'s `b-chips-<s>`;
  - `src/app/screens/Define/builder.test.tsx`, `builder-model.test.ts` and `define.test.tsx`,
    for heading and panel text fixes only (S7).
- **Depends on:** L1 and L4. L3b is not needed: the tests use a fake `ChipsUi`.
- **Batons:** none.
- **Acceptance:**
  - §7.1 laws, including stale and `extends` cases.
  - The §4.7 stage panel.
  - The chip value options write exactly the §3.3 forms.
  - A new progression gets `base = denom` and `track: 'round'`.
  - The table check runs at the base and top levels (S2).
  - The stale banner works, and "Update / Keep" appears for library strategies too.
  - "Edit on the table" and "Tap chips" lift without changing `layout`.
  - `emptyStrategy` output is unchanged.
  - With `env.chips` absent, the builder is the old builder, with the same output byte for byte.
- **Tests:** §11 row 6.

### WP-L8 Sweep chip value and simKey (wave 3, small)

- **Owns:**
  - `src/core/experiment/pointer.ts`, `ids.ts` and `index.ts` (append `applySweepValue`), plus
    their tests;
  - `src/app/screens/Sweep/sweep.ts`, `index.tsx` (the leaf label only) and their tests.
- **Depends on:** L1 (`isChipPath`, `recompileStageChips`).
- **Batons:** none. The contract comment was updated in L0.
- **Acceptance:**
  - All of §8.1: the chip-value sweep recompiles rows, and the other `x-` paths and the compiled
    chip-row amounts are denied.
  - §8.2: `simKey` ignores `x-chips.from`, and every existing `simKey` and `definitionId` vector is
    unchanged.
- **Tests:** §11 row "Sweep and simKey (L8)".

### WP-L6 Library Layouts tab and Import (wave 3)

- **Owns:**
  - `src/app/screens/Library/*`: `index.tsx`, `library.css`, `library.test.tsx`, and the new
    `Layouts.tsx` and `LayoutPage.tsx`;
  - `src/app/screens/Import/*`: `importFile.ts`, `index.tsx`, `repo.ts`, `import.css` (if needed)
    and their tests;
  - `src/app/services/layouts.ts` (new):
    - list, save, duplicate, delete and export;
    - "used in", scanning both definitions and strategies;
    - merging the built-ins;
    - `libraryVersion` touches through `Define/data.ts`'s exported store, read-only.
- **Depends on:** L1, L2, L3b and L4.
- **Batons:** none (no route change; §4.7).
- **Acceptance:**
  - §4.7 Library behaviour, the editor page at both orientations, the unsaved guard and Back.
  - Import of layout files with every outcome of §8.
  - The existing tabs are unchanged.
- **Tests:** §11 row "Library and Import (L6)".

### WP-L7 Define wiring, end-to-end and perf check (wave 4)

- **Owns:**
  - `src/app/screens/Define/*`, except the test edits L5 made:
    - `index.tsx`: `env.chips`, the "Tap chips" first action, the `?layout=<id>` start, and
      merging `validateStageChips` and the table-check warnings;
    - `doc.ts`, `data.ts`, `define.css`, and the integration tests;
  - `tests/e2e/layouts.spec.ts` (new);
  - `tests/e2e/define.spec.ts`, `flow.spec.ts` and `shots.spec.ts`, for e2e breakage from the
    panel change (S7);
  - `docs/screenshots/layouts-*` (via `SHOTS_DIR`).
- **Depends on:** L5, L6 and L8 (and L3b at runtime).
- **Batons:** none expected. If the e2e needs a new helper in `tests/e2e/helpers.ts`, ask for it.
- **Acceptance:**
  - The full owner flow at four viewports: tap a layout, save it, use it in two definitions at $5
    and $25, run, edit the layout and see the stale banner, and sweep the chip value at $5 / $25 /
    $100.
  - Axe is clean in every state, there is no horizontal overflow, and tap targets pass (the
    documented < 24 px line zones are exempt, with the sheet and List as equivalents).
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

---

## 14. Open questions (genuine product calls; the swarm proceeds on the default)

| # | Question | Default (recommended) | Alternatives | Cost to change later |
|---|---|---|---|---|
| Q1 | Does a layout carry a default denomination? | **No.** The stage picks; it preselects the smallest standard chip that meets the table minimums | Store an optional `preferredDenom` in the layout | Low: one optional field |
| Q2 | When the bankroll can't fund the whole layout (or a progression level), what happens? | **The table's existing rule**: spots are funded in placement order, the last ones are reduced or dropped, and over-max spots are cut (open questions 1 and 4); the editor previews it | Shrink every spot evenly; skip the spin; end the session | Low: generated expression (§3.4), no contract change |
| Q3 | After editing a saved layout, should experiments that used it change? | **No.** Each stage keeps its copy, so runs stay reproducible; Define shows "Layout changed: Update / Keep" | Offer "Update everywhere", which saves new definitions for every user | Medium: a bulk tool in Library |
| Q4 | How do I remove chips? | **An Add / Remove toggle** (plus right-click on desktop); long-press opens the bet list | Long-press removes; tapping a stack removes | Low: one handler |
| Q5 | Should the built-in presets show as chips by default? | **No.** They stay as they are; "Edit on the table" converts a stage on request without changing its bets | Convert every preset stage to chips | Medium: preset definition ids, the pinned id vectors and existing "already ran" matches change; traces do not |
