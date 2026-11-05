// Table limits for play mode: outside minimum and maximum, the inside minimum (total of inside
// chips per spin) and the inside maximum (straight-up; the other inside spots keep the wheel
// preset's ratios to it). Edited as rules overrides on top of the wheel preset, validated by the
// roulette rules themselves, applied to this session or carried into a new one.
import type { Cents, Json } from '@core/contracts/game';
import { formatMoney } from '@core/money';
import { Button, Field, MoneyInput } from '@core/ui';
import { resolveRules, roulette, type RouletteRules } from '@game/roulette';
import { useState } from 'preact/hooks';
import { rulesError, type RulesOverrides } from './env';

export interface TableLimits {
  outsideMin: Cents;
  outsideMax: Cents;
  insideMin: Cents;
  insideMax: Cents;
}

const MAX_LIMIT: Cents = 100_000_000;

export function limitsOf(rules: RouletteRules): TableLimits {
  const l = rules.limits;
  return {
    outsideMin: l.outside.min,
    outsideMax: l.outside.max,
    insideMin: l.inside.minTotal,
    insideMax: l.inside.max.straight,
  };
}

/**
 * The rules overrides for these limits on `variant`, pruned of values equal to the preset. Inside
 * spot maxima scale with the straight-up maximum at the preset's ratios (split ×2, corner ×4, ...).
 */
export function overridesFor(variant: string, t: TableLimits): RulesOverrides {
  const preset = resolveRules(variant).limits;
  const unit = preset.chipUnit;
  const base = preset.inside.max;
  const max: Record<string, Json> = {};
  for (const [k, v] of Object.entries(base))
    max[k] = Math.max(unit, Math.round((t.insideMax * v) / base.straight / unit) * unit);
  const overrides: RulesOverrides = {
    limits: {
      outside: { min: t.outsideMin, max: t.outsideMax },
      inside: { minTotal: t.insideMin, max },
    },
  };
  return roulette.rules.normalize({ preset: variant, overrides }).overrides;
}

/** Overrides for `limits` on `variant`, or the reason they are not valid rules. */
export function checkedOverrides(
  variant: string,
  t: TableLimits,
): { overrides: RulesOverrides } | { error: string } {
  if (t.outsideMin > t.outsideMax)
    return { error: 'The outside minimum is above the outside maximum.' };
  try {
    const overrides = overridesFor(variant, t);
    const error = rulesError(variant, overrides);
    return error ? { error } : { overrides };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Invalid table limits' };
  }
}

/** One line for the table card: "outside $25–$5,000 · inside $25 min, $500 max". */
export function limitsLine(rules: RouletteRules): string {
  const t = limitsOf(rules);
  return `outside ${formatMoney(t.outsideMin)}–${formatMoney(t.outsideMax)} · inside ${formatMoney(t.insideMin)} min, ${formatMoney(t.insideMax)} max`;
}

export interface LimitsSectionProps {
  variant: string;
  /** The limits the form starts from (the session's current rules). */
  rules: RouletteRules;
  /** Apply to the running session; absent when it has ended. */
  onApply?(overrides: RulesOverrides): void;
  /** Report the limits so "Start new session" can use them (on whichever wheel it picks). */
  onChange?(limits: TableLimits): void;
}

export function LimitsSection(props: LimitsSectionProps) {
  const [t, setT] = useState<TableLimits>(() => limitsOf(props.rules));
  const [applied, setApplied] = useState(false);
  const checked = checkedOverrides(props.variant, t);
  const overrides = 'overrides' in checked ? checked.overrides : null;
  const error = 'error' in checked ? checked.error : null;
  const set = (patch: Partial<TableLimits>) => {
    const next = { ...t, ...patch };
    setT(next);
    setApplied(false);
    props.onChange?.(next);
  };
  const reset = () => {
    const d = limitsOf(resolveRules(props.variant));
    set(d);
  };

  return (
    <section class="play-form" aria-labelledby="play-lim-h">
      <h3 id="play-lim-h" class="play-sub">
        Table limits
      </h3>
      <div class="play-limits">
        <Field label="Outside minimum" id="play-lim-omin">
          <MoneyInput
            id="play-lim-omin"
            value={t.outsideMin}
            onChange={(v) => set({ outsideMin: v })}
            min={100}
            max={MAX_LIMIT}
          />
        </Field>
        <Field label="Outside maximum" id="play-lim-omax">
          <MoneyInput
            id="play-lim-omax"
            value={t.outsideMax}
            onChange={(v) => set({ outsideMax: v })}
            min={100}
            max={MAX_LIMIT}
          />
        </Field>
        <Field label="Inside minimum (total per spin)" id="play-lim-imin">
          <MoneyInput
            id="play-lim-imin"
            value={t.insideMin}
            onChange={(v) => set({ insideMin: v })}
            min={100}
            max={MAX_LIMIT}
          />
        </Field>
        <Field
          label="Inside maximum (straight-up)"
          id="play-lim-imax"
          hint="Splits, streets, corners and lines scale with it."
        >
          <MoneyInput
            id="play-lim-imax"
            value={t.insideMax}
            onChange={(v) => set({ insideMax: v })}
            min={100}
            max={MAX_LIMIT}
          />
        </Field>
      </div>
      {error ? (
        <p class="play-problem" role="alert">
          {error}
        </p>
      ) : null}
      <div class="actions">
        {props.onApply ? (
          <Button
            disabled={overrides === null}
            onClick={() => {
              if (!overrides) return;
              props.onApply!(overrides);
              setApplied(true);
            }}
          >
            {applied ? 'Applied' : 'Apply to this session'}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={reset}>
          Wheel defaults
        </Button>
      </div>
      <p class="muted">New sessions started below use these limits too.</p>
    </section>
  );
}
