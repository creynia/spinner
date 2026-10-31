// Chapter prose for the Research screen (docs/research/app-plan.md §2-§3). The same text, with the
// tables, is in docs/research/report.md. Every number was re-read from docs/research/results/*.json
// (European wheel, $5,000 bankroll, 500 spins, 10,000 sessions, seed 20261031 unless the text says
// otherwise). dataKeys are "<results file>:<experiment id>", the rows a chapter's chart draws; the
// curve chapter's scatter also uses data.json `curve` (from docs/research/briefs/E5.md).
export interface Chapter {
  id: string;
  title: string;
  lead: string;
  body: string[];
  takeaways: string[];
  math: { text: string[]; formulas: string[] };
  dataKeys: string[];
}

const seeds = (file: string, id: string, list: string[]): string[] =>
  list.map((s) => `${file}:${id}@${s}`);

const SURVIVORS = ['b3-two-streets-l29', 'c9-streets-to12-stack', 'a1-streets-w27'];

export const CHAPTERS: readonly Chapter[] = [
  {
    id: 'start',
    title: 'Start here',
    lead: 'You cannot change what roulette costs you, but you can choose what a typical session looks like, and a cash-out is what locks it in.',
    body: [
      'Three things hold for every strategy in this report. The edge never changes: every dollar you bet costs 2.7 cents on average, no matter how you bet it. You can change the shape of your results: a ladder that raises the bet after a loss turns most sessions into small wins and a few into big losses. And a cash-out locks the typical session in: you stop the moment you are up a set amount.',
      'The table puts $25 flat on red beside the c9 ladder with a cash-out, both from $5,000 for up to 500 spins. The typical session moves from −$350 to +$286. The worst sessions get worse.',
    ],
    takeaways: [
      'The typical session moves from −$350 to +$286, and 90.3 % of sessions end ahead instead of 25.5 %.',
      'The average stays negative (−$46.25), because the edge does not move.',
      'The worst 5 % of sessions lose more: about −$3,210 against −$1,480 for flat red.',
    ],
    math: {
      text: [
        'The expected value of a session is fixed by the wheel: −1/37 = −2.70 % of the total wagered on the single-zero wheel. A strategy changes the expected turnover and the shape of the distribution of net results, never the edge.',
        'The median (the typical session) is the 50 % quantile of net. It can sit above zero while the mean is negative when the distribution is skewed: many small wins, a few large losses. CVaR 5 % (the worst 5 %) is the mean of the worst 5 % of sessions.',
        'Flat red wagers $12,500: predicted mean −$337.84, measured −$338.21. The c9 cash-out wagers $1,961.68 on average: predicted −$53.02, measured −$46.25 (realized edge −2.36 %, sampling noise; the other three seeds give −$53.65 to −$60.90). Its median is $286 and its CVaR 5 % −$3,210.',
      ],
      formulas: [
        'EV(session) = −(1/37) × E[wagered] ≈ −0.0270 × E[wagered]',
        'flat red: −0.0270 × $12,500 = −$337.84',
        'c9 cash-out: −0.0270 × $1,961.68 = −$53.02',
      ],
    },
    dataKeys: ['observations:flat-red', 'e7-c9:e7-c9-W20-SLhalf'],
  },
  {
    id: 'edge',
    title: 'Every dollar costs the same',
    lead: 'Every dollar you bet costs 2.7 cents on average, no matter how you bet it: spreading $25 across the table only changes how far a session swings.',
    body: [
      'Three players bet $25 a spin for 500 spins from $5,000. One puts it all on red, one puts $12 on red and $13 on the third dozen, one puts $1 on each of 25 single numbers. On average all three lose the same: −$338.21, −$336.64 and −$337.98, where the wheel predicts −$337.84.',
      'What changes is how far a session swings. The typical swing shrinks from $557 to $490 to $375 as the bet covers more numbers, and the worst 5 % of sessions improve from −$1,480 to −$1,129. Smaller swings cut both ways: the chance of ending ahead falls from 25.5 % to 17.5 %.',
    ],
    takeaways: [
      'Same average loss whatever the spread: about $338 per 500 spins at $25 a spin.',
      'Covering more numbers narrows the swings: the worst sessions are milder and the winning ones rarer.',
      'Spreading is a comfort choice, not an edge.',
    ],
    math: {
      text: [
        'Covering c numbers with $1 wins with probability c/37 and returns 36/c dollars on a hit, so the expectation per dollar is (c/37)(36/c) − 1 = −1/37 for every c. Spread changes only the variance per dollar, 36²/(37c) − (36/37)²: 1.00 for red (c = 18) and 0.45 for 25 straight-ups.',
        'Over n independent spins the session standard deviation is √n times the per-spin one. At $25 and n = 500: red $559 predicted, $557 measured; red + dozen $493 predicted, $490 measured; 25 straight-ups $377 predicted, $375 measured. Realized edge −2.71 %, −2.69 %, −2.70 %. CVaR 5 %: −$1,480, −$1,355, −$1,129. Medians: −$350, −$338, −$332.',
      ],
      formulas: [
        'EV per $1 = (c/37) × (36/c) − 1 = −1/37 ≈ −0.0270',
        'mean(500 spins at $25) = −$12,500 / 37 = −$337.84',
        'SD(session) = $25 × √500 × √(36²/(37c) − (36/37)²)',
      ],
    },
    dataKeys: ['e1-spread:e1-red', 'e1-spread:e1-red12-dozen3-13', 'e1-spread:e1-straights25'],
  },
  {
    id: 'martingale',
    title: 'Why doubling feels like it works',
    lead: 'Doubling after each loss keeps the typical session ahead for a few hundred spins, until one long losing streak empties the ladder and the typical session falls to a loss.',
    body: [
      'Martingale on red starts at $25 and doubles after each loss, up to $3,200: eight bets. Every win ends a cycle $25 up, and the ladder is lost only when red misses eight times running, about once in 207 cycles. So most sessions climb: the typical session is up $2,100 at spin 220.',
      'Every session keeps facing that streak, though. Once more than half have hit it, the typical session drops: +$475 at spin 290, −$2,400 at spin 300, −$5,000 at spin 500, with 51.2 % of sessions bust. Fibonacci grows more slowly and is still ahead at spin 500 (+$1,675), yet its average is worse than flat betting (−$783.73) because it bets $30,397 a session.',
    ],
    takeaways: [
      'The rising typical session is real, and it has a deadline: about 290 spins for Martingale on red at $25.',
      'The fall is sudden because a losing session loses the whole ladder at once.',
      'A strategy that bets more loses more on average: Fibonacci bets 2.4 times what flat betting does.',
    ],
    math: {
      text: [
        'A recovery ladder plays in cycles. With a per-spin win probability p and L levels, a cycle caps with probability q = (1 − p)^L. Wins arrive at rate p per spin, so after n spins the chance of no cap is about e^(−q·p·n). The median path is above zero while that exceeds ½, which gives the median horizon n½ = ln 2 / (q·p).',
        'Martingale on red: p = 18/37 = 0.486, L = 8, q = (19/37)^8 = 0.0048, n½ ≈ 295 spins. Measured: the median is above zero through spin 290 (the path is sampled every 10 spins) and peaks at $2,100 at spin 220. Mean −$898.24 against an EV of −0.027 × $35,056 = −$947 (realized edge −2.56 %); CVaR 5 % −$5,000. Fibonacci: median $1,675, mean −$783.73, bust 39.1 %. The skew is the trade: median and mean point in opposite directions.',
      ],
      formulas: [
        'q = (1 − p)^L = (19/37)^8 = 0.0048',
        'P(no cap by spin n) ≈ e^(−q·p·n)',
        'n½ = ln 2 / (q·p) = 0.693 / (0.0048 × 0.486) ≈ 295',
      ],
    },
    dataKeys: [
      'observations:flat-red',
      'observations:martingale-red',
      'observations:fibonacci-red',
    ],
  },
  {
    id: 'levels',
    title: 'Levels, not luck',
    lead: 'To keep a doubling ladder ahead for longer, give it more steps with a smaller base stake; a bigger bankroll on the same steps does not keep it ahead any longer.',
    body: [
      'Each extra step makes losing the whole ladder about half as likely, so it roughly doubles how long the typical session stays ahead. With a $5 base and a bankroll of exactly one ladder, 5 steps hold to spin 39, 6 to 70, 7 to 150 and 8 to 290; 9 and 10 steps last past spin 500. Ten steps at $5 from $5,000 end with a typical session of +$1,185.',
      'Doubling the bankroll to $10,000 with the same 8 steps at $25 leaves the turn at spin 290. The extra money lets sessions survive one lost ladder, but the worst 5 % now lose $10,000 and the average gets worse.',
    ],
    takeaways: [
      'Count your bankroll in base stakes: that number, not the dollars, sets how long the typical session stays ahead.',
      'A smaller base stake under the same table maximum buys more steps.',
      'The average loss grows with every step: −$63.25 at 5 steps, −$327.56 at 10.',
    ],
    math: {
      text: [
        'Each level multiplies q by 1 − p = 19/37 ≈ 0.51, so n½ = ln 2 / (q·p) roughly doubles per level. With a $5 unit and bankroll 2^L − 1 units: L5 q 0.0357, n½ 40; L6 0.0183, 78; L7 0.0094, 151; L8 0.0048, 295; L9 0.0025, 574; L10 0.0013, 1,117. Measured medianAheadUntil: 39, 70, 150, 290, 500 and 500 (censored at the session end), each inside its 10-spin checkpoint.',
        'The bankroll enters only through L, the number of levels that fit under the table maximum and the bankroll. A $10,000 bankroll at $25 still fits 8 doublings under the $5,000 maximum bet, so q and n½ are unchanged (measured 290), while a bust costs twice as much: median −$375, mean −$1,265.78, CVaR 5 % −$10,000, bust 22.2 %. Mean loss grows with L because turnover does: −$63.25 (L5) to −$327.56 (L10).',
      ],
      formulas: [
        'q = (19/37)^L',
        'n½ = ln 2 / (q × 18/37)',
        'L = largest integer with u × (2^L − 1) ≤ bankroll and u × 2^(L−1) ≤ table max',
      ],
    },
    dataKeys: [
      'e3a-levels:e3a-L5',
      'e3a-levels:e3a-L6',
      'e3a-levels:e3a-L7',
      'e3a-levels:e3a-L8',
      'e3a-levels:e3a-L9',
      'e3a-levels:e3a-L10',
      'observations:martingale-red',
      'observations:martingale-red-br10k',
      'observations:martingale-red-unit5-L10',
    ],
  },
  {
    id: 'placement',
    title: 'Beyond red: grow at the right rate',
    lead: 'Off even money, doubling is the wrong raise: multiply each bet by 36 ÷ (36 − numbers covered), which is ×1.5 on a dozen, and the ladder lasts as long as the formula says.',
    body: [
      '“Only even money works” is about the size of the raise, not the numbers. A dozen pays 2 to 1, so doubling after a loss wins back more than needed and uses up the ladder in 7 bets: the typical session is ahead only until spin 70. Raising by half instead (×1.5) fits 11 bets and holds until spin 150, as the formula predicts. Two dozens, six-lines, corners and runs of single numbers behave the same way.',
      'But at $25 a spin from $5,000 no placement stays ahead to spin 500. A $5 base on a dozen (15 bets) does: typical +$1,611, average −$345.44, 16.4 % bust.',
    ],
    takeaways: [
      'Use the right raise for the bet: ×2 for 18 numbers, ×1.5 for 12, ×3 for 24, ×1.2 for 6.',
      'With the right raise every placement reaches its predicted horizon; with doubling, the dozen, six-line and corner collapse within 70 spins.',
      'Even with the right raise, base stakes decide: the dozen needed a $5 base to stay ahead for 500 spins.',
    ],
    math: {
      text: [
        'A layout covering c numbers pays m = (36 − c)/c. To recover the deficit D plus the level-0 profit τ, the next stake s must satisfy s·m ≥ D + τ. Each lost stake adds to D, so s(k+1) = s(k)·(1 + 1/m) = g·s(k) with g = 36/(36 − c). The table and the bankroll set the levels: L ≈ ln(max/min) / ln g.',
        'Dozen (c = 12, p = 0.324): doubling fits L = 7, q = (25/37)^7 = 0.0643, n½ = 33; measured median ahead until 70 (a flat, noisy crossing). g = 1.5 fits L = 11, q = 0.0134, n½ = 159; the onCap-stop twin is ahead until 150. At equal bankroll the horizon ranks by B/(m·p), so wider coverage holds longer: predicted n½ 286 (25 straight-ups), 200 (two dozens), 159 (dozen), 147 (six-line), 141 (corner); measured 280, 200, 150, 140, 130. The $5-base dozen: L = 15, q = 0.0028, n½ = 765, median $1,611, mean −$345.44, CVaR 5 % −$5,000.',
      ],
      formulas: [
        'g = 36 / (36 − c)',
        's(k+1) = g × s(k)',
        'q = (1 − c/37)^L',
        'n½ = ln 2 / (q × c/37)',
      ],
    },
    dataKeys: [
      'e4-dozen:e4-dozen-g',
      'e4-dozen:e4-dozen-g-stop',
      'e4-dozen:e4-dozen-x2',
      'e4-dozen:e4-dozen-g-u5',
      'e4-dozen:e4-dozen-x2-u5',
      'e4-two-dozens:e4-two-dozens-g',
      'e4-two-dozens:e4-two-dozens-g-stop',
      'e4-two-dozens:e4-two-dozens-x2',
      'e4-sixline:e4-sixline-g',
      'e4-sixline:e4-sixline-g-stop',
      'e4-sixline:e4-sixline-x2',
      'e4-corner:e4-corner-g',
      'e4-corner:e4-corner-g-stop',
      'e4-corner:e4-corner-x2',
      'e4-straights25:e4-straights25-g',
      'e4-straights25:e4-straights25-g-stop',
      'e4-straights25:e4-straights25-x2',
      'e4-straights35:e4-straights35-g',
      'e4-straights35:e4-straights35-g-stop',
      'e4-straights35:e4-straights35-x2',
    ],
  },
  {
    id: 'curve',
    title: 'One curve rules them all',
    lead: 'Your chance of finishing a session without losing the ladder depends on how many cycle profits your bankroll can absorb, not on which numbers you cover.',
    body: [
      'We put 53 ladders on one chart: Martingale on red, right-raise ladders on dozens, six-lines, corners and single numbers, and the widening and stacking ladders of the next chapter. Across: how many winning cycles a session plays, divided by how many cycle profits the bankroll can pay back. Up: the share of sessions that never lost the ladder.',
      'Every ladder sits on or under one ceiling curve, and none beats it. Ladders with the same bankroll counted in profits tie, whatever the board. Where layout matters at all the effect is small, and covering more numbers or widening is slightly worse: the best layout beats red-style ladders by 3.3 points.',
    ],
    takeaways: [
      'No arrangement of numbers beats the ceiling: the shape of the bet is not the lever.',
      'The lever is bankroll counted in cycle profits: a smaller base stake or a bigger committed bankroll.',
      'Narrow stacks sit closest to the ceiling; wide coverage and widening sit lower.',
    ],
    math: {
      text: [
        'Let B be the cap loss divided by the mean cycle profit τ̄ (bankroll in cycle profits) and x = p·S/B, the expected cycles in S spins per unit of B. H3 says P(no cap) ≈ e^(−x). The sharper form is P(no cap) = e^(−k·x) with k = q·B/(1 − q) = 1 + 0.027 × (turnover per cycle) / (τ̄(1 − q)) ≥ 1, so e^(−x) is a ceiling.',
        'Over 53 ladders the mean residual against e^(−x) is −6.0 points and none is above it; e^(−k·x) predicts to 0.8 points RMS. k runs from 1.14 (one street stacked) through 1.27 (Martingale red) and 1.37 (two dozens) to 1.58 (widening to 33 numbers) and 3.79 (35 straight-ups). The median horizon is S½ = ln 2 × B / (k·p), and the median is positive exactly when e^(−k·x) > ½, which held on all 65 recovering rows. Every positive median sits beside a negative mean.',
      ],
      formulas: [
        'x = p × S / B',
        'P(no cap) = e^(−k·x) ≤ e^(−x),  k = q·B / (1 − q) ≥ 1',
        'c9: x = 0.223 × 500 / 338.8 = 0.33, k = 1.21, e^(−0.40) = 0.672 (measured 0.672)',
      ],
    },
    dataKeys: [
      'e3a-levels:e3a-L9',
      'e4-dozen:e4-dozen-g-u5-stop',
      'e4-straights35:e4-straights35-g-stop',
      'e6-stack-screen:b3-two-streets-l29',
      'e6-stack-screen:b4-sixline-l29',
      'e6-widen-screen:a7-dozens-sixline-street-w33',
      ...seeds('e6-full', 'b1-street-l53', ['20261031', '1', '2']),
      ...SURVIVORS.flatMap((id) => seeds('e6-full', id, ['20261031', '1', '2'])),
    ],
  },
  {
    id: 'shapes',
    title: 'Towers, shapes and favourite numbers',
    lead: 'If you would rather play shapes, towers or favourite numbers, stack chips on a few streets and size the ladder to your bankroll: that stays ahead for 500 spins as well as anything we tested.',
    body: [
      'Three ladders passed every test. a1 widens: $1 on street 1-2-3, then one more street after each loss, up to nine streets (27 numbers) at $288 each. b3 stacks: two streets, 1-2-3 and 16-17-18, with a tower growing from $2 to $383 on each over 29 steps. c9 does both: one street, then two, three and four (1 to 12), then stacks those four from $3 to $411 each over 16 steps.',
      'All three start from $5,000, need $1 table minimums and stop when the ladder is lost. Over four seeds the typical session ends up about $1,500 to $1,700, the average is always negative, and a third to nearly half of sessions lose the ladder.',
    ],
    takeaways: [
      'Stacking a narrow shape works as well as anything tested: b3’s typical session is +$1,679 to +$1,698.',
      'Widening across the board is the weakest of the three: a1 ends ahead least often (54.6 % to 55.3 %), though its worst 5 % is the mildest.',
      'A lost ladder costs $3,444 (a1), $4,574 (b3) or $4,919 (c9) in one go.',
    ],
    math: {
      text: [
        'The deficit recursion generalises to mixed layouts: after a loss at level k with deficit D(k), the stake at the next level must make the smallest-paying covered bet return at least D(k) + τ. A street pays 11 to 1, so with n streets at $a a hit nets 12a − n·a − D. a1 level 3: D = $11, four streets need 8a − 11 ≥ 11, so a = $3.',
        'Widening raises the per-spin win chance (27 numbers at the top: p = 0.730) but puts most of the risk on the last level: $2,592 of a1’s $3,444 cap loss. Survivor parameters (q, B in cycle profits, k): b3 0.00591, 196.7, 1.17; c9 0.00356, 338.8, 1.21; a1 0.00494, 258.1, 1.28. Predicted P(no cap at 500) = e^(−k·x): 0.617, 0.672, 0.547; measured over three seeds 0.622, 0.672, 0.551. Medians across four seeds move by at most $19 (b3), $5 (c9) and $6.50 (a1); every mean is negative.',
      ],
      formulas: [
        'n streets at $a: 12a − n·a − D(k) ≥ τ',
        'P(no cap) = e^(−k·p·S/B)',
        'b3: e^(−1.17 × 0.162 × 500 / 196.7) ≈ 0.617',
      ],
    },
    dataKeys: [
      ...SURVIVORS.flatMap((id) => [
        ...seeds('e6-full', id, ['20261031', '1', '2']),
        `e8-seed3:${id}@3`,
      ]),
      ...seeds('e6-full', 'flat-red', ['20261031', '1', '2']),
      'e8-seed3:flat-red@3',
    ],
  },
  {
    id: 'cashout',
    title: 'Cash out: the stop that moves the typical session',
    lead: 'Decide before you sit down how much profit you will walk away with: a modest target is reached most of the time, and a stop-loss at half the ladder limits the damage when it is not.',
    body: [
      'A cash-out ends the session the moment you are up the target, so the typical session is the target, a few dollars over. The lower the target, the more often you reach it before losing the ladder: c9 reaches $70 in 98.2 % of sessions, $280 in 93.2 % and $1,400 in 70.4 %.',
      'A stop-loss at half the ladder ($2,459.50) costs three points of that chance (90.3 %) but cuts the worst 5 % from −$4,820 to −$3,210. Its sibling c8 with a $200 target and no stop-loss gets there more often (94.5 %) but keeps a worst 5 % of −$4,515. On Martingale red a half-ladder stop-loss never fires; stopping after seven losses does.',
    ],
    takeaways: [
      'The typical session equals your target as long as more than half of sessions reach it.',
      'Higher targets are reached less often, and the average loss grows with the time you play.',
      'Pair the cash-out with a stop-loss sized to the ladder, not to the bankroll.',
    ],
    math: {
      text: [
        'With a stop-win of W cycle profits a session ends ahead if it collects W cycles before a cap: P(win) ≈ (1 − q)^W ≈ e^(−q·W). c9, q = 0.00356: W = 5, 10, 20, 50, 100 predicts 0.982, 0.965, 0.931, 0.837, 0.700; measured 0.982, 0.965, 0.932, 0.839, 0.704. The median equals the target while P(win) > ½, that is while q·W < ln 2. The mean stays at −2.70 % of a smaller turnover: c9 at W20 wagers $2,157, mean −$56.21.',
        'The half-ladder stop-loss is checked after the round, so it overshoots by one level: CVaR 5 % −$3,210, worst session −$3,275. Martingale red at W20: e^(−q·W) predicts 0.908, measured 0.888, because after seven losses (−$3,175) the eighth $3,200 bet does not fit the remaining $1,825 and is cut. A 7-loss stop (maxSteps 7, onCap stop): q = (19/37)^7 = 0.0094, (1 − q)^20 = 0.828, measured 0.830, CVaR 5 % −$3,119, bust 0.',
      ],
      formulas: [
        'P(win) ≈ (1 − q)^W',
        'c9 at W = 20: (1 − 0.00356)^20 = 0.931',
        'median = target while q·W < ln 2',
      ],
    },
    dataKeys: [
      'e7-c9:e7-c9-W5',
      'e7-c9:e7-c9-W10',
      'e7-c9:e7-c9-W20',
      'e7-c9:e7-c9-W50',
      'e7-c9:e7-c9-W100',
      'e7-c9:e7-c9-nostop',
      'e7-c9:e7-c9-W20-SLhalf',
      ...seeds('e6-full', 'd-c8-stopwin20', ['20261031', '1', '2']),
      'e7-mart:e7m-reset-W20',
      'e7-mart:e7m-reset-W20-SLhalf',
      'e7b-mart-L7stop:e7b-L7stop-W20',
    ],
  },
  {
    id: 'limits',
    title: 'What breaks it',
    lead: 'The gain survives other seeds and a bigger bankroll, but long sessions, $25 table minimums and, for wide layouts, the double-zero wheel break the ladders; only the cash-out version shrugs off length and the wheel.',
    body: [
      'We re-ran the survivors under each change. Other seeds moved the typical session by at most $19. A $10,000 bankroll and the la partage rule changed nothing. The American wheel’s extra zero costs 3 to 8 points of chance of ending ahead; b3 and c9 stay ahead, the widening a1 drops to −$1,978. At 1,000 spins every ladder without a cash-out ends negative.',
      'The c9 cash-out shrugs most of this off: every session stops by spin 250, so length does not touch it, and on the American wheel it keeps +$286 and 88.7 %. At $25 table minimums nothing works: comparable ladders lost the ladder in 90 % to 100 % of sessions. Every average is negative.',
    ],
    takeaways: [
      'Plan the length: without a cash-out these ladders are built for about 500 spins.',
      'Play on $1 minimums and a single-zero wheel; the double zero hurts wide layouts most.',
      'Widening needs a shorter ladder, not a stop-loss: dropping a1’s last level with a $226 cash-out cuts the worst 5 % from −$3,380 to −$841, for 19 points of chance (91.7 % → 72.4 %).',
    ],
    math: {
      text: [
        'American wheel: p(k) = c(k)/38 and the edge is 2/38 = 5.26 %; realized −5.43 % (b3), −4.91 % (c9), −5.47 % (a1), −5.23 % (flat red). q grows by Π (1 − c(k)/38) / (1 − c(k)/37) over the levels: b3 0.00591 → 0.00685, predicted P(no cap) 0.58, measured 0.585; a1 predicted 0.49, measured 0.473, below ½, so its median flips. The c9 cash-out: q_SL 0.00510 × 1.181 = 0.00602, (1 − q)^20 = 0.886, measured 0.887; mean −$100.32 (−4.75 % of $2,113).',
        'Length: P(no cap at S) = e^(−k·p·S/B) falls below ½ at S½ = ln 2 × B/(k·p); at 1,000 spins the medians stay ahead until 690, 860, 570 (b3, c9, a1) against n½ 723, 874, 577. La partage halves the edge on even money only: flat red −1.36 %, mean −$169.82. With onCap stop the cap loss ($3,444 to $4,919) stays under $5,000, so extra bankroll is never used. Default table ($25 minimums): a9, b11, c6 kept 0.3 %, 9.8 % and 0 % of 2,000 sessions uncapped.',
      ],
      formulas: [
        'edge (American) = −2/38 = −5.26 %',
        'q(American) = q × Π (1 − c(k)/38) / (1 − c(k)/37)',
        'S½ = ln 2 × B / (k·p)',
      ],
    },
    dataKeys: [
      'e8-american:e8-am-b3-two-streets-l29',
      'e8-american:e8-am-c9-streets-to12-stack',
      'e8-american:e8-am-a1-streets-w27',
      'e8-american:e8-am-flat-red',
      'e8-length:e8-S250-b3-two-streets-l29',
      'e8-length:e8-S250-c9-streets-to12-stack',
      'e8-length:e8-S250-a1-streets-w27',
      'e8-length:e8-S250-flat-red',
      'e8-length:e8-S1000-b3-two-streets-l29',
      'e8-length:e8-S1000-c9-streets-to12-stack',
      'e8-length:e8-S1000-a1-streets-w27',
      'e8-length:e8-S1000-flat-red',
      'e8-partage:e8-lp-b3-two-streets-l29',
      'e8-partage:e8-lp-c9-streets-to12-stack',
      'e8-partage:e8-lp-a1-streets-w27',
      'e8-partage:e8-lp-flat-red',
      'e8-br10k:e8-br10k-b3-two-streets-l29',
      'e8-br10k:e8-br10k-c9-streets-to12-stack',
      'e8-br10k:e8-br10k-a1-streets-w27',
      'e8-br10k:e8-br10k-flat-red',
      'x1-c9-cashout-axes:x1-c9-am',
      'x1-c9-cashout-axes:x1-c9-S250',
      'x1-c9-cashout-axes:x1-c9-S1000',
      'x1-c9-cashout-axes:x1-c9-am-S1000',
      'x1-a1-trailing:x1-a1-W20-ctrl',
      'x1-a1-trailing:x1-a1-L8-W20',
      'x1-a1-trailing:x1-a1-L8-nostop',
      'e6-widen-screen:a9-dozen-streets-default',
      'e6-stack-screen:b11-red-default-l7',
      'e6-hybrid-screen:c6-dozen-to-two-dozens-default',
    ],
  },
  {
    id: 'try',
    title: 'Try it',
    lead: 'Pick one of the three candidates, play it on a $1-minimum table from $5,000 for up to 500 spins, and judge it by the typical session, the average and the worst 5 % together.',
    body: [
      'The candidates are saved strategy files. For now: open Define, switch to its JSON mode and paste the file, then set the table’s outside minimum and inside minimum total to $1, because a strategy file cannot carry table limits. Use a $5,000 bankroll and 500 spins. The Research screen will offer a one-tap Open in Define that does all of this for you.',
      'After the run, read Analyze: the typical session, the chance of ending ahead, the average and the worst 5 % of sessions. Expect the average to be negative; that is the wheel, not a bug. Play only with money you can afford to lose.',
    ],
    takeaways: [
      'Start with c9 with cash-out: it ends ahead about 90 % of the time, with the smallest average loss and the mildest worst 5 % of the three.',
      'Size your own ladder with the calculator before you play it.',
      'Every dollar you bet costs 2.7 cents on average, no matter how you bet it.',
    ],
    math: {
      text: [
        'The calculator uses the formulas of chapters 2 to 7. Inputs: coverage c, growth g (default 36/(36 − c)), base stake u, chip unit, table maximum, bankroll and session length S. Outputs: levels L, cap probability q = (1 − c/37)^L, the bankroll a full ladder consumes in level-0 stakes B = Σ g^k for k < L, the horizon n½ = ln 2 / (q·p), the never-capped share e^(−q·p·S), and with a cash-out of W cycle profits P(win) ≈ (1 − q)^W.',
        'Pinned case: Martingale on red with 8 levels gives q = 0.0048 and n½ = 295. Check against the c9 cash-out: q = 0.00356 and W = 20 give 0.931 without the stop-loss (measured 93.2 %); the half-ladder stop-loss lowers it to 90.3 %, 89.9 %, 90.1 % and 89.8 % on four seeds, with means −$46.25, −$60.12, −$53.65, −$60.90 and CVaR 5 % −$3,210, −$3,214, −$3,212, −$3,209.',
      ],
      formulas: [
        'L = levels that fit the table maximum and the bankroll',
        'B = Σ g^k (k = 0 … L − 1)',
        'n½ = ln 2 / (q·p);  P(win) ≈ (1 − q)^W',
      ],
    },
    dataKeys: [
      'e7-c9:e7-c9-W20-SLhalf',
      'e7-c9-holdout:e7-c9-W20-SLhalf@1',
      'e7-c9-holdout:e7-c9-W20-SLhalf@2',
      'e7-c9-seed3:e7-c9-W20-SLhalf@3',
      'x1-c9-cashout-axes:x1-c9-am',
      ...seeds('e6-full', 'c9-streets-to12-stack', ['20261031', '1', '2']),
      'e8-seed3:c9-streets-to12-stack@3',
      ...seeds('e6-full', 'b3-two-streets-l29', ['20261031', '1', '2']),
      'e8-seed3:b3-two-streets-l29@3',
    ],
  },
];
