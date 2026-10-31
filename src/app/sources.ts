// Where the rules, figures and strategies come from: the data behind the Sources screen
// (`#/sources`), and the per-preset "Source" links. Stable ids so other screens can refer to an entry.
// URLs are only given where they are known; an entry without a url is a title-only citation.

export interface SourceItem {
  id: string;
  title: string;
  author?: string;
  url?: string;
  /** What the app used it for. */
  note: string;
}

export interface SourceGroup {
  group: string;
  items: readonly SourceItem[];
}

export const SOURCE_GROUPS: readonly SourceGroup[] = [
  {
    group: 'Betting systems',
    items: [
      {
        id: 'wiki-martingale',
        title: 'Martingale (betting system), Wikipedia',
        url: 'https://en.wikipedia.org/wiki/Martingale_(betting_system)',
        note: 'The Martingale and Grand Martingale progressions.',
      },
      {
        id: 'wiki-oscars-grind',
        title: "Oscar's grind, Wikipedia",
        url: 'https://en.wikipedia.org/wiki/Oscar%27s_grind',
        note: "The Oscar's Grind rules (aim for one unit per cycle). We generalise it to arbitrary payouts.",
      },
      {
        id: 'wiki-fibonacci',
        title: 'Fibonacci betting system, Wikipedia',
        note: 'The Fibonacci progression.',
      },
      {
        id: 'wiki-dalembert',
        title: "d'Alembert betting system, Wikipedia",
        note: "The d'Alembert progression.",
      },
      {
        id: 'wiki-labouchere',
        title: 'Labouchère system, Wikipedia',
        note: 'The cancellation (split-sum) progression.',
      },
      {
        id: 'wiki-paroli',
        title: 'Paroli system, Wikipedia',
        note: 'The Paroli (reverse Martingale) progression, and the 1-3-2-6 variant.',
      },
    ],
  },
  {
    group: 'James Bond strategy',
    items: [
      {
        id: 'casinobeats-bond',
        title: 'James Bond roulette strategy, CasinoBeats',
        url: 'https://casinobeats.com/features/james-bond-roulette-strategy/',
        note: 'The 14 / 5 / 1 split (70 / 25 / 5 percent) across 19-36, the 13-18 six-line and zero. The attribution to Ian Fleming is folklore: CasinoBeats notes that Bond never used it in a book or film.',
      },
      {
        id: 'pokernews-bond',
        title: 'James Bond roulette strategy, PokerNews',
        url: 'https://www.pokernews.com/casino/roulette/james-bond-roulette-strategy.htm',
        note: 'A second description of the same bet split.',
      },
    ],
  },
  {
    group: 'Roulette rules',
    items: [
      {
        id: 'wiki-roulette',
        title: 'Roulette, Wikipedia',
        url: 'https://en.wikipedia.org/wiki/Roulette',
        note: 'Wheel orders, call bets (voisins, tiers, orphelins, jeu zéro) and house edges.',
      },
      {
        id: 'wiki-en-prison',
        title: 'En prison, Wikipedia',
        url: 'https://en.wikipedia.org/wiki/En_prison',
        note: 'The La Partage and En Prison rules. The edges are derived exactly by the app.',
      },
      {
        id: 'woo-roulette',
        title: 'Roulette, Wizard of Odds',
        author: 'Michael Shackleford',
        url: 'https://wizardofodds.com/games/roulette/',
        note: 'Roulette rules and bet payouts.',
      },
    ],
  },
  {
    group: 'Statistics',
    items: [
      {
        id: 'hyndman-fan-1996',
        title: 'Sample quantiles in statistical packages',
        author: 'Rob J. Hyndman and Yanan Fan, 1996',
        note: 'Type 7 quantiles (the R default).',
      },
      {
        id: 'wilson-1927',
        title: 'Probable inference, the law of succession, and statistical inference',
        author: 'Edwin B. Wilson, 1927',
        note: 'The Wilson score interval for rates.',
      },
      {
        id: 'newcombe-1998',
        title: 'Interval estimation for the difference between independent proportions',
        author: 'Robert G. Newcombe, Statistics in Medicine 17:873-890, 1998',
        note: 'The hybrid score interval used to compare two rates.',
      },
      {
        id: 'welch-satterthwaite',
        title: 'Welch (1947) and Satterthwaite (1946)',
        author: 'B. L. Welch; F. E. Satterthwaite',
        note: 'The unequal-variance t interval and its degrees of freedom, for unpaired comparisons.',
      },
      {
        id: 'freedman-diaconis-1981',
        title: 'On the histogram as a density estimator: L2 theory',
        author: 'David Freedman and Persi Diaconis, 1981',
        note: 'The histogram bin width rule.',
      },
      {
        id: 'welford-1962',
        title: 'Note on a method for calculating corrected sums of squares and products',
        author: 'B. P. Welford, 1962',
        note: 'Running mean and variance.',
      },
      {
        id: 'feller-ruin',
        title: 'An Introduction to Probability Theory and Its Applications',
        author: 'William Feller',
        note: "The gambler's ruin formulas, used as analytic test oracles.",
      },
      {
        id: 'desctools-binomdiffci',
        title: 'DescTools::BinomDiffCI, R documentation',
        url: 'https://search.r-project.org/CRAN/refmans/DescTools/html/BinomDiffCI.html',
        note: 'Reference values for the Newcombe test vector (56/70 vs 48/80); the package attributes the data to a WUSS 2016 paper.',
      },
    ],
  },
  {
    group: 'Algorithms',
    items: [
      {
        id: 'splitmix64',
        title: 'SplitMix64',
        author:
          'Guy L. Steele Jr., Doug Lea and Christine H. Flood, 2014; reference code by Sebastiano Vigna',
        url: 'https://prng.di.unimi.it/',
        note: 'Seed expansion. Rewritten over 32-bit pairs; the constants are the published ones.',
      },
      {
        id: 'xoshiro128ss',
        title: 'xoshiro128**',
        author: 'David Blackman and Sebastiano Vigna (public domain)',
        url: 'https://prng.di.unimi.it/',
        note: 'The random number generator behind every spin.',
      },
      {
        id: 'sha-256',
        title: 'FIPS 180-4, Secure Hash Standard (SHA-256)',
        author: 'NIST',
        note: 'Content-addressed ids when WebCrypto is unavailable.',
      },
    ],
  },
  {
    group: 'Software',
    items: [
      {
        id: 'preact',
        title: 'Preact (MIT license)',
        author: '© Jason Miller and contributors',
        url: 'https://preactjs.com/',
        note: 'The UI library, the only runtime dependency.',
      },
    ],
  },
  {
    group: 'Help',
    items: [
      {
        id: 'ncpg',
        title: 'National Council on Problem Gambling: 1-800-GAMBLER',
        url: 'https://www.ncpgambling.org/help-treatment/',
        note: 'Free, confidential help if gambling is a problem for you or someone close to you.',
      },
    ],
  },
];

const BY_ID = new Map<string, SourceItem>(
  SOURCE_GROUPS.flatMap((g) => g.items).map((i) => [i.id, i]),
);

export function sourceById(id: string): SourceItem | undefined {
  return BY_ID.get(id);
}

/** Source for a strategy preset's description, by preset id (kept out of the preset JSON). */
export const PRESET_SOURCES: Readonly<Record<string, string>> = {
  'martingale-red': 'wiki-martingale',
  'grand-martingale-red': 'wiki-martingale',
  'fibonacci-red': 'wiki-fibonacci',
  'dalembert-red': 'wiki-dalembert',
  'labouchere-red': 'wiki-labouchere',
  'paroli-red': 'wiki-paroli',
  'one-three-two-six-red': 'wiki-paroli',
  'oscars-grind-red': 'wiki-oscars-grind',
  'james-bond': 'casinobeats-bond',
};
