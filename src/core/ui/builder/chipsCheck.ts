// The stage panel's table check (layouts.md §3.4, S2): `checkAtTable` at the starting level and, for
// a progression, again at its top level. Pure; the panel renders the result.
import type { BetCatalogEntry, Cents, GamePlugin } from '../../contracts/game';
import type { StageChips } from '../../contracts/layout';
import type { Diagnostic, ProgressionSpec, Slug } from '../../contracts/strategy';
import { resolveChipValue } from '../../strategy';
import { betLabel, makeRows, money, plural } from '../layout/adjust';
import { checkAtTable } from '../layout/check';
import type { TableCheck } from '../layout/types';

export interface StageTableCheck {
  /** The chip value in cents at the starting and top level; null when the base is a formula. */
  value: { base: Cents | null; top: Cents | null };
  /** At the starting level; null when the value cannot be previewed. */
  atBase: TableCheck | null;
  /** At the top level; null when it equals the starting level or cannot be previewed. */
  atTop: TableCheck | null;
  /** `W_CHIPS_TABLE`: spots the table would drop (or fail to place) at the starting level. */
  diagnostics: Diagnostic[];
  /** Other findings in words: cuts at the maximum, bankroll limits, call-bet steps. */
  notes: string[];
  /** Cents the table places per round at the starting level. */
  perRound: Cents | null;
  /** True when nothing is dropped, cut or unaffordable. */
  fits: boolean;
}

const BANKROLL_CODES = ['unaffordable', 'reduced'];

export function checkStageChips<R>(a: {
  plugin: GamePlugin<unknown, unknown, R, unknown>;
  rules: R;
  chips: StageChips;
  stage: number;
  unit: Cents;
  progressions: Record<Slug, ProgressionSpec>;
  bankroll: Cents;
  /** Chips one tap adds for a bet (call bets: their step). */
  step?: (bet: string) => number;
  catalog: readonly BetCatalogEntry[];
}): StageTableCheck {
  const { plugin, rules, chips, catalog } = a;
  const value = resolveChipValue(chips.chip, { unit: a.unit, progressions: a.progressions });
  const out: StageTableCheck = {
    value,
    atBase: null,
    atTop: null,
    diagnostics: [],
    notes: [],
    perRound: null,
    fits: true,
  };
  const label = (bet: string) => betLabel(catalog, bet);
  const follows = typeof chips.chip === 'object' && 'prog' in chips.chip;
  if (a.step) {
    for (const s of chips.spots) {
      const st = a.step(s.bet);
      if (st > 1 && s.chips % st !== 0) {
        out.notes.push(`${label(s.bet)} goes in steps of ${plural(st, 'chip')}.`);
        out.fits = false;
      }
    }
  }
  if (value.base === null) {
    out.fits = false;
    return out;
  }
  const rows = (v: Cents) => makeRows(chips.spots, v);
  out.atBase = checkAtTable(plugin, rules, rows(value.base), a.bankroll);
  out.perRound = out.atBase.total;
  let insideDone = false;
  for (const p of out.atBase.perSpot) {
    if (p.status === 'ok') continue;
    const bankroll = p.code !== undefined && BANKROLL_CODES.includes(p.code);
    if (bankroll) continue;
    if (p.status === 'rejected') {
      let message: string;
      if (p.code === 'inside-min-total') {
        if (insideDone) continue;
        insideDone = true;
        message = `At the ${follows ? 'starting ' : ''}${money(value.base)} chip, the inside bets together are below the table's inside minimum${follows ? ' and are dropped every spin until the progression rises' : ''}.`;
      } else {
        const min = plugin.limits(p.bet, rules)?.min;
        const why =
          p.code === 'below-min' && min !== undefined
            ? `is below the ${money(min)} minimum`
            : `is not placed (${p.reason ?? p.code ?? 'rejected'})`;
        message = `At the ${follows ? 'starting ' : ''}${money(value.base)} chip, ${label(p.bet)} (${money(p.asked)}) ${why} and is dropped every spin${follows ? ' until the progression rises' : ''}.`;
      }
      out.diagnostics.push({
        code: 'W_CHIPS_TABLE',
        severity: 'warning',
        path: `/stages/${a.stage}/x-chips`,
        message,
        params: { bet: p.bet },
      });
    } else if (p.code === 'clamped') {
      out.notes.push(
        `${label(p.bet)}: ${money(p.asked)} is cut to ${money(p.placed)} (table maximum).`,
      );
    }
  }
  const short = out.atBase.perSpot.filter(
    (p) => p.status === 'rejected' && p.code !== undefined && BANKROLL_CODES.includes(p.code),
  );
  if (short.length > 0 || out.atBase.perSpot.some((p) => p.code === 'reduced')) {
    const placed = out.atBase.perSpot.filter((p) => p.placed > 0).length;
    out.notes.push(
      `With ${money(a.bankroll)} cash: ${placed} of ${chips.spots.length} spots placed.`,
    );
  }
  if (value.top !== null && value.top !== value.base) {
    out.atTop = checkAtTable(plugin, rules, rows(value.top), a.bankroll);
    for (const p of out.atTop.perSpot) {
      if (p.status === 'adjusted' && p.code === 'clamped')
        out.notes.push(
          `At the top of the progression (${money(value.top)} a chip), ${label(p.bet)} is cut to ${money(p.placed)}.`,
        );
    }
  }
  out.fits = out.fits && out.diagnostics.length === 0 && out.notes.length === 0;
  return out;
}
