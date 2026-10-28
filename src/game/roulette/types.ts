// Roulette types (game.md §14, with the decisions.md reconciliation applied: `rng: Rng`, no
// `forced` constructor option, no `bet-won`/`bet-lost`/`bet-push` plugin events). Owner: game WP.
import type { BetId, Cents, GameEvent, LayoutEntry, Rng, RoundOutcome } from '@core/contracts/game';

export type WheelKind = 'european' | 'american' | 'triple-zero';
/** 0..36 are the numbers, 37 is '00', 38 is '000'. */
export type PocketIndex = number;
export type PocketLabel = '0' | '00' | '000' | `${number}`;
export type Color = 'red' | 'black' | 'green';
export type Family =
  | 'straight'
  | 'split'
  | 'street'
  | 'trio'
  | 'corner'
  | 'basket'
  | 'sixline'
  | 'even-money'
  | 'dozen'
  | 'column'
  | 'call'
  | 'neighbours';
export type LimitClass = 'inside' | 'outside' | 'call';
export type InsideSpot = 'straight' | 'split' | 'street' | 'trio' | 'corner' | 'basket' | 'sixline';

export interface TableLimits {
  /** 100: every amount is a whole multiple of this. */
  chipUnit: Cents;
  outside: { min: Cents; max: Cents };
  inside: {
    /** Per inside chip, including call-bet components. */
    minChip: Cents;
    /** Total of inside chips per spin, if any are placed. */
    minTotal: Cents;
    max: Record<InsideSpot, Cents>;
  };
  /** Null: no aggregate cap. */
  maxTotalPerSpin: Cents | null;
}

export interface RouletteRules {
  /** The preset this was resolved from. */
  preset: WheelKind;
  wheel: WheelKind;
  /** Even-money bets lose half on 0. */
  laPartage: boolean;
  /** Even-money bets are imprisoned on 0. */
  enPrison: boolean;
  /** What a 0 does to an imprisoned bet. */
  enPrisonSecondZero: 'lose' | 'reimprison';
  limits: TableLimits;
  reconcile: { overMax: 'clamp' | 'reject'; shortfall: 'reduce' | 'reject' };
  pace: { roundsPerHour: number; label: 'live' | 'electronic' | 'custom' };
}

export interface WheelSpec {
  kind: WheelKind;
  n: 37 | 38 | 39;
  /** By PocketIndex. */
  labels: readonly PocketLabel[];
  /** Clockwise from 0 (empty for triple-zero until sourced). */
  order: readonly PocketIndex[];
  /** 0 green, 1 red, 2 black, by PocketIndex. */
  color: Uint8Array;
}

/** A bet resolved for one wheel; frozen. */
export interface BetDef {
  id: BetId;
  family: Family;
  limitClass: LimitClass;
  /** Covered pockets (call bets: the union). */
  pockets: readonly PocketIndex[];
  /** X to 1 (call bets: 0, see components). */
  pays: number;
  components?: readonly { spot: BetId; weight: number }[];
  /** 1, or the sum of weights for call bets. */
  pieces: number;
  /** La partage / en prison apply. */
  evenMoney: boolean;
}

export interface SpotChip {
  spot: BetId;
  amount: Cents;
}
export interface PlacedBet {
  bet: BetId;
  amount: Cents;
  chips: readonly SpotChip[];
}

/** A running hit count over the last `n` spins, registered lazily by `count:<n>:<target>`. */
export interface WindowCounter {
  /** Canonical target (`red`, `zero`, `split:17-20`, ...). */
  target: string;
  n: number;
  /** 1 for every pocket the target covers, by PocketIndex. */
  mask: Uint8Array;
  count: number;
}
/**
 * Spin history (game.md §9.2). Everything is exact: per-pocket hit counts and last-seen indices
 * answer `hits`/`spinsSince`/`zeroCount` for any target; the 1024 ring answers `streak` and
 * backfills `count` windows; only windows need registering.
 */
export interface SpinHistory {
  /** Last 1024 pocket indices (slot = spin number mod 1024). */
  ring: Uint8Array;
  /** Spins recorded (may exceed the ring length). */
  len: number;
  /** Hits per pocket this session. */
  hitsByPocket: Int32Array;
  /** Spin number (0-based) of each pocket's last hit, -1 if never. */
  lastSeen: Int32Array;
  /** Length of the current run of equal colour (zeros are green); 0 before the first spin. */
  colorRun: number;
  /** Colour code of the last spin (0 green, 1 red, 2 black). */
  lastColor: number;
  windows: WindowCounter[];
}

export interface RouletteState {
  rules: RouletteRules;
  wheel: WheelSpec;
  rng: Rng;
  /** Test/scene queue of pocket indices, consumed before the RNG (filled by `force`). */
  forced: PocketIndex[];
  /** Excludes stakes on the table. */
  bankroll: Cents;
  /** Bets placed this decision window (cleared by playRound). */
  layout: PlacedBet[];
  /** Imprisoned even-money bets (persist; contract). */
  prison: PlacedBet[];
  /** 'confirm' accepted for this window ("no more bets"). */
  confirmed: boolean;
  /** Spins played. */
  round: number;
  history: SpinHistory;
}

/** What strategy facts read: the state minus its RNG (reconciliation G3). */
export type RouletteView = Readonly<Omit<RouletteState, 'rng'>>;

export type RouletteAction =
  | { type: 'place'; bet: BetId; amount: Cents }
  | { type: 'remove'; bet: BetId }
  | { type: 'confirm' };

export type ApplyCode =
  | 'unknown-bet'
  | 'not-on-wheel'
  | 'not-placeable'
  | 'after-confirm'
  | 'bad-amount'
  | 'below-min'
  | 'over-max'
  | 'unaffordable'
  | 'inside-min-total'
  | 'table-max'
  | 'not-placed';

export type ReconcileCode =
  | 'unknown-bet'
  | 'not-on-wheel'
  | 'not-placeable'
  | 'invalid-amount'
  | 'below-min'
  | 'over-max'
  | 'unaffordable'
  | 'inside-min-total'
  | 'table-max';
export type AdjustCode = 'merged' | 'rounded' | 'clamped' | 'reduced' | 'skipped-zero';
export interface Adjustment {
  entry: LayoutEntry;
  to: Cents;
  reason: AdjustCode;
}

/** Plugin events (reconciliation F1: `bet-won`/`bet-lost`/`bet-push` are core-derived). */
export type RouletteEventName =
  'spin' | 'zero' | 'partage' | 'imprisoned' | 'released' | 'prison-lost';
export interface RouletteEvent extends GameEvent {
  type: RouletteEventName;
  bet?: BetId;
}

export interface SpinSummary {
  pocket: PocketLabel;
  index: PocketIndex;
  color: Color;
  parity: 'odd' | 'even' | 'zero';
  half: 'low' | 'high' | 'zero';
  dozen: 0 | 1 | 2 | 3;
  column: 0 | 1 | 2 | 3;
  sector: 'voisins' | 'tiers' | 'orphelins' | null;
}
export interface RouletteOutcome extends RoundOutcome {
  summary: SpinSummary & Record<string, string | number | boolean | null>;
}
