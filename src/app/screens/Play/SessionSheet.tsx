// Session controls: top up, end, start a new session (bankroll, wheel, random source), history.
import type { Cents } from '@core/contracts/game';
import { formatMoney } from '@core/money';
import { randomSeed, type PlaySession } from '@core/play';
import { Button, Field, MoneyInput, Segmented, Select, Sheet, TextInput } from '@core/ui';
import { useState } from 'preact/hooks';
import { VARIANTS, variantLabel } from '../../services/layouts';
import type { SessionSummary } from './store';
import type { RulesOverrides } from './env';
import { checkedOverrides, limitsOf, LimitsSection, type TableLimits } from './LimitsSection';
import type { RouletteRules } from '@game/roulette';
import type { NewSessionOptions } from './usePlaySession';

export interface SessionSheetProps {
  open: boolean;
  onClose: () => void;
  session: PlaySession;
  history: readonly SessionSummary[];
  onStart: (opts: NewSessionOptions) => void;
  onTopUp: (amount: Cents) => void;
  onEnd: () => void;
  /** The session's current rules (its wheel and table limits). */
  rules: RouletteRules;
  onSetRules: (overrides: RulesOverrides) => void;
}

const MAX_BANKROLL: Cents = 100_000_000;

function parseSeed(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,10}$/.test(t)) return null;
  const n = Number(t);
  return n <= 0xffffffff ? n : null;
}

export function SessionSheet(props: SessionSheetProps) {
  const { session } = props;
  const [topUp, setTopUp] = useState<Cents>(session.startBankroll);
  const [bankroll, setBankroll] = useState<Cents>(session.startBankroll);
  const [variant, setVariant] = useState(session.variant);
  const [rngKind, setRngKind] = useState<'crypto' | 'seeded'>('crypto');
  const [seedText, setSeedText] = useState(() => String(randomSeed()));
  const [limits, setLimits] = useState<TableLimits>(() => limitsOf(props.rules));
  const newLimits = checkedOverrides(variant, limits);
  const seed = parseSeed(seedText);
  const seedErr =
    rngKind === 'seeded' && seed === null ? 'A whole number from 0 to 4294967295.' : null;

  const start = () => {
    if (seedErr || 'error' in newLimits) return;
    props.onStart({
      variant,
      bankroll,
      rulesOverrides: newLimits.overrides,
      rng: rngKind === 'seeded' ? { kind: 'seeded', seed: seed! } : { kind: 'crypto' },
    });
    props.onClose();
  };

  return (
    <Sheet open={props.open} title="Session" onClose={props.onClose}>
      {!session.endedAt ? (
        <section class="play-form" aria-labelledby="play-cur-h">
          <h3 id="play-cur-h" class="play-sub">
            This session
          </h3>
          <Field label="Top up the bankroll" id="play-topup">
            <MoneyInput
              id="play-topup"
              value={topUp}
              onChange={setTopUp}
              min={100}
              max={MAX_BANKROLL}
            />
          </Field>
          <div class="actions">
            <Button
              onClick={() => {
                props.onTopUp(topUp);
                props.onClose();
              }}
            >
              Add {formatMoney(topUp)}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                props.onEnd();
                props.onClose();
              }}
            >
              End session
            </Button>
          </div>
        </section>
      ) : null}

      <LimitsSection
        variant={session.variant}
        rules={props.rules}
        onChange={setLimits}
        {...(!session.endedAt ? { onApply: props.onSetRules } : {})}
      />

      <section class="play-form" aria-labelledby="play-new-h">
        <h3 id="play-new-h" class="play-sub">
          New session
        </h3>
        <Field label="Bankroll" id="play-bankroll">
          <MoneyInput
            id="play-bankroll"
            value={bankroll}
            onChange={setBankroll}
            min={100}
            max={MAX_BANKROLL}
          />
        </Field>
        <Field label="Wheel" id="play-variant">
          <Select
            id="play-variant"
            value={variant}
            options={VARIANTS.map((v) => ({ value: v.id, label: v.label }))}
            onChange={setVariant}
          />
        </Field>
        <div class="field">
          <span class="play-field-label" aria-hidden="true">
            Random numbers
          </span>
          <Segmented
            label="Random numbers"
            value={rngKind}
            options={[
              { value: 'crypto', label: 'Random (crypto)' },
              { value: 'seeded', label: 'Seeded' },
            ]}
            onChange={setRngKind}
          />
        </div>
        {rngKind === 'seeded' ? (
          <Field
            label="Seed"
            id="play-seed"
            hint="The same seed and bets replay the same spins."
            error={seedErr}
          >
            <TextInput
              id="play-seed"
              value={seedText}
              onInput={setSeedText}
              inputMode="numeric"
              invalid={seedErr !== null}
            />
          </Field>
        ) : null}
        <div class="actions">
          <Button
            variant="primary"
            onClick={start}
            disabled={seedErr !== null || 'error' in newLimits}
          >
            Start new session
          </Button>
        </div>
        {'error' in newLimits ? (
          <p class="play-problem" role="alert">
            Table limits for this wheel: {newLimits.error}
          </p>
        ) : null}
        {!session.endedAt && session.stats.spins > 0 ? (
          <p class="muted">Starting a new session ends this one and keeps its summary.</p>
        ) : null}
      </section>

      {props.history.length > 0 ? (
        <section aria-labelledby="play-hist-h">
          <h3 id="play-hist-h" class="play-sub">
            Past sessions
          </h3>
          <ul class="rows play-history">
            {props.history.map((h) => (
              <li class="play-history-row">
                <span class="row-title">
                  <span class={h.net > 0 ? 'play-tone-good' : h.net < 0 ? 'play-tone-bad' : ''}>
                    {formatMoney(h.net, { sign: true })}
                  </span>{' '}
                  over {h.spins} spins
                </span>
                <span class="row-sub">
                  {variantLabel(h.variant)} · in {formatMoney(h.bankIn)} · wagered{' '}
                  {formatMoney(h.wagered)}
                  {h.seed !== undefined ? ` · seed ${h.seed}` : ''} ·{' '}
                  {new Date(h.endedAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Sheet>
  );
}
