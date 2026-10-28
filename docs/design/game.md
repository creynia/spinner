# spinner: Game design (roulette plugin)

Status: design spike, 2026-10-28. Authority: `docs/design/decisions.md` > this file > `PLAYBOOK.md`.
Owner after reconciliation: the `game` work package (`src/game/roulette/**`).

Every number in this document was computed with exact fractions by
`/tmp/claude-0/spinner-spikes/game_math.py` (Python `fractions`, brute force over pockets, with
closed-form cross-checks as assertions). The script is scratch, not in the repo; the `game`
package re-pins every value in `ev.test.ts` and a reviewer re-derives them independently (PLAYBOOK
§13.1 phase 2).

Prior art: crappy and baccaratton (`/home/user/creynia/*`) set the conventions this plugin follows:
xoshiro128\*\* seeded by splitmix32, unbiased `randBelow` by rejection, exact bigint `Fraction`s in
the math module, house-favouring rounding that never fires on the $1 grid, an independent oracle
test (in the test folder, not importing the bet table), and SVG table layouts as data with a 44 px
tap rule at reference viewports.

---

## 0. Decisions at a glance

| Topic | Decision |
|---|---|
| Wheels | `european` (default, 37 pockets), `american` (38: 0, 00), `triple-zero` (39: 0, 00, 000). |
| Rule flags | `laPartage`, `enPrison` (even-money bets only, single-zero wheel only, mutually exclusive). `enPrisonSecondZero: 'lose'` (default) or `'reimprison'`. |
| Bet families | inside: straight, split, street, trio, corner, basket, sixline. Outside: red, black, odd, even, low, high, dozen:1–3, column:1–3. Call (european only): voisins, tiers, orphelins, jeu-zero, neighbours:n:k. |
| Ids | Inside ids list **all covered pockets** in canonical order (`split:17-20`, `street:16-17-18`, `corner:17-18-20-21`, `sixline:13-14-15-16-17-18`); `basket` is one id per wheel; outside and call ids are words (`red`, `dozen:1`, `voisins`, `neighbours:17:2`). Grammar in §3.2. |
| Limits | $25 table min / $5,000 max; per-class limits from decisions #3; basket max by payout (§4). All are rule fields. |
| Money | Integer cents. Bet unit (`chipUnit`) $1 = 100 cents. Payouts are integer multiples of the stake, so payout rounding never fires; the only division (la partage half refund) floors, in the house's favour, and is exact on the $1 grid. |
| Exact edges | european −1/37 (2.7027%) on every bet; american −1/19 (5.2632%), basket −3/38 (7.8947%); triple-zero −1/13 (7.6923%); la partage −1/74 (1.3514%); en prison −19/1369 (1.3879%) or −1/74 with re-imprisonment. |
| Variance | Per round from the **joint** distribution over pockets: the engine builds one integer-cent net vector per round (one entry per pocket) and takes its exact mean and variance. |
| RNG | One `randBelow(rng, N)` per spin, always, even when sitting out (keeps common random numbers aligned across strategies). |
| Reconcile | Normalise ids → floor amounts to the bet unit → per-bet minimum → per-spot maximum (`clamp` default) → affordability (`reduce` default) → inside-total minimum → `place` actions plus a final `confirm`. Never raises an amount. Never emits an action `apply` rejects. |
| Pace | `live` 40 spins/h (default), `electronic` 100 spins/h. |
| Presets | 12, in the strategy language (§11). |

---

## 1. Rules and variants

### 1.1 Rules type

```ts
export type WheelKind = 'european' | 'american' | 'triple-zero';

export interface RouletteRules {
  preset: 'european' | 'american' | 'triple-zero';   // the preset this was resolved from
  wheel: WheelKind;
  laPartage: boolean;                                  // even-money bets lose half on 0
  enPrison: boolean;                                   // even-money bets are imprisoned on 0
  enPrisonSecondZero: 'lose' | 'reimprison';           // what a 0 does to an imprisoned bet
  limits: TableLimits;                                 // §4
  reconcile: { overMax: 'clamp' | 'reject'; shortfall: 'reduce' | 'reject' };  // §8
  pace: { roundsPerHour: number; label: 'live' | 'electronic' | 'custom' };
}
```

Presets (all with the high-limit table of §4, `reconcile: { overMax: 'clamp', shortfall: 'reduce' }`,
pace `live` 40):

| Preset | Wheel | Pockets | laPartage | enPrison | Call bets |
|---|---|---|---|---|---|
| `european` (default) | single zero | 37 | false | false | yes |
| `american` | double zero | 38 | false (forbidden) | false (forbidden) | no |
| `triple-zero` | triple zero | 39 | false (forbidden) | false (forbidden) | no |

`rules.resolve(p)` takes a preset id or `Partial<RouletteRules> & { preset?: … }` (preset first,
then overrides, deep-merged for `limits`, `reconcile` and `pace`) and **throws a typed
`RulesError`** (the definition validator turns it into a JSON-pointer error) when:

- `laPartage && enPrison` (`rules/flags-exclusive`);
- `laPartage` or `enPrison` on a wheel other than `european` (`rules/flag-needs-single-zero`);
- any limit is not a positive integer multiple of `chipUnit`, or a min exceeds its max
  (`rules/limits`);
- `pace.roundsPerHour` is not in 1..1000 (`rules/pace`).

`rules.describe(r)` returns lines like `"European single zero · La partage · $25–$5,000 · 40 spins/h"`.

"French" roulette is `{ preset: 'european', laPartage: true }`; the picker in Define shows it as a
shortcut chip, not a separate preset (decisions #2 names three presets).

### 1.2 Zero rules (normative)

Applied only to the six even-money bets (`red black odd even low high`), only when a zero pocket
(`0`) comes up on the european wheel:

- **La partage:** the bet loses half. The player gets back `floor(amount / 2)` cents, so the loss is
  `amount − floor(amount / 2)`. Amounts are whole dollars (§5), so the floor never fires.
  Resolution: `result: 'lose'`, `profit: −(amount − floor(amount/2))`, event `partage`.
- **En prison:** the bet stays on the table as an imprisoned bet `prison:<id>` (same amount).
  Resolution of the original entry this round: `result: 'stays'`, `profit: 0`, event `imprisoned`.
  On the next spin the imprisoned bet resolves:
  - its own bet wins → the stake is returned, no winnings: `result: 'push'`, `profit: 0`, event `released`;
  - its own bet loses on a number → `result: 'lose'`, `profit: −amount`, event `prison-lost`;
  - zero again → `'lose'` variant (default): lost, event `prison-lost`; `'reimprison'` variant:
    `result: 'stays'`, it stays imprisoned for another spin.
- An imprisoned bet is a **contract bet**: the strategy cannot remove or change it, and it does not
  count towards the table minimums of the round it rides in (it was already accepted). A new bet on
  `red` in the same round is an independent entry.
- The spin always happens even when the only bet on the table is imprisoned (rounds advance).

---

## 2. Pockets, layout geometry and wheel order

### 2.1 Pockets

Internal pocket index `p`: `0..36` are the numbers, `37` is `00`, `38` is `000`. A wheel with `N`
pockets uses indices `0..N−1`. The label (`PocketLabel`) is `'0' | '00' | '000' | '1'..'36'`.

Canonical pocket order (used in ids): `0 < 00 < 000 < 1 < 2 < … < 36`.

- **Red:** 1 3 5 7 9 12 14 16 18 19 21 23 25 27 30 32 34 36. **Black:** the other 18 of 1..36.
  **Green:** every zero.
- Parity, halves, dozens and columns are defined on 1..36 only; a zero is in none of them.
- Layout grid: number `n` sits in **row** `ceil(n/3)` (1..12) and **column** `((n−1) mod 3) + 1`
  (column 1 = 1, 4, …, 34; column 3 = 3, 6, …, 36).
- Zero row (above row 1): european `0` spans all three columns (touches 1, 2, 3); american `0 | 00`
  side by side (0 touches 1 and 2, 00 touches 2 and 3); triple-zero `0 | 000 | 00` over columns
  1, 2, 3 (assumption, open question Q6).

### 2.2 Wheel order (clockwise from 0)

- european: `0 32 15 19 4 21 2 25 17 34 6 27 13 36 11 30 8 23 10 5 24 16 33 1 20 14 31 9 22 18 29 7 28 12 35 3 26`
  (colours alternate around the wheel: checked).
- american: `0 28 9 26 30 11 7 20 32 17 5 22 34 15 3 24 36 13 1 00 27 10 25 29 12 8 19 31 18 6 21 33 16 4 23 35 14 2`
  (colours alternate except across the zeros: 2·0·28 and 1·00·27; checked).
- triple-zero: display only (no call bets on it; the math never depends on order). The `ui`
  package takes it from a casino rack card at implementation time; until then the table view
  shows the triple-zero wheel without a racetrack.

Sectors (european), each a contiguous arc of the wheel (checked):

| Sector | Arc | Pockets (17 / 12 / 8 / 7) |
|---|---|---|
| voisins du zéro | 22 → 25 | 22 18 29 7 28 12 35 3 26 0 32 15 19 4 21 2 25 |
| tiers du cylindre | 27 → 33 | 27 13 36 11 30 8 23 10 5 24 16 33 |
| orphelins | the rest (two arcs) | 17 34 6 · 1 20 14 31 9 |
| jeu zéro (inside voisins) | 12 → 15 | 12 35 3 26 0 32 15 |

Voisins, tiers and orphelins partition the wheel (checked).

---

## 3. Bet catalog

### 3.1 Families, payouts, limit classes

`category` is the family (UI grouping, per-category breakdowns in the summary table); `limitClass`
is what the limits of §4 apply to. Payout "X to 1" = profit X per 1 staked; the stake comes back on a win.

| Family | Ids | Covers | Pays | category | limitClass | Wheels |
|---|---|---|---|---|---|---|
| straight | `straight:<p>` | 1 | 35:1 | `straight` | inside | all (`00` am/3z, `000` 3z) |
| split | `split:<a>-<b>` | 2 | 17:1 | `split` | inside | all; zero splits per wheel |
| street | `street:<n>-<n+1>-<n+2>` (n = 1, 4, …, 34) | 3 | 11:1 | `street` | inside | all |
| trio | `trio:<a>-<b>-<c>` (contains a zero) | 3 | 11:1 | `trio` | inside | per wheel |
| corner | `corner:<n>-<n+1>-<n+3>-<n+4>` (n mod 3 ≠ 0, n ≤ 32) | 4 | 8:1 | `corner` | inside | all |
| basket | `basket` | 4 / 5 / 6 | 8:1 / 6:1 / 5:1 | `basket` | inside | eu first four `0 1 2 3`; am top line `0 00 1 2 3`; 3z top line `0 00 000 1 2 3` |
| sixline | `sixline:<n>-…-<n+5>` (n = 1, 4, …, 31) | 6 | 5:1 | `sixline` | inside | all |
| even money | `red` `black` `odd` `even` `low` `high` | 18 | 1:1 | `even-money` | outside | all |
| dozen | `dozen:1` `dozen:2` `dozen:3` (1–12, 13–24, 25–36) | 12 | 2:1 | `dozen` | outside | all |
| column | `column:1` `column:2` `column:3` | 12 | 2:1 | `column` | outside | all |
| call | `voisins` `tiers` `orphelins` `jeu-zero` | 17/12/8/7 | by component | `call` | call | european |
| neighbours | `neighbours:<p>:<k>` (k = 1..9) | 2k+1 | 35:1 per piece | `neighbours` | call | european |
| prison | `prison:<even-money id>` | as its bet | returns stake | `even-money` | (none) | european + enPrison; engine-created, never placeable |

Zero-row bets per wheel:

| Wheel | Zero splits | Trios | Basket |
|---|---|---|---|
| european | `split:0-1` `split:0-2` `split:0-3` | `trio:0-1-2` `trio:0-2-3` | `basket` = 0 1 2 3, 8:1 |
| american | `split:0-1` `split:0-2` `split:00-2` `split:00-3` `split:0-00` | `trio:0-1-2` `trio:0-00-2` `trio:00-2-3` | `basket` = 0 00 1 2 3, 6:1 |
| triple-zero | `split:0-1` `split:000-2` `split:00-3` `split:0-000` `split:00-000` | `trio:0-00-000` | `basket` = 0 00 000 1 2 3, 5:1 |

Catalog sizes (checked by the script): european **157** fixed ids (37 straight, 60 split, 12
street, 2 trio, 22 corner, 1 basket, 11 sixline, 12 outside) + 4 call + 37 × 9 = 333
neighbours = **494**; american **161**; triple-zero **160** (39, 62, 12, 1, 22, 1, 11, 12).
`catalog(rules)` returns the fixed ids plus one parameterised entry `neighbours:<p>:<k>` with
`parameters: { p: 'number', k: 'number' }` (so the picker and validator know it, without 333 rows).

### 3.2 Id grammar

```
betId     := inside | outside | call | prison
pocket    := "0" | "00" | "000" | n            ; n = 1..36, decimal, no leading zero
inside    := "straight:" pocket
           | ("split" | "street" | "trio" | "corner" | "sixline") ":" pocket ("-" pocket)+
           | "basket"
outside   := "red" | "black" | "odd" | "even" | "low" | "high"
           | "dozen:" ("1"|"2"|"3") | "column:" ("1"|"2"|"3")
call      := "voisins" | "tiers" | "orphelins" | "jeu-zero"
           | "neighbours:" pocket ":" k        ; k = 1..9
prison    := "prison:" ("red"|"black"|"odd"|"even"|"low"|"high")
```

**Canonical form:** inside pockets in canonical order (§2.1), joined by `-`, listing *every*
covered pocket; the set must be a legal bet of that family on some wheel (`split:17-21` is
syntactically fine and semantically `null`). `bets.parse(s)` returns the canonical id or `null`;
it is case-insensitive, trims, and accepts these **aliases** (never emitted):

| Alias | Canonical |
|---|---|
| pockets in any order: `split:20-17`, `corner:21-17-20-18` | `split:17-20`, `corner:17-18-20-21` |
| `street:16` (first number), `sixline:13` (first number), `sixline:13-18` (first-last) | `street:16-17-18`, `sixline:13-14-15-16-17-18` |
| `17` (bare pocket) | `straight:17` |
| `first-four`, `top-line` | `basket` |
| `1-18`, `manque`; `19-36`, `passe`; `rouge`; `noir`; `pair`; `impair` | `low`, `high`, `red`, `black`, `even`, `odd` |
| `voisins-du-zero`, `tiers-du-cylindre`, `zero-spiel`, `jeu-0` | `voisins`, `tiers`, `jeu-zero` |
| `neighbours:17` | `neighbours:17:2` |

`parse` is wheel-independent; `bets.available(id, state)` says whether the current wheel has it
(`straight:00` on european → false; `voisins` on american → false). Definitions store canonical
ids; the validator rewrites aliases on import and warns (`bet/alias`).

### 3.3 Call bets (european), expanded into component chips

A call bet's `amount` is its **total**; `pieces` is the number of equal pieces; each component chip
is `pieces-weight × piece`, where `piece = amount / pieces`.

| Id | Pieces | Components (weight) | Net per pocket, in pieces |
|---|---|---|---|
| `voisins` | 9 | `trio:0-2-3` ×2, `split:4-7`, `split:12-15`, `split:18-21`, `split:19-22`, `split:32-35`, `corner:25-26-28-29` ×2 | +15 on 0 2 3 25 26 28 29; +9 on the other ten covered; −9 elsewhere |
| `tiers` | 6 | `split:5-8` `split:10-11` `split:13-16` `split:23-24` `split:27-30` `split:33-36` | +12 covered, −6 elsewhere |
| `orphelins` | 5 | `straight:1`, `split:6-9`, `split:14-17`, `split:17-20`, `split:31-34` | +31 on 17, +13 on the other seven, −5 elsewhere |
| `jeu-zero` | 4 | `split:0-3`, `split:12-15`, `straight:26`, `split:32-35` | +32 on 26, +14 on the other six, −4 elsewhere |
| `neighbours:<p>:<k>` | 2k+1 | `straight:` on p and k wheel neighbours each side | +(35 − 2k) covered, −(2k+1) elsewhere |

Example: `neighbours:17:2` = straights on 2 25 17 34 6; `neighbours:0:2` = 3 26 0 32 15.

Rules for call bets:

- They resolve and report as **one entry** (`resolutions[i].bet = 'voisins'`, `profit` = sum of
  components, `result` by the sign of profit), so progressions can track them. Component detail
  goes to the trace (`components: [{ bet, amount, profit }]`).
- Their components are inside chips: each must be ≥ `inside.minChip`, they count towards
  `inside.minTotal`, and they share spots with plain inside bets for `inside.max` (§4).
- Their bet unit is `pieces × chipUnit` (voisins $9, tiers $6, orphelins $5, jeu-zero $4,
  neighbours $(2k+1)).

---

## 4. Table limits

```ts
export interface TableLimits {
  chipUnit: Cents;                  // 100: every amount is a whole multiple of this
  outside: { min: Cents; max: Cents };                         // per bet: 2500 / 500000
  inside: {
    minChip: Cents;                 // 100: per inside chip, including call-bet components
    minTotal: Cents;                // 2500: total of inside chips per spin, if any are placed
    max: Record<'straight'|'split'|'street'|'trio'|'corner'|'basket'|'sixline', Cents>;
  };
  maxTotalPerSpin: Cents | null;    // null: no aggregate cap (open question Q7)
}
```

Defaults (decisions #3). Inside maxima keep the maximum payout at ≤ 35 × $500 = $17,500:

| Spot | Pays | Max | Max payout | Bound $17,500 / pays |
|---|---|---|---|---|
| straight | 35 | $500 | $17,500 | $500.00 |
| split | 17 | $1,000 | $17,000 | $1,029.41 |
| street, trio | 11 | $1,500 | $16,500 | $1,590.90 |
| corner | 8 | $2,000 | $16,000 | $2,187.50 |
| basket (european, 8:1) | 8 | $2,000 | $16,000 | $2,187.50 |
| basket (american, 6:1) | 6 | $2,500 | $15,000 | $2,916.66 |
| basket (triple-zero, 5:1) | 5 | $3,000 | $15,000 | $3,500.00 |
| sixline | 5 | $3,000 | $15,000 | $3,500.00 |
| outside, each | 1 or 2 | $5,000 | $10,000 | (class max) |

The basket max follows the same-payout bet (corner, six-line) and, for 6:1, the next $500 step
below the bound. The `basket` default therefore depends on the wheel (presets set it).

Limits apply **per spot**: amounts on the same spot from several layout entries (e.g. `split:17-20`
and `orphelins`, which contains it) add up before the max is checked.

Call bets, derived from the components (script-checked):

| Call bet | Binding component | Max piece | Max total | Min total on its own (inside minTotal $25) |
|---|---|---|---|---|
| `voisins` | trio ×2 ≤ $1,500 | $750 | $6,750 | $27 (piece $3) |
| `tiers` | splits ≤ $1,000 | $1,000 | $6,000 | $30 (piece $5) |
| `orphelins` | straight:1 ≤ $500 | $500 | $2,500 | $25 (piece $5) |
| `jeu-zero` | straight:26 ≤ $500 | $500 | $2,000 | $28 (piece $7) |
| `neighbours:p:k` | straights ≤ $500 | $500 | $(2k+1)×500 | smallest multiple of 2k+1 dollars ≥ $25 |

---

## 5. Payouts and rounding policy (integer cents)

- Every amount the engine accepts is a positive multiple of `chipUnit` (100 cents); call bets a
  multiple of `pieces × chipUnit`. `reconcile` guarantees it (§8); `apply` rejects anything else.
- Win: the stake comes back plus `profit = amount × pays` (integer). Lose: `profit = −amount`.
- La partage: refund `floor(amount / 2)`, so `profit = −(amount − floor(amount / 2))`. The floor
  is the house-favouring direction (same rule as baccaratton's commission) and never fires
  because amounts are even numbers of cents.
- En prison release: `profit = 0` (stake returned).
- No other division exists in roulette, so the engine's cents equal the exact-fraction EV times
  the stake for every bet; a test asserts `Σ_p net[p] × 1/N == amount × edge` exactly.
- `equity(state) = bankroll + Σ placed stakes + Σ imprisoned stakes` (face value, PLAYBOOK §4).
  After a spin the layout is empty except for imprisoned bets.

---

## 6. Exact EV and variance

Notation: one unit staked, `N` pockets, bet covers `k`, pays `X`:
`EV = (k(X+1) − N) / N`, `E[x²] = (kX² + (N − k)) / N`, `Var = E[x²] − EV²`.
Every row below was brute-forced over the pockets and matched the closed form.

### 6.1 Per bet, per unit stake

**European (N = 37).** Every bet has EV −1/37 = −2.7027%.

| Bet | k | Pays | P(win) | Variance (exact) | Variance | SD |
|---|---|---|---|---|---|---|
| straight | 1 | 35 | 1/37 | 46656/1369 | 34.080351 | 5.837838 |
| split | 2 | 17 | 2/37 | 22680/1369 | 16.566837 | 4.070238 |
| street, trio | 3 | 11 | 3/37 | 14688/1369 | 10.728999 | 3.275515 |
| corner, basket | 4 | 8 | 4/37 | 10692/1369 | 7.810080 | 2.794652 |
| sixline | 6 | 5 | 6/37 | 6696/1369 | 4.891161 | 2.211597 |
| dozen, column | 12 | 2 | 12/37 | 2700/1369 | 1.972243 | 1.404366 |
| even money | 18 | 1 | 18/37 | 1368/1369 | 0.999270 | 0.999635 |

**American (N = 38).** EV −1/19 = −5.2632% except the basket.

| Bet | k | Pays | P(win) | EV | Variance (exact) | Variance | SD |
|---|---|---|---|---|---|---|---|
| straight | 1 | 35 | 1/38 | −1/19 | 11988/361 | 33.207756 | 5.762617 |
| split | 2 | 17 | 1/19 | −1/19 | 5832/361 | 16.155125 | 4.019344 |
| street, trio | 3 | 11 | 3/38 | −1/19 | 3780/361 | 10.470914 | 3.235879 |
| corner | 4 | 8 | 2/19 | −1/19 | 2754/361 | 7.628809 | 2.762030 |
| **basket (top line)** | 5 | 6 | 5/38 | **−3/38 (−7.8947%)** | 8085/1444 | 5.599030 | 2.366227 |
| sixline | 6 | 5 | 3/19 | −1/19 | 1728/361 | 4.786704 | 2.187854 |
| dozen, column | 12 | 2 | 6/19 | −1/19 | 702/361 | 1.944598 | 1.394489 |
| even money | 18 | 1 | 9/19 | −1/19 | 360/361 | 0.997230 | 0.998614 |

**Triple zero (N = 39).** Every bet has EV −1/13 = −7.6923% (the 6-number basket at 5:1 too).

| Bet | k | Pays | P(win) | Variance (exact) | Variance | SD |
|---|---|---|---|---|---|---|
| straight | 1 | 35 | 1/39 | 5472/169 | 32.378698 | 5.690228 |
| split | 2 | 17 | 2/39 | 2664/169 | 15.763314 | 3.970304 |
| street, trio | 3 | 11 | 1/13 | 1728/169 | 10.224852 | 3.197632 |
| corner | 4 | 8 | 4/39 | 1260/169 | 7.455621 | 2.730498 |
| sixline, basket | 6 | 5 | 2/13 | 792/169 | 4.686391 | 2.164807 |
| dozen, column | 12 | 2 | 4/13 | 324/169 | 1.917160 | 1.384615 |
| even money | 18 | 1 | 6/13 | 168/169 | 0.994083 | 0.997037 |

### 6.2 Even-money bets under the zero rules (european, per unit)

| Rule | Lifetime EV (edge) | Lifetime variance | Per-round accounting (face value) |
|---|---|---|---|
| none | −1/37 = −2.7027% | 1368/1369 = 0.999270 | same |
| la partage | **−1/74 = −1.3514%** | 1341/1369 = 0.979547 | same (resolves in one spin) |
| en prison, 2nd zero loses (default) | **−19/1369 = −1.3879%** | 1849158/1874161 = 0.986659 | fresh bet round: EV 0, Var 36/37; imprisoned bet round: EV −19/37, Var 342/1369 |
| en prison, re-imprison | **−1/74 = −1.3514%** | 5401/5476 = 0.986304 | fresh: EV 0, Var 36/37; imprisoned: EV −18/37, Var 342/1369 |

The per-round column is what the harness accumulates (`expectedLossPerRound` on the layout
actually on the table, imprisoned bets valued at face value). It sums to the lifetime value:
`0 + (1/37)(−19/37) = −19/1369` (checked). A consequence users will see in the trace: with en
prison, a fresh red bet's expected loss *in its own round* is 0, and the cost shows up in the
following round, if a zero came. `betEdge('red')` reports the lifetime edge (−19/1369) and
`perRound` the face-value one, and the rules reference explains this in one sentence.

### 6.3 Call and neighbour bets (european, per unit of total stake)

All EV −1/37. Variance is from the joint distribution of the components (they never overlap within
one call bet except in pocket coverage, which the joint handles); the last column shows how wrong
summing component variances would be.

| Bet | Pieces | P(net > 0) | Variance (exact) | Variance | SD | Σ component variances (wrong) |
|---|---|---|---|---|---|---|
| `voisins` | 9 | 17/37 | 4696/4107 | 1.143414 | 1.069305 | 1.938154 |
| `tiers` | 6 | 12/37 | 2700/1369 | 1.972243 | 1.404366 | 2.761140 |
| `orphelins` | 5 | 8/37 | 135432/34225 | 3.957107 | 1.989248 | 4.013908 |
| `jeu-zero` | 4 | 7/37 | 12393/2738 | 4.526297 | 2.127509 | 5.236304 |
| `neighbours:p:1` | 3 | 3/37 | 14688/1369 | 10.728999 | 3.275515 | |
| `neighbours:p:2` | 5 | 5/37 | 41472/6845 | 6.058729 | 2.461449 | |
| `neighbours:p:3` | 7 | 7/37 | 38880/9583 | 4.057185 | 2.014245 | |
| `neighbours:p:4` | 9 | 9/37 | 4032/1369 | 2.945215 | 1.716163 | |
| `neighbours:p:5` | 11 | 11/37 | 33696/15059 | 2.237599 | 1.495861 | |
| `neighbours:p:6` | 13 | 13/37 | 31104/17797 | 1.747710 | 1.322010 | |
| `neighbours:p:7` | 15 | 15/37 | 9504/6845 | 1.388459 | 1.178329 | |
| `neighbours:p:8` | 17 | 17/37 | 25920/23273 | 1.113737 | 1.055337 | |
| `neighbours:p:9` | 19 | 19/37 | 23328/26011 | 0.896851 | 0.947022 | |

(Tiers has exactly the variance of a dozen: 12 pockets at an effective 2:1.)

### 6.4 Joint per round (why covariance matters)

Per round with several bets, `Var(Σ bets) ≠ Σ Var(bet)`. Examples, stakes in units:

| Layout | Wheel | Stake | EV (exact) | Edge | Joint variance | Σ per-bet variances |
|---|---|---|---|---|---|---|
| red 1 + black 1 | eu | 2 | −2/37 | −2.7027% | 144/1369 = 0.1052 | 1.9985 |
| red 1 + black 1, la partage | eu | 2 | −1/37 | −1.3514% | 36/1369 = 0.0263 | 1.9591 |
| red 1 + black 1 | am | 2 | −2/19 | −5.2632% | 72/361 = 0.1994 | 1.9945 |
| dozen:1 1 + dozen:2 1 | eu | 2 | −2/37 | −2.7027% | 2808/1369 = 2.0511 | 3.9445 |
| dozen:1 1 + dozen:2 1 | am | 2 | −2/19 | −5.2632% | 756/361 = 2.0942 | 3.8892 |
| red 1 + straight:0 1 | eu | 2 | −2/37 | −2.7027% | 45432/1369 = 33.1863 | 35.0796 |
| red 1 + column:2 1 | eu | 2 | −2/37 | −2.7027% | 3252/1369 = 2.3755 | 2.9715 |
| red 1 + odd 1 | eu | 2 | −2/37 | −2.7027% | 3104/1369 = 2.2673 | 1.9985 |
| red 1 + even 1 | eu | 2 | −2/37 | −2.7027% | 2512/1369 = 1.8349 | 1.9985 |
| James Bond: high 14, sixline:13-…-18 5, straight:0 1 | eu | 20 | −20/37 | −2.7027% | 251496/1369 = 183.7078 | 352.2162 |
| all 37 straights × 1 | eu | 37 | −1 | −2.7027% | 0 | 1260.9730 |

(Red and odd overlap on 10 of 18 numbers, so they are positively correlated: joint > sum.)

At the default unit $25: flat red EV −2500/37 = **−67.57 ¢/spin** (SD $24.99), **−$27.03/h** at
40/h, −$67.57/h at 100/h. James Bond at $500/spin: −$13.51/spin (SD $338.85), −$540.54/h.
Two dozens at $25 each: −$1.35/spin (SD $35.80), −$54.05/h.

### 6.5 How the plugin computes it

- `src/game/roulette/netvector.ts`: `netVector(state, out: Float64Array)` fills, for the layout
  on the table (new bets plus imprisoned bets), the round's net in cents for each pocket (integers
  stored in a reused `Float64Array(N)`; components of call bets expanded; zero rules applied).
  **The same function settles the spin** (`net = vector[pocket]`), so preview and play cannot
  disagree, and the oracle test checks this function against an independent oracle.
- `expectedLossPerRound = −Σ v[p] / N`; `variancePerRound = (N·Σ v² − (Σ v)²) / N²`.
  `Σ v` and `Σ v²` are exact in float64 while `Σ v² < 2^53` (true for every layout under the
  default limits: the largest |net| is bounded by the maxima; the code asserts the bound and falls
  back to `BigInt` sums if it is exceeded, e.g. with user-raised limits). The only rounding is the
  final division, so the harness's sums are exact to float precision.
- `src/game/roulette/ev.ts` (exact `Fraction`s, used by `betEdge`, the rules reference and tests):
  `betOutcomes(bet, rules)` → `[{ net: Fraction, p: Fraction }]`; `betEdge`, `betVariance`,
  `layoutMoments(layout, rules)` by brute force over pockets. Prior-art `Fraction` shapes differ
  (crappy `{n, d}`, baccaratton `{num, den}`); spinner uses whatever `src/core/money` exports
  (the shared-core spike decides; crappy's `{n, d}` is the recommendation).
- Results are cached per layout signature (sorted `bet:amount` string) within a session: a flat or
  Martingale layout repeats, so most rounds reuse the vector moments.

---

## 7. Engine: state, actions, RNG

### 7.1 State

```ts
export interface RouletteState {
  rules: RouletteRules;
  wheel: WheelSpec;               // N, pockets, wheel order, coverage masks (shared, frozen)
  rng: RngState;                  // xoshiro128** (src/core/rng), seeded from the session seed
  forced: number[];               // test/scene queue of pocket indices, consumed before the RNG
  bankroll: Cents;                // excludes stakes on the table
  layout: PlacedBet[];            // bets placed this decision window (cleared by playRound)
  prison: PlacedBet[];            // imprisoned even-money bets (persist; contract)
  confirmed: boolean;             // 'confirm' accepted for this window ("no more bets")
  round: number;                  // spins played
  history: SpinHistory;           // §9: ring buffer + incremental fact counters
}
export interface PlacedBet { bet: BetId; amount: Cents; spots: SpotChip[]; }  // spots: expanded chips
export interface SpotChip { spot: BetId; amount: Cents; }                    // spot = a plain catalog bet
```

`createState(rules, seed, bankroll, opts?: { forcedPockets?: PocketLabel[] })`; the PLAYBOOK
draft lacks the bankroll argument (contract note C1, §14). State is owned by the session loop:
`apply` and `playRound` **may mutate and return the same object** (no per-round allocation beyond
the outcome); tests that need snapshots use `serialize`/`deserialize`.

### 7.2 Actions and `apply`

```ts
export type RouletteAction =
  | { type: 'place'; bet: BetId; amount: Cents }    // one layout entry (call bets expand inside)
  | { type: 'remove'; bet: BetId }                  // UI only; reconcile never needs it
  | { type: 'confirm' };                            // "no more bets": cross-bet checks
```

`apply` rejects with a code (and never partially applies):

| Code | When |
|---|---|
| `unknown-bet` | `parse` fails |
| `not-on-wheel` | not available on this wheel (e.g. `voisins` on american) |
| `not-placeable` | `prison:*` |
| `after-confirm` | `place`/`remove` after `confirm` |
| `bad-amount` | not a positive integer multiple of the bet unit |
| `below-min` | outside < `outside.min`, or an inside chip (incl. components) < `inside.minChip` |
| `over-max` | outside > `outside.max`, or a spot's total > its `inside.max` |
| `unaffordable` | amount > bankroll |
| `inside-min-total` | (`confirm`) inside chips placed this window total > 0 and < `inside.minTotal` |
| `table-max` | (`confirm`) `maxTotalPerSpin` set and exceeded |
| `not-placed` | `remove` of a bet not in `layout` |

`place` debits the bankroll; `remove` credits it. Placing the same id twice adds to the entry.

### 7.3 `playRound`

1. Precondition: `confirmed` or `layout` empty (an unconfirmed non-empty layout throws: a harness
   bug, not a strategy error).
2. Draw the pocket: `forced.shift()` if any, else `randBelow(rng, N)` (core RNG: draw a `u32`,
   reject `u ≥ 2^32 − (2^32 mod N)`, return `u mod N`). Limits: N=37 → 4294967289 (reject
   probability 7/2^32), N=38 → 4294967290 (6/2^32), N=39 → 4294967274 (22/2^32). Index → pocket
   by §2.1. **Exactly one pocket per round, whether or not bets are on the table**, so two
   strategies with the same session seed see the same spins (common random numbers).
3. Settle via `netVector`: per entry `profit` and `result` (`win` > 0, `lose` < 0, `push` = 0,
   `stays` for imprisonment); credit bankroll with stake + profit for resolved entries; move newly
   imprisoned bets to `prison`; settle previously imprisoned bets first (order in `resolutions`:
   prison entries, then layout entries in placement order).
4. Update `history` (§9), `round++`, clear `layout`, `confirmed = false`.
5. Return `RoundOutcome`: `net` (Σ profit; equals the equity change), `wagered` (Σ new stakes
   this round; imprisoned stakes are not re-counted), `resolutions`, `events` (§9.3), `summary`
   `{ pocket: '17', index: 17, color: 'black', parity: 'odd', half: 'low', dozen: 2, column: 2,
   sector: 'orphelins' }`.

Invariant (tested every round): `equity_after − equity_before == outcome.net`.

---

## 8. `reconcile(state, desired)`

The only path from a strategy to the engine. Roulette's layout is empty at each decision window
(except imprisoned bets, which reconcile never touches), so reconcile only places. It is pure,
deterministic, processes entries in the **desired order**, and returns
`{ actions, deferred: [], rejected, adjusted, affordable }` (`adjusted` is contract note C2).

Steps:

1. **Normalise.** `parse` each `bet`. Unknown → reject `unknown-bet`; not on this wheel → reject
   `not-on-wheel`; `prison:*` → reject `not-placeable`. Duplicate canonical ids are **summed** into
   the first occurrence (adjusted `merged`).
2. **Amount sanity.** `amount` is a JS number from the interpreter (it may be fractional, from
   `div` or `pctOfBankroll`). Not finite or < 0 → reject `invalid-amount`. Exactly 0 → dropped
   (not a bet; no trace noise beyond `skipped-zero`).
3. **Round down to the bet unit** (`chipUnit`, or `pieces × chipUnit` for call bets):
   `a = floor(amount / unit) × unit`. Never round up: the strategy never spends more than it asked.
   If changed → adjusted `rounded`. If `a == 0` → reject `below-min`.
4. **Minimum per bet.** Outside `a < outside.min`, or any component chip `< inside.minChip` →
   reject `below-min` (never raised to the minimum).
5. **Maximum per spot**, accumulating spot usage in desired order (plain bets and call-bet
   components share spots). Outside: `a > outside.max`. Inside: spot total > `inside.max[family]`.
   Call bet: the largest piece such that every component fits. Policy `rules.reconcile.overMax`:
   `'clamp'` (default) lowers `a` to the largest legal multiple of the unit (adjusted `clamped`;
   if that is below the minimum → reject `over-max`); `'reject'` → reject `over-max`.
6. **Affordability**, with `available = bankroll` decreasing in order. If `a > available`: policy
   `rules.reconcile.shortfall`: `'reduce'` (default) lowers `a` to `floor(available / unit) × unit`
   (adjusted `reduced`) if that still meets step 4's minimum, else reject `unaffordable`;
   `'reject'` → reject `unaffordable`.
7. **Inside total.** If the surviving inside chips total > 0 and < `inside.minTotal`, reject every
   inside and call entry with `inside-min-total` (and return their money to `available`; it is
   not reallocated). Never raised.
8. **Table max** (`maxTotalPerSpin`, if set): clamp/reject from the last entry backwards
   (`table-max`).
9. Emit one `place` per surviving entry, in order, then `confirm` (also when nothing survives, so
   the window is closed; an empty `confirm` is always legal).
10. `affordable = false` iff the desired layout had at least one entry, none survived, and at
    least one was rejected `unaffordable`. With nothing on the table (no imprisoned bets) the
    harness then ends the session `bust` (PLAYBOOK §5.6 step 5).

Property (tested): applying `actions` in order to `state` never fails; every placed amount ≤ its
requested amount; reconcile is idempotent on its own output.

### 8.1 Examples (default european high-limit rules)

| # | Bankroll | Desired | Result |
|---|---|---|---|
| 1 | $1,000 | `red` $25 | place red $25; confirm |
| 2 | $10,000 | `red` $6,400 (Martingale step 9 at $25) | adjusted `clamped` → $5,000; place; confirm |
| 3 | $300 | `red` $800 | adjusted `reduced` → $300; place; confirm |
| 4 | $10 | `red` $25 | reject `unaffordable` ($10 < $25 min); confirm; `affordable: false` → bust |
| 5 | $1,000 | `straight:17` $5 | reject `inside-min-total` ($5 < $25 inside total); confirm |
| 6 | $1,000 | `straight:17` $5, `split:17-20` $10, `corner:17-18-20-21` $10 | inside total $25: three places; confirm |
| 7 | $1,000 | `red` $37.50 (from `div`) | adjusted `rounded` → $37; place; confirm |
| 8 | $1,000 | `voisins` $40 | unit $9 → adjusted `rounded` $36 (piece $4: trio $8, corner $8, splits $4); place; confirm |
| 9 | $10,000 | `orphelins` $3,000 | piece $600 > $500 on `straight:1` → clamped to piece $500, total $2,500 |
| 10 | $10,000 | `straight:17` $400, `neighbours:17:2` $1,500 | straight placed; neighbours piece $300 would put $700 on spot `straight:17` (max $500) → piece clamped to $100, total $500 (adjusted `clamped`); inside total $900 |
| 11 | $1,000 | `voisins` $40 on `american` | reject `not-on-wheel` (the validator also flags it at definition time) |
| 12 | $1,000 | `red` $25, `red` $25 | merged → red $50 |
| 13 | $50 (+ $25 imprisoned on red) | `red` $25, `black` $50 | red $25 placed, leaving $25; black adjusted `reduced` → $25, placed; the imprisoned red is untouched and rides as well |

---

## 9. Facts and events (§3.2)

The plugin publishes a `FactSchema` (names, types, enums, docs) that the builder, validator and
interpreter share. Before the first spin every `last*` fact is `null` and comparisons with it are
false. The strategy spike owns the condition syntax; parameterised facts use the bet-id style
`name:param` and are **registered at compile time** so the plugin maintains only the counters a
strategy actually needs (no per-round allocation).

### 9.1 Targets

A **target** is anything with a pocket coverage: any bet id on this wheel (`red`, `dozen:2`,
`straight:17`, `split:17-20`, `voisins`, `neighbours:17:2`) or `zero` (all zero pockets) or
`green` (alias of zero). "Spins since red" therefore means "spins since a pocket that red covers".

### 9.2 Game facts

| Fact | Type | Meaning |
|---|---|---|
| `lastNumber` | `PocketLabel \| null` | last pocket (`'0'`, `'00'`, `'17'`) |
| `lastColor` | `'red' \| 'black' \| 'green' \| null` | |
| `lastParity` | `'odd' \| 'even' \| 'zero' \| null` | |
| `lastHalf` | `'low' \| 'high' \| 'zero' \| null` | |
| `lastDozen` | `0 \| 1 \| 2 \| 3 \| null` | 0 = a zero pocket |
| `lastColumn` | `0 \| 1 \| 2 \| 3 \| null` | 0 = a zero pocket |
| `lastSector` | `'voisins' \| 'tiers' \| 'orphelins' \| null` | european only |
| `lastZero` | `boolean` | last pocket was a zero |
| `spinsSince:<target>` | int | spins since the target last hit; `round` if never (0 right after a hit) |
| `streak:<target>` | int | consecutive most-recent spins that hit the target (0 if the last missed) |
| `count:<target>:<n>` | int | hits in the last `n` spins, `1 ≤ n ≤ 1000` (fewer spins so far → counts what exists) |
| `hits:<target>` | int | hits this session |
| `zeroCount` | int | `hits:zero` |
| `colorStreak` | int | length of the current run of equal `lastColor` (a zero run counts as `green`) |
| `imprisoned:<even-money id>` | Cents | amount imprisoned on that bet (0 if none) |

The generic language conditions map onto these: `{ streak: { of: 'lastColor', equals: 'red', atLeast: 5 } }`
compiles to `streak:red ≥ 5`; `{ countInLast: { n: 10, fact: 'lastColor', equals: 'red', atLeast: 7 } }`
to `count:red:10 ≥ 7`; `{ since: … }` to `spinsSince:*`. The interpreter may keep its own fact
history for facts the plugin does not index, but for the roulette enum facts it should use these.

Implementation (`facts.ts`): `SpinHistory` holds a `Uint8Array(1024)` ring of pocket indices and,
per registered target, a coverage mask `Uint8Array(N)`, `lastHit`, `streak`, `hits` (Int32) and,
per registered `(target, n)`, a running count updated as `+hit(now) − hit(pocket n spins ago)`.
All O(registered targets) per spin.

### 9.3 Events (fired for the round just resolved)

| Event | Param | When |
|---|---|---|
| `spin` | | every round played, bets or not |
| `zero` | | the pocket was a zero |
| `bet-won` / `bet-lost` / `bet-push` | `bet` | a resolution with that result (`push` = en prison release) |
| `partage` | `bet` | la partage halved an even-money bet |
| `imprisoned` | `bet` | an even-money bet went to prison |
| `released` | `bet` | an imprisoned bet was returned |
| `prison-lost` | `bet` | an imprisoned bet was lost |

`bet` params are canonical ids of the **placed** entry (`red`, not `prison:red`, for the three
prison events). Progressions tracking `red` see `stays` as "no result" (no step) and do not see the
later release/loss (it is a separate resolution under `prison:red`); rules can react to the events.

---

## 10. Pace

`pace: { roundsPerHour: 40, label: 'live' }` by default; `rules.pace` preset `electronic` = 100.
`ExperimentDefinition.session.roundsPerHour` overrides both. Define shows "500 spins ≈ 12.5 h at a
live wheel" next to the rounds field.

---

## 11. Presets (strategy language, PLAYBOOK §3.6 / §5 shapes)

Files: `src/game/roulette/presets/<id>.json`, one `StrategyDefinition` each, `unit: 2500`. The
strategy spike owns the exact progression semantics (`maxSteps` = number of amounts in the
sequence here: Martingale `maxSteps: 8` → 1, 2, …, 128 units = $25 … $3,200, all below the $5,000
max). Session stops (bankroll, stop-win/loss, rounds) are in the experiment, not the strategy,
except where the system itself defines them. A test validates and runs every preset on all three
wheels and pins a golden trace on european for seed 1.

```json
{ "schema": 1, "id": "flat-red", "name": "Flat: red", "game": "roulette", "unit": 2500,
  "notes": "One unit on red every spin. The baseline every other system is compared with.",
  "stages": [ { "id": "flat", "layout": [ { "bet": "red", "amount": { "units": 1 } } ], "rules": [] } ] }
```

```json
{ "schema": 1, "id": "martingale-red", "name": "Martingale: red", "game": "roulette", "unit": 2500,
  "notes": "Double after each loss, back to one unit after a win; eight steps ($25 to $3,200), then reset.",
  "progressions": { "m": { "kind": "martingale", "base": { "units": 1 }, "maxSteps": 8, "onCap": "reset", "track": "red" } },
  "stages": [ { "id": "play", "layout": [ { "bet": "red", "amount": { "prog": "m" } } ], "rules": [] } ] }
```

```json
{ "schema": 1, "id": "grand-martingale-red", "name": "Grand Martingale: red", "game": "roulette", "unit": 2500,
  "notes": "Double plus one unit after each loss (1, 3, 7, 15, 31, 63, 127 units); seven steps, then reset.",
  "progressions": { "g": { "kind": "grand-martingale", "base": { "units": 1 }, "maxSteps": 7, "onCap": "reset", "track": "red" } },
  "stages": [ { "id": "play", "layout": [ { "bet": "red", "amount": { "prog": "g" } } ], "rules": [] } ] }
```

```json
{ "schema": 1, "id": "fibonacci-red", "name": "Fibonacci: red", "game": "roulette", "unit": 2500,
  "notes": "Next Fibonacci number after a loss, two steps back after a win; 12 steps (1 to 144 units).",
  "progressions": { "f": { "kind": "fibonacci", "base": { "units": 1 }, "maxSteps": 12, "onCap": "reset", "track": "red" } },
  "stages": [ { "id": "play", "layout": [ { "bet": "red", "amount": { "prog": "f" } } ], "rules": [] } ] }
```

```json
{ "schema": 1, "id": "dalembert-red", "name": "d'Alembert: red", "game": "roulette", "unit": 2500,
  "notes": "One unit more after a loss, one less after a win (never below one); capped at 20 units.",
  "progressions": { "d": { "kind": "dalembert", "base": { "units": 1 }, "maxSteps": 20, "onCap": "stay", "track": "red" } },
  "stages": [ { "id": "play", "layout": [ { "bet": "red", "amount": { "prog": "d" } } ], "rules": [] } ] }
```

```json
{ "schema": 1, "id": "labouchere-red", "name": "Labouchere 1-2-3-4: red", "game": "roulette", "unit": 2500,
  "notes": "Bet first + last of the line; cross both off on a win, append the bet on a loss; a new line when it empties.",
  "progressions": { "l": { "kind": "labouchere", "line": [1, 2, 3, 4], "base": { "units": 1 }, "onEmpty": "reset", "track": "red" } },
  "stages": [ { "id": "play", "layout": [ { "bet": "red", "amount": { "prog": "l" } } ], "rules": [] } ] }
```

```json
{ "schema": 1, "id": "paroli-red", "name": "Paroli: red", "game": "roulette", "unit": 2500,
  "notes": "Reverse Martingale: double after a win, take the profit after three wins in a row, reset after a loss.",
  "progressions": { "p": { "kind": "paroli", "base": { "units": 1 }, "maxSteps": 3, "onCap": "reset", "track": "red" } },
  "stages": [ { "id": "play", "layout": [ { "bet": "red", "amount": { "prog": "p" } } ], "rules": [] } ] }
```

```json
{ "schema": 1, "id": "1-3-2-6-red", "name": "1-3-2-6: red", "game": "roulette", "unit": 2500,
  "notes": "1, 3, 2, 6 units on consecutive wins; back to 1 after a loss or after the fourth win.",
  "progressions": { "s": { "kind": "1-3-2-6", "base": { "units": 1 }, "track": "red" } },
  "stages": [ { "id": "play", "layout": [ { "bet": "red", "amount": { "prog": "s" } } ], "rules": [] } ] }
```

```json
{ "schema": 1, "id": "oscars-grind-red", "name": "Oscar's Grind: red", "game": "roulette", "unit": 2500,
  "notes": "Aim for +1 unit per cycle: raise by a unit after a win while the cycle is behind, never bet more than needed to finish it.",
  "progressions": { "o": { "kind": "oscars-grind", "base": { "units": 1 }, "track": "red" } },
  "stages": [ { "id": "play", "layout": [ { "bet": "red", "amount": { "prog": "o" } } ], "rules": [] } ] }
```

```json
{ "schema": 1, "id": "james-bond", "name": "James Bond", "game": "roulette", "unit": 2500,
  "notes": "20 units a spin: 14 on 19-36, 5 on the 13-18 six-line, 1 on zero ($350 / $125 / $25). Loses only on 1-12.",
  "stages": [ { "id": "flat", "layout": [
      { "bet": "high", "amount": { "units": 14 } },
      { "bet": "sixline:13-14-15-16-17-18", "amount": { "units": 5 } },
      { "bet": "straight:0", "amount": { "units": 1 } } ], "rules": [] } ] }
```

```json
{ "schema": 1, "id": "two-dozens-martingale", "name": "Two dozens, Martingale-style", "game": "roulette", "unit": 2500,
  "notes": "Same amount on the 1st and 2nd dozens; after a losing spin triple it (1, 3, 9, 27, 81 units), back to 1 after a win.",
  "progressions": { "d": { "kind": "sequence",
      "amounts": [ { "units": 1 }, { "units": 3 }, { "units": 9 }, { "units": 27 }, { "units": 81 } ],
      "onWin": "reset", "onLoss": "advance", "track": "round" } },
  "stages": [ { "id": "play", "layout": [
      { "bet": "dozen:1", "amount": { "prog": "d" } },
      { "bet": "dozen:2", "amount": { "prog": "d" } } ], "rules": [] } ] }
```

The §3.6 example, scaled to the $25 table (its literal $5 unit is below the $25 outside minimum
and every bet would be rejected; open question Q5):

```json
{ "schema": 1, "id": "red-mart-then-flat", "name": "Martingale on red, then flat", "game": "roulette", "unit": 2500,
  "notes": "PLAYBOOK §3.6 scaled ×5 for the $25 table: Martingale up to 6 steps; once up $500 flat-bet for 50 spins then stop; stop if down $1,500.",
  "progressions": { "m": { "kind": "martingale", "base": { "units": 1 }, "maxSteps": 6, "onCap": "reset", "track": "red" } },
  "stages": [
    { "id": "mart",
      "layout": [ { "bet": "red", "amount": { "prog": "m" } } ],
      "rules": [
        { "when": { "cmp": ["net", ">=", 50000] }, "then": [ { "goto": "flat" } ] },
        { "when": { "cmp": ["net", "<=", -150000] }, "then": [ { "stop": "stop-loss" } ] } ] },
    { "id": "flat",
      "layout": [ { "bet": "red", "amount": { "units": 1 } } ],
      "rules": [ { "when": { "cmp": ["roundsInStage", ">=", 50] }, "then": [ { "stop": "plan-complete" } ] } ] } ] }
```

The literal §3.6 JSON (unit 500, thresholds 10000/−30000) is kept as a golden fixture run under
`{ preset: 'european', limits: { outside: { min: 500 } } }`.

Steady-layout cost (european, from §6.4): flat red −$0.68/spin; James Bond −$13.51/spin; two
dozens at base −$1.35/spin; progressions vary with their step and are measured, not tabulated.

---

## 12. Table view and bet picker (phone first)

`src/game/roulette/ui/`: `TableView`, `BetPicker`, `OutcomeGlyph`, `Racetrack`, `layouts/*.ts`.
SVG for the felt (regions as data, like crappy's `TableLayout`), HTML for lists and controls.
Tap rule: every tappable region ≥ 44 CSS px on its short side at the reference viewports 390×844
and 844×390 (unit- and e2e-tested); at 360 px the table keeps the layout and the bet sheet (below)
provides the large targets.

### 12.1 Portrait layout (viewBox 0 0 360 672; at 390 px wide with 16 px gutters, scale 0.994)

```
 ┌────────┬────────┬──────────────────────────┐
 │        │        │            0             │  zero row (48): eu one cell; am 0 | 00; 3z 0 | 000 | 00
 │  1-18  │        ├────────┬────────┬────────┤
 │ (96)   │  1st   │   1    │   2    │   3    │  12 number rows × 48
 ├────────┤  12    ├────────┼────────┼────────┤  number cells 84 × 48
 │  EVEN  │ (192)  │   4    │   5    │   6    │
 ├────────┤        │  ...   │        │        │
 │  RED ◆ ├────────┤        │        │        │
 │  BLACK │  2nd   │        │        │        │
 │  ODD   │  12    │        │        │        │
 │ 19-36  │  3rd   │   34   │   35   │   36   │
 ├────────┴────────┼────────┼────────┼────────┤
 │                 │  2:1   │  2:1   │  2:1   │  column row (48)
 └─────────────────┴────────┴────────┴────────┘
   54        54        84       84       84
```

Even-money strip: six 54×96 boxes (`low even red black odd high`, top to bottom, as on a real
table), dozens: three 54×192 boxes. 672 units ≈ 668 px: header 48 + status 40 (bankroll, last
numbers) + table 668 + bottom bar 64 = 820 px ≤ 844.

Landscape / desktop (viewBox 0 0 700 280): zero column left, 12 columns × 3 rows of numbers, 2:1
column on the right, dozens row and even-money row below; 14 × 50-unit columns, 5 × 56-unit rows
(≈ 47 × 53 px at 844×390 with the 180 px right rail). The racetrack is drawn beside it on wide
screens (≥ 1024 px) and in a tab otherwise.

### 12.2 Bet picker (used by the strategy builder)

`BetPicker({ rules, value?: BetId, onPick(bet: BetId) })`. It returns ids only; amounts are the
builder's generic amount editor.

- **Outside:** tap a strip box or a 2:1 cell → that id.
- **Inside:** tap a number (or a zero) → a **bet sheet** (bottom sheet on phones, popover on
  desktop) listing every inside bet containing it, each a ≥ 48 px row with a mini-diagram of the
  covered cells, the canonical id and the payout: straight; splits up/down/left/right (and zero
  splits); street; trio/basket when applicable; corners; six-lines. Example for 17: `straight:17`,
  `split:14-17`, `split:16-17`, `split:17-18`, `split:17-20`, `street:16-17-18`,
  `corner:13-14-16-17`, `corner:14-15-17-18`, `corner:16-17-19-20`, `corner:17-18-20-21`,
  `sixline:13-…-18`, `sixline:16-…-21`.
- **Fine pointer** (`@media (pointer: fine)`): edges and intersections of number cells are also
  direct hot zones (12 units wide) for splits, corners, streets (outer edge) and six-lines, with
  hover highlighting of covered cells.
- **Call bets tab** (european only): four sector buttons (voisins, tiers, orphelins, jeu zéro) with
  their pocket counts, and **neighbours**: pick a number on the grid and `k` with a 1–9 stepper
  (default 2); the racetrack highlights the covered arc. On phones the racetrack is display-only
  (37 cells round an oval cannot be 44 px at 358 px); on desktop its cells and sectors are tappable.
- **Type an id:** a text field accepting any id or alias (`17-20`, `voisins`), parsed live with
  the canonical id echoed, so power users never need the diagram.
- Unavailable bets on the current wheel are not offered; ids already in the definition from another
  wheel show as invalid with the validator's message.

### 12.3 Watch mode

`TableView({ rules, layout, prison, lastOutcome, highlight })` read-only: chip stacks with amount
badges on their spots (call bets show the expanded chips plus a label chip "voisins $36"), an
imprisoned bet drawn on the line of its box with a "prison" badge, the winning pocket marked with a
dolly, covered pockets of the bet the trace row is hovering highlighted. A history strip of the last
20 pockets uses `OutcomeGlyph` (disc with the number; colour plus a text cue: red discs have a
notch / `aria-label="17 black"`, so meaning never depends on colour alone). Reduced motion: no
wheel animation; otherwise a 300 ms dolly drop at most. Every region is a `<g role="button">` with
`aria-label` "Split 17 and 20, pays 17 to 1".

---

## 13. Test plan

Unit tests live next to the code (`src/game/roulette/*.test.ts`, Vitest node project).

1. **Exhaustive oracle** (`oracle.test.ts` with `tests/oracle.ts` written from the plain-English
   rules, importing nothing from `bets.ts`/`netvector.ts`): every catalog id (all 157/161/160 fixed
   ids, the 4 call bets and all 333 neighbours) × every pocket × each wheel × flag set {none,
   laPartage, enPrison(lose), enPrison(reimprison)} (flags on european only), at amounts {unit,
   7×unit, max} → expected profit and result equal the engine's settlement. ≈ 40k assertions,
   `it.each` tables.
2. **Catalog**: counts per family per wheel (§3.1); every id round-trips `parse(id) === id`; every
   alias in §3.2 maps as listed; 200 random non-ids parse to `null`; coverage sets match §2/§3.3;
   sector partition and arcs; wheel colour alternation.
3. **Exact EV** (`ev.test.ts`): every row of §6.1–§6.4 as exact fractions (pinned strings like
   `'46656/1369'`); closed form vs brute force; `layoutMoments` vs `netVector` mean/variance on
   1,000 random layouts (seeded) within 1e−9 relative; float path vs BigInt fallback agree.
4. **Rounding**: every payout integer; la partage on $25 = −$12.50 exactly; refund floor never
   fires on legal amounts (property); call-bet pieces integral.
5. **Engine flows** (forced pockets): straight hit; la partage on 0; en prison 0 → red (released),
   0 → black (lost), 0 → 0 (both variants), en prison with a new red bet in the prison round;
   prison-only round still spins; `apply` codes one test each; `confirm` gating; money
   conservation every round; `playRound` precondition throws.
6. **RNG**: golden pocket sequence for seed 42 on each wheel (pinned after the first
   implementation); one draw per round with and without bets (the pocket sequence is identical for
   an empty strategy and a busy one); rejection limits; chi-square over 370,000 spins per wheel
   (fixed seed, p > 0.001).
7. **Reconcile**: §8.1 examples pinned; property test over 10,000 random desired layouts × random
   bankrolls × all wheels × both policies: zero `apply` rejections, amounts ≤ requested, multiples
   of the unit, all limits hold after `confirm`, idempotence.
8. **Facts**: `spinsSince`, `streak`, `count`, `hits`, `colorStreak` against naive recomputation
   from the full pocket history over 5,000 random spins and 50 random targets, including wrap of
   the 1024 ring and `n = 1000`.
9. **Monte-Carlo** (`mc.test.ts`, fixed seeds, in CI): per family per wheel, 200,000 one-unit bets
   (1,000,000 with `MC_FULL=1`): `|mean − EV| < 4σ/√n` with σ from §6; la partage and en prison
   lifetime edges via the engine (en prison accounting summed across rounds). Presets: each preset
   × 2,000 sessions × 500 spins through the real harness: realized net vs Σ `expectedLossPerRound`
   within 3 SE using Σ `variancePerRound` (PLAYBOOK §12).
10. **Presets**: every file validates against the strategy schema and the european rules with zero
    validator errors; runs with zero reconcile rejections at bankroll $10,000 (except documented
    `unaffordable` at bust); golden trace for seed 1 pinned.
11. **UI** (happy-dom): layout tap-size test at both reference viewports; picker returns canonical
    ids for each region; bet sheet lists exactly the bets containing the number (vs catalog);
    axe on TableView and BetPicker; e2e covers pick → define → watch.

---

## 14. Proposed TypeScript (`src/game/roulette/`)

```ts
// types.ts
import type { Cents, BetId, LayoutEntry, RoundOutcome, GameEvent } from '@core/contracts/game';
import type { RngState } from '@core/rng';

export type WheelKind = 'european' | 'american' | 'triple-zero';
export type PocketIndex = number;                                   // 0..36, 37 = '00', 38 = '000'
export type PocketLabel = '0' | '00' | '000' | `${number}`;
export type Color = 'red' | 'black' | 'green';
export type Family =
  | 'straight' | 'split' | 'street' | 'trio' | 'corner' | 'basket' | 'sixline'
  | 'even-money' | 'dozen' | 'column' | 'call' | 'neighbours';
export type LimitClass = 'inside' | 'outside' | 'call';
export type InsideSpot = 'straight' | 'split' | 'street' | 'trio' | 'corner' | 'basket' | 'sixline';

export interface TableLimits {
  chipUnit: Cents;
  outside: { min: Cents; max: Cents };
  inside: { minChip: Cents; minTotal: Cents; max: Record<InsideSpot, Cents> };
  maxTotalPerSpin: Cents | null;
}
export interface RouletteRules {
  preset: WheelKind;
  wheel: WheelKind;
  laPartage: boolean;
  enPrison: boolean;
  enPrisonSecondZero: 'lose' | 'reimprison';
  limits: TableLimits;
  reconcile: { overMax: 'clamp' | 'reject'; shortfall: 'reduce' | 'reject' };
  pace: { roundsPerHour: number; label: 'live' | 'electronic' | 'custom' };
}

export interface WheelSpec {
  kind: WheelKind;
  n: 37 | 38 | 39;
  labels: readonly PocketLabel[];        // by PocketIndex
  order: readonly PocketIndex[];         // clockwise from 0 (empty for triple-zero until sourced)
  color: Uint8Array;                     // 0 green, 1 red, 2 black, by PocketIndex
}

export interface BetDef {               // resolved per wheel; frozen
  id: BetId; family: Family; limitClass: LimitClass;
  pockets: readonly PocketIndex[];       // covered pockets (call bets: union)
  pays: number;                          // X to 1 (call bets: 0, see components)
  components?: readonly { spot: BetId; weight: number }[];   // call bets
  pieces: number;                        // 1, or Σ weight for call bets
  evenMoney: boolean;                    // la partage / en prison apply
}

export interface SpotChip { spot: BetId; amount: Cents; }
export interface PlacedBet { bet: BetId; amount: Cents; chips: readonly SpotChip[]; }

export interface SpinHistory {
  ring: Uint8Array;                      // last 1024 pocket indices
  len: number;                           // spins recorded (may exceed ring length)
  targets: TargetCounters[];             // registered at compile time
}
export interface TargetCounters {
  target: string; mask: Uint8Array; lastHit: number; streak: number; hits: number;
  windows: { n: number; count: number }[];
}

export interface RouletteState {
  rules: RouletteRules; wheel: WheelSpec; rng: RngState; forced: PocketIndex[];
  bankroll: Cents; layout: PlacedBet[]; prison: PlacedBet[]; confirmed: boolean;
  round: number; history: SpinHistory;
}

export type RouletteAction =
  | { type: 'place'; bet: BetId; amount: Cents }
  | { type: 'remove'; bet: BetId }
  | { type: 'confirm' };

export type ApplyCode =
  | 'unknown-bet' | 'not-on-wheel' | 'not-placeable' | 'after-confirm' | 'bad-amount'
  | 'below-min' | 'over-max' | 'unaffordable' | 'inside-min-total' | 'table-max' | 'not-placed';

export type ReconcileCode =
  | 'unknown-bet' | 'not-on-wheel' | 'not-placeable' | 'invalid-amount' | 'below-min'
  | 'over-max' | 'unaffordable' | 'inside-min-total' | 'table-max';
export type AdjustCode = 'merged' | 'rounded' | 'clamped' | 'reduced' | 'skipped-zero';
export interface Adjustment { entry: LayoutEntry; to: Cents; reason: AdjustCode; }

export type RouletteEventName =
  | 'spin' | 'zero' | 'bet-won' | 'bet-lost' | 'bet-push'
  | 'partage' | 'imprisoned' | 'released' | 'prison-lost';
export interface RouletteEvent extends GameEvent { type: RouletteEventName; bet?: BetId; }

export interface SpinSummary {
  pocket: PocketLabel; index: PocketIndex; color: Color;
  parity: 'odd' | 'even' | 'zero'; half: 'low' | 'high' | 'zero';
  dozen: 0 | 1 | 2 | 3; column: 0 | 1 | 2 | 3;
  sector: 'voisins' | 'tiers' | 'orphelins' | null;
}
export interface RouletteOutcome extends RoundOutcome { summary: SpinSummary & Record<string, string | number | boolean | null>; }

// Module surface (each a separate file; index.ts assembles the GamePlugin):
export declare function resolveRules(p?: string | Partial<RouletteRules>): RouletteRules;     // rules.ts
export declare function wheelSpec(kind: WheelKind): WheelSpec;                                // pockets.ts
export declare function parseBet(id: string): BetId | null;                                  // bets.ts
export declare function betDef(id: BetId, wheel: WheelKind): BetDef | null;                  // bets.ts
export declare function catalog(rules: RouletteRules): readonly BetDef[];                    // bets.ts
export declare function createState(rules: RouletteRules, seed: number, bankroll: Cents,
  opts?: { forcedPockets?: PocketLabel[] }): RouletteState;                                  // engine.ts
export declare function apply(s: RouletteState, a: RouletteAction):
  { ok: true; state: RouletteState; events: RouletteEvent[] } | { ok: false; code: ApplyCode; message: string };
export declare function playRound(s: RouletteState): { state: RouletteState; outcome: RouletteOutcome };
export declare function netVector(s: RouletteState, out: Float64Array): void;               // netvector.ts
export declare function reconcile(s: RouletteState, desired: readonly LayoutEntry[]): {
  actions: RouletteAction[]; deferred: never[]; affordable: boolean;
  rejected: { entry: LayoutEntry; reason: ReconcileCode }[]; adjusted: Adjustment[];
};                                                                                           // reconcile.ts
export declare function registerTarget(s: RouletteState, target: string, windows?: number[]): number; // facts.ts
```

### Contract notes for the orchestrator (proposed changes to `src/core/contracts/game.ts`)

- **C1** `createState(rules, seed, bankroll, opts?)`: the draft has no bankroll.
- **C2** `Reconciliation.adjusted: { entry, to, reason }[]`: clamped/reduced/rounded amounts must be
  visible in the trace (PLAYBOOK §14 "never silently dropped"), and they are not rejections.
- **C3** `expectedLossPerRound` returns a **positive** number for a losing layout (−EV), in cents.
- **C4** `facts` needs a compile-time hook so parameterised facts cost nothing unless used:
  strategy.md's `CompileContext.compileFact(ref, rules)` is that hook; the roulette implementation
  calls `registerTarget` for `spinsSince:*`, `streak:*`, `count:*:*`, `hits:*` and returns an
  accessor over the counters. Its `HistoryPredicate` forms over `lastColor` etc. map to the same
  counters (§9.2).
- **C5** `apply`/`playRound` may mutate and return the same state (perf, §7.1).
- **C6** `parse(id)` returns the canonical id (aliases folded), wheel-independent; availability is
  `available(id, state)`.

---

## Open questions (proceeding on the recommended pick)

1. **Q1 Bets above the table max** (e.g. a Martingale past $5,000). (a) **clamp to the max and
   record an adjustment** (recommended: the strategy keeps running and the trace shows it);
   (b) reject the bet that round; (c) end the session with `strategy:table-max`.
2. **Q2 Can't afford the full bet.** (a) **bet what is left if it meets the minimum, else bust**
   (recommended: matches §5.6 "cannot fund the smallest desired bet"); (b) reject → bust as soon as
   any desired bet is unaffordable.
3. **Q3 En prison, zero on the imprisoned spin.** (a) **the bet is lost (edge 1.39%)**
   (recommended: the common rule); (b) re-imprisoned (edge 1.35%, equal to la partage). Both are
   implemented; this picks the default.
4. **Q4 Imprisoned bet when the session ends.** (a) **counted at face value in final equity**
   (recommended, simplest, bias ≤ half a stake in 1 of 37 sessions that end on a zero);
   (b) surrendered for half (la partage equivalent, needs a `closeOut` hook in the contract);
   (c) played out with extra spins.
5. **Q5 The §3.6 example at a $25 table.** (a) **ship it scaled ×5 ($25 unit, +$500 / −$1,500)**
   and keep the literal one as a fixture under a $5-minimum override (recommended); (b) ship it
   literally with a low-limit rules override in the preset.
6. **Q6 Triple-zero layout** (unverified: zero row `0 | 000 | 00`, top line 0-00-000-1-2-3 at 5:1).
   (a) **as designed** (recommended; edge is −1/13 like every other bet, so only geometry is at
   stake); (b) omit the triple-zero basket and zero splits beyond `0-1`, `000-2`, `00-3`.
7. **Q7 Is $5,000 also a cap on the total per spin?** (a) **no, it is the per-bet outside max**
   (`maxTotalPerSpin: null`, recommended per decisions #3's wording); (b) $5,000 total outside per
   spin; (c) $5,000 total of all bets per spin.
