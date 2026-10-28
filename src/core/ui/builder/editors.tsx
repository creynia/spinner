// Chip editors (strategy.md §13.3). Each edits a draft in a Sheet (bottom sheet on phones) and
// commits with "Done". Nested pickers swap the sheet's content instead of stacking dialogs.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { FactParam } from '../../contracts/facts';
import type { Condition, Effect, ProgressionSpec } from '../../contracts/strategy';
import { PROGRESSION_KINDS } from '../../strategy';
import { Button, Segmented, Sheet, Toggle, useId } from '../kit';
import { describeAmount, describeCondition, describeEffect } from './describe';
import { str, allFacts, betLabel, factByName, type BuilderEnv, type FactInfo } from './env';
import { JsonField, NumField, SelectField, TextField } from './fields';
import { amountFrom, amountTo, type AmountModel } from './model';

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

export function EditorSheet(p: {
  title: string;
  onClose: () => void;
  onSave?: () => void;
  saveDisabled?: boolean;
  onDelete?: () => void;
  preview?: string;
  children: ComponentChildren;
}) {
  return (
    <Sheet open title={p.title} onClose={p.onClose}>
      <div class="ed">
        {p.children}
        {p.preview ? (
          <p class="ed-preview" aria-live="polite">
            <span class="muted">Reads: </span>
            {p.preview}
          </p>
        ) : null}
        <div class="ed-actions">
          {p.onSave ? (
            <Button variant="primary" onClick={p.onSave} disabled={p.saveDisabled}>
              Done
            </Button>
          ) : null}
          <Button onClick={p.onClose}>Cancel</Button>
          {p.onDelete ? (
            <Button variant="danger" onClick={p.onDelete}>
              Delete
            </Button>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ bets

export function BetPickView(p: {
  env: BuilderEnv;
  value?: string;
  extra?: readonly string[];
  onPick: (id: string) => void;
  onBack: () => void;
}) {
  const { BetPicker } = p.env.ui;
  return (
    <div class="ed-pick">
      <Button onClick={p.onBack}>Back</Button>
      {p.extra?.length ? (
        <div class="chips" role="group" aria-label="Other targets">
          {p.extra.map((x) => (
            <button type="button" class="chip" key={x} onClick={() => p.onPick(x)}>
              {x}
            </button>
          ))}
        </div>
      ) : null}
      <BetPicker rules={p.env.rules} value={p.value} onPick={p.onPick} />
    </div>
  );
}

/** A bet shown as a button; tapping it asks the parent to open the picker. */
export function BetButton(p: {
  env: BuilderEnv;
  label: string;
  value: string;
  onOpen: () => void;
}) {
  const id = useId('bet');
  return (
    <div class="field">
      <span class="field-label" id={`${id}-l`}>
        {p.label}
      </span>
      <button
        type="button"
        class="btn bet-btn"
        aria-labelledby={`${id}-l ${id}-b`}
        onClick={p.onOpen}
      >
        <span id={`${id}-b`}>{p.value ? betLabel(p.env, p.value) : 'Choose a bet'}</span>
      </button>
    </div>
  );
}

/** Hook-free wrapper: edits a draft whose bet fields open the picker as a sub-view. */
function useBetPick(
  env: BuilderEnv,
  render: (
    open: (field: string, cur: string, extra?: readonly string[]) => void,
  ) => ComponentChildren,
  apply: (field: string, id: string) => void,
) {
  const [pick, setPick] = useState<{
    field: string;
    cur: string;
    extra?: readonly string[];
  } | null>(null);
  if (pick) {
    return (
      <BetPickView
        env={env}
        value={pick.cur}
        extra={pick.extra}
        onBack={() => setPick(null)}
        onPick={(id) => {
          apply(pick.field, id);
          setPick(null);
        }}
      />
    );
  }
  return <>{render((field, cur, extra) => setPick({ field, cur, extra }))}</>;
}

// ------------------------------------------------------------------ amounts

const AMOUNT_KINDS: { value: AmountModel['kind']; label: string }[] = [
  { value: 'units', label: 'Units' },
  { value: 'cents', label: 'Amount' },
  { value: 'prog', label: 'Progression' },
  { value: 'pct', label: '% bankroll' },
  { value: 'tableMin', label: 'Table min' },
  { value: 'keep', label: 'Keep' },
  { value: 'formula', label: 'Formula' },
];

function defaultAmount(kind: AmountModel['kind'], progs: string[]): AmountModel {
  switch (kind) {
    case 'units':
      return { kind, n: 1 };
    case 'cents':
      return { kind, cents: 2500 };
    case 'prog':
      return { kind, name: progs[0] ?? '' };
    case 'pct':
      return { kind, p: 1 };
    case 'tableMin':
      return { kind, of: 'outside' };
    case 'keep':
      return { kind, inner: { kind: 'units', n: 1 } };
    case 'formula':
      return { kind, expr: { units: 1 } };
  }
}

export function AmountFields(p: {
  value: AmountModel;
  onChange: (a: AmountModel) => void;
  progressions: string[];
  env: BuilderEnv;
  allowKeep?: boolean;
  nested?: boolean;
  /** A plain number (variables, counters), not dollars. */
  plain?: boolean;
}) {
  const a = p.value;
  const kinds = AMOUNT_KINDS.filter((k) =>
    p.plain
      ? k.value === 'cents' || k.value === 'units' || k.value === 'formula' || k.value === a.kind
      : k.value === 'keep'
        ? p.allowKeep !== false && !p.nested
        : true,
  ).map((k) => (p.plain && k.value === 'cents' ? { ...k, label: 'Number' } : k));
  return (
    <div class="ed-amount">
      <SelectField
        label={p.nested ? 'Else place' : 'Amount type'}
        value={a.kind}
        options={kinds}
        onChange={(k) => p.onChange(defaultAmount(k, p.progressions))}
      />
      {a.kind === 'units' && (
        <NumField
          label="Units"
          value={a.n}
          min={0}
          hint={`1 unit = ${describeAmount({ kind: 'units', n: 1 }, p.env).replace(/^1 unit /, '')}`}
          onChange={(n) => p.onChange({ kind: 'units', n })}
        />
      )}
      {a.kind === 'cents' && (
        <NumField
          label={p.plain ? 'Number' : 'Dollars'}
          money={!p.plain}
          min={p.plain ? undefined : 0}
          value={a.cents}
          onChange={(c) => p.onChange({ kind: 'cents', cents: c })}
        />
      )}
      {a.kind === 'prog' &&
        (p.progressions.length === 0 ? (
          <p class="hint">No progressions yet. Add one in the Progressions section first.</p>
        ) : (
          <SelectField
            label="Progression"
            value={a.name}
            options={p.progressions.map((n) => ({ value: n, label: n }))}
            onChange={(name) => p.onChange({ kind: 'prog', name })}
          />
        ))}
      {a.kind === 'pct' && (
        <NumField
          label="Percent of bankroll"
          min={0}
          value={a.p}
          onChange={(v) => p.onChange({ kind: 'pct', p: v })}
        />
      )}
      {a.kind === 'tableMin' && (
        <TextField
          label="Bet or limit class"
          value={a.of}
          hint="A bet id or a class such as outside or inside."
          onInput={(of) => p.onChange({ kind: 'tableMin', of })}
        />
      )}
      {a.kind === 'keep' && (
        <AmountFields
          nested
          value={a.inner}
          env={p.env}
          progressions={p.progressions}
          onChange={(inner) => p.onChange({ kind: 'keep', inner })}
        />
      )}
      {a.kind === 'formula' && (
        <JsonField
          label="Expression (JSON)"
          value={a.expr}
          onChange={(expr) => p.onChange({ kind: 'formula', expr: expr as never })}
        />
      )}
    </div>
  );
}

export function AmountEditor(p: {
  env: BuilderEnv;
  value: AmountModel;
  progressions: string[];
  onSave: (a: AmountModel) => void;
  onClose: () => void;
}) {
  const [a, setA] = useState(p.value);
  return (
    <EditorSheet
      title="Amount"
      onClose={p.onClose}
      onSave={() => p.onSave(a)}
      preview={describeAmount(a, p.env)}
    >
      <AmountFields value={a} onChange={setA} progressions={p.progressions} env={p.env} />
    </EditorSheet>
  );
}

// ------------------------------------------------------------------ facts

function enumOptions(f: FactInfo): { value: string; label: string }[] {
  if (f.value.type === 'enum') {
    const labels = f.value.labels;
    return f.value.values.map((v, i) => ({ value: str(v), label: labels?.[i] ?? str(v) }));
  }
  if (f.value.type === 'boolean')
    return [
      { value: 'true', label: 'yes' },
      { value: 'false', label: 'no' },
    ];
  return [];
}
const coerce = (f: FactInfo, s: string): string | number | boolean => {
  if (f.value.type === 'boolean') return s === 'true';
  if (f.value.type === 'enum' && f.value.values.some((v) => typeof v === 'number'))
    return Number(s);
  return s;
};

/** Chooses a fact and its arguments; reports the canonical ref `name:arg:arg`. */
export function FactRefFields(p: {
  env: BuilderEnv;
  value: string;
  onChange: (ref: string) => void;
  filter?: (f: FactInfo) => boolean;
  openBet: (field: string, cur: string, extra?: readonly string[]) => void;
}) {
  const facts = allFacts(p.env).filter(p.filter ?? (() => true));
  const [name, ...args] = p.value.split(':');
  const info = factByName(p.env, name!) ?? facts[0];
  const params: readonly FactParam[] = info?.params ?? [];
  // Parameter values: the last (greedy) one may contain colons, so re-join the tail.
  const argAt = (i: number): string =>
    i === params.length - 1 ? args.slice(i).join(':') : (args[i] ?? '');
  const set = (i: number, v: string) => {
    const next = params.map((_, j) => (j === i ? v : argAt(j)));
    p.onChange([info!.name, ...next].join(':'));
  };
  const group = (g: 'session' | 'game') => facts.filter((f) => f.group === g);
  return (
    <>
      <div class="field">
        <label for="fact-sel">What to look at</label>
        <select
          id="fact-sel"
          class="input"
          value={info?.name}
          onChange={(e) => {
            const f = factByName(p.env, e.currentTarget.value)!;
            p.onChange([f.name, ...f.params.map(defaultArg)].join(':'));
          }}
        >
          <optgroup label="Session">
            {group('session').map((f) => (
              <option key={f.name} value={f.name}>
                {f.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Game">
            {group('game').map((f) => (
              <option key={f.name} value={f.name}>
                {f.label}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      {params.map((pr, i) =>
        pr.type === 'number' ? (
          <NumField
            key={pr.name}
            label={pr.name === 'n' ? 'How many spins (n)' : pr.name}
            integer
            min={pr.min}
            max={pr.max}
            value={Number(argAt(i)) || pr.min || 1}
            onChange={(n) => set(i, str(n))}
          />
        ) : pr.type === 'enum' ? (
          <SelectField
            key={pr.name}
            label={pr.name}
            value={argAt(i)}
            options={(pr.values ?? []).map((v) => ({ value: str(v), label: str(v) }))}
            onChange={(v) => set(i, v)}
          />
        ) : (
          <BetButton
            key={pr.name}
            env={p.env}
            label={pr.name === 'target' ? 'Target' : pr.name}
            value={argAt(i)}
            onOpen={() =>
              p.openBet(
                `fact:${i}`,
                argAt(i),
                (pr.type as string) === 'target' ? p.env.extraTargets : undefined,
              )
            }
          />
        ),
      )}
    </>
  );
}
function defaultArg(pr: FactParam): string {
  if (pr.type === 'number') return str(pr.min ?? 1);
  if (pr.type === 'enum') return str(pr.values?.[0] ?? '');
  return 'red';
}

function ValueField(p: {
  f: FactInfo;
  value: string | number | boolean;
  onChange: (v: string | number | boolean) => void;
}) {
  const opts = enumOptions(p.f);
  return (
    <SelectField
      label="Value"
      value={str(p.value)}
      options={opts}
      onChange={(s) => p.onChange(coerce(p.f, s))}
    />
  );
}

// ------------------------------------------------------------------ conditions

type CKind = 'fact' | 'event' | 'streak' | 'countInLast' | 'since' | 'onTable' | 'everyN' | 'raw';
const C_KINDS: { value: CKind; label: string }[] = [
  { value: 'fact', label: 'A number or value' },
  { value: 'event', label: 'Something happened' },
  { value: 'streak', label: 'In a row' },
  { value: 'countInLast', label: 'Hits in the last n' },
  { value: 'since', label: 'Not seen for a while' },
  { value: 'onTable', label: 'A bet is on the table' },
  { value: 'everyN', label: 'Every n rounds' },
  { value: 'raw', label: 'Advanced (JSON)' },
];
const OPS = [
  { value: '<', label: 'is less than' },
  { value: '<=', label: 'is at most' },
  { value: '==', label: 'is exactly' },
  { value: '!=', label: 'is not' },
  { value: '>=', label: 'is at least' },
  { value: '>', label: 'is more than' },
];

function kindOf(c: Condition): CKind {
  const o = c as unknown as Obj;
  if (
    Array.isArray(o.cmp) &&
    typeof (o.cmp as unknown[])[0] === 'string' &&
    typeof (o.cmp as unknown[])[2] === 'number'
  )
    return 'fact';
  if (Array.isArray(o.fact) && !Array.isArray((o.fact as unknown[])[2])) return 'fact';
  if (typeof o.event === 'string') return 'event';
  if ('streak' in o) return 'streak';
  if ('countInLast' in o) return 'countInLast';
  if ('since' in o) return 'since';
  if (typeof o.onTable === 'string') return 'onTable';
  if (typeof o.everyN === 'number') return 'everyN';
  return 'raw';
}

function freshCondition(kind: CKind, env: BuilderEnv): Condition {
  const roundFact = allFacts(env).find(
    (f) => f.scope === 'round' && f.group === 'game' && enumOptions(f).length > 0,
  );
  const pred = roundFact
    ? { fact: roundFact.name, equals: coerce(roundFact, enumOptions(roundFact)[0]!.value) }
    : { event: 'bet-lost' };
  switch (kind) {
    case 'fact':
      return { cmp: ['net', '<=', -10000] };
    case 'event':
      return { event: 'bet-lost' };
    case 'streak':
      return { streak: { ...pred, atLeast: 3 } };
    case 'countInLast':
      return { countInLast: { ...pred, n: 10, atLeast: 6 } };
    case 'since':
      return { since: { ...pred, atLeast: 20 } };
    case 'onTable':
      return { onTable: 'red' };
    case 'everyN':
      return { everyN: 10 };
    case 'raw':
      return { always: true };
  }
}

function PredicateFields(p: {
  env: BuilderEnv;
  h: Obj;
  onChange: (h: Obj) => void;
  openBet: (field: string, cur: string, extra?: readonly string[]) => void;
  children?: ComponentChildren;
}) {
  const roundFacts = (f: FactInfo) => f.scope === 'round' && enumOptions(f).length > 0;
  const h = p.h;
  if (typeof h.fact !== 'string') {
    return (
      <JsonField label="Predicate (JSON)" value={h} onChange={(v) => isObj(v) && p.onChange(v)} />
    );
  }
  const info = factByName(p.env, str(h.fact).split(':')[0]!);
  const eq = Array.isArray(h.equals) ? (h.equals as unknown[])[0] : h.equals;
  return (
    <>
      <FactRefFields
        env={p.env}
        value={h.fact}
        filter={roundFacts}
        openBet={p.openBet}
        onChange={(ref) => {
          const f = factByName(p.env, ref.split(':')[0]!)!;
          p.onChange({ ...h, fact: ref, equals: coerce(f, enumOptions(f)[0]?.value ?? '') });
        }}
      />
      {info ? (
        <ValueField
          f={info}
          value={(eq as string | number | boolean) ?? ''}
          onChange={(v) => p.onChange({ ...h, equals: v })}
        />
      ) : null}
      {p.children}
    </>
  );
}

export function ConditionEditor(p: {
  env: BuilderEnv;
  value: Condition;
  negated?: boolean;
  onSave: (c: Condition, negated: boolean) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [c, setC] = useState<Condition>(p.value);
  const [neg, setNeg] = useState(p.negated ?? false);
  const kind = kindOf(c);
  const o = c as unknown as Obj;
  const content = useBetPick(
    p.env,
    (open) => (
      <>
        <SelectField
          label="Check"
          value={kind}
          options={C_KINDS}
          onChange={(k) => setC(freshCondition(k, p.env))}
        />
        {kind === 'fact' && <FactCondFields env={p.env} c={c} onChange={setC} open={open} />}
        {kind === 'event' && (
          <>
            <SelectField
              label="Event"
              value={str(o.event)}
              options={[
                { value: 'bet-won', label: 'a bet won' },
                { value: 'bet-lost', label: 'a bet lost' },
                { value: 'bet-push', label: 'a bet pushed' },
                { value: 'prog-cap', label: 'a progression hit its cap' },
                { value: 'prog-done', label: 'a progression finished' },
                ...p.env.facts.events.map((e) => ({ value: e.name, label: e.label })),
              ]}
              onChange={(event) => setC({ event })}
            />
            {['bet-won', 'bet-lost', 'bet-push'].includes(str(o.event)) ||
            p.env.facts.events
              .find((e) => e.name === o.event)
              ?.params?.some((q) => q.type === 'bet') ? (
              <BetButton
                env={p.env}
                label="Only for bet (optional)"
                value={str(o.bet ?? '')}
                onOpen={() => open('event.bet', str(o.bet ?? ''))}
              />
            ) : null}
            {str(o.event).startsWith('prog-') && (
              <TextField
                label="Progression name"
                value={str(o.prog ?? '')}
                onInput={(prog) => setC({ ...(o as object), event: o.event, prog } as Condition)}
              />
            )}
          </>
        )}
        {(kind === 'streak' || kind === 'countInLast' || kind === 'since') && (
          <HistoryFields env={p.env} kind={kind} o={o} setC={setC} open={open} />
        )}
        {kind === 'onTable' && (
          <BetButton
            env={p.env}
            label="Bet"
            value={str(o.onTable)}
            onOpen={() => open('onTable', str(o.onTable))}
          />
        )}
        {kind === 'everyN' && (
          <>
            <NumField
              label="Every n"
              integer
              min={1}
              value={Number(o.everyN)}
              onChange={(n) => setC({ ...(o as object), everyN: n })}
            />
            <SelectField
              label="Counting"
              value={str(o.of ?? 'round')}
              options={[
                { value: 'round', label: 'rounds of the session' },
                { value: 'stage', label: 'rounds in this stage' },
              ]}
              onChange={(of) => setC({ ...(o as object), of } as Condition)}
            />
          </>
        )}
        {kind === 'raw' && (
          <JsonField
            label="Condition (JSON)"
            value={c}
            onChange={(v) => isObj(v) && setC(v as unknown as Condition)}
          />
        )}
        {kind !== 'raw' && (
          <Toggle label="Invert (true when this is not the case)" checked={neg} onChange={setNeg} />
        )}
      </>
    ),
    (field, id) => setC(applyBet(p.env, c, field, id)),
  );
  return (
    <EditorSheet
      title="Condition"
      onClose={p.onClose}
      onSave={() => p.onSave(c, neg)}
      onDelete={p.onDelete}
      preview={neg ? `not (${describeCondition(c, p.env)})` : describeCondition(c, p.env)}
    >
      {content}
    </EditorSheet>
  );
}

function applyBet(env: BuilderEnv, c: Condition, field: string, id: string): Condition {
  const o = c as unknown as Obj;
  if (field === 'onTable') return { onTable: id };
  if (field === 'event.bet') return { ...o, bet: id } as unknown as Condition;
  if (field.startsWith('fact:')) return replaceFactArg(env, c, Number(field.slice(5)), id);
  return c;
}

/** Rewrites argument `i` of the fact ref inside whichever condition holds one. */
function replaceFactArg(env: BuilderEnv, c: Condition, i: number, id: string): Condition {
  const o = structuredClone(c) as unknown as Obj;
  const patch = (ref: string): string => {
    const [name, ...args] = ref.split(':');
    const params = factByName(env, name!)?.params ?? [];
    const vals = params.map((_, j) =>
      j === params.length - 1 ? args.slice(j).join(':') : (args[j] ?? ''),
    );
    vals[i] = id;
    return [name, ...vals].join(':');
  };
  if (Array.isArray(o.cmp)) (o.cmp as unknown[])[0] = patch(str((o.cmp as unknown[])[0]));
  else if (Array.isArray(o.fact)) (o.fact as unknown[])[0] = patch(str((o.fact as unknown[])[0]));
  else
    for (const k of ['streak', 'countInLast', 'since']) {
      const h = o[k];
      if (isObj(h) && typeof h.fact === 'string') h.fact = patch(h.fact);
    }
  return o as unknown as Condition;
}

function FactCondFields(p: {
  env: BuilderEnv;
  c: Condition;
  onChange: (c: Condition) => void;
  open: (f: string, cur: string, extra?: readonly string[]) => void;
}) {
  const o = p.c as unknown as Obj;
  const isCmp = Array.isArray(o.cmp);
  const tuple = (isCmp ? o.cmp : o.fact) as [string, string, string | number | boolean];
  const ref = tuple[0];
  const info = factByName(p.env, ref.split(':')[0]!);
  const numeric = info?.value.type === 'number';
  const build = (r: string, op: string, v: string | number | boolean): Condition => {
    const f = factByName(p.env, r.split(':')[0]!);
    return f?.value.type === 'number'
      ? ({ cmp: [r, op, typeof v === 'number' ? v : 0] } as Condition)
      : {
          fact: [
            r,
            op === '!=' ? '!=' : '==',
            typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' ? v : '',
          ],
        };
  };
  return (
    <>
      <FactRefFields
        env={p.env}
        value={ref}
        openBet={p.open}
        onChange={(r) => {
          const f = factByName(p.env, r.split(':')[0]!)!;
          const v = f.value.type === 'number' ? 0 : coerce(f, enumOptions(f)[0]?.value ?? '');
          p.onChange(build(r, '==', v));
        }}
      />
      <SelectField
        label="Comparison"
        value={tuple[1]}
        options={numeric ? OPS : OPS.filter((x) => x.value === '==' || x.value === '!=')}
        onChange={(op) => p.onChange(build(ref, op, tuple[2]))}
      />
      {numeric && info?.value.type === 'number' ? (
        <NumField
          label="Value"
          value={Number(tuple[2])}
          money={info.value.unit === 'money'}
          integer={info.value.unit !== 'scalar'}
          onChange={(n) => p.onChange(build(ref, tuple[1], n))}
        />
      ) : info ? (
        <ValueField
          f={info}
          value={tuple[2]}
          onChange={(v) => p.onChange(build(ref, tuple[1], v))}
        />
      ) : null}
    </>
  );
}

function HistoryFields(p: {
  env: BuilderEnv;
  kind: 'streak' | 'countInLast' | 'since';
  o: Obj;
  setC: (c: Condition) => void;
  open: (f: string, cur: string, extra?: readonly string[]) => void;
}) {
  const h = (p.o[p.kind] ?? {}) as Obj;
  const put = (next: Obj) => p.setC({ [p.kind]: next } as unknown as Condition);
  return (
    <PredicateFields env={p.env} h={h} onChange={put} openBet={p.open}>
      {p.kind === 'streak' && (
        <NumField
          label="At least this many in a row"
          integer
          min={1}
          value={Number(h.atLeast ?? 3)}
          onChange={(n) => put({ ...h, atLeast: n })}
        />
      )}
      {p.kind === 'countInLast' && (
        <>
          <NumField
            label="Among the last n"
            integer
            min={1}
            max={1000}
            value={Number(h.n ?? 10)}
            onChange={(n) => put({ ...h, n })}
          />
          <NumField
            label="At least this many"
            integer
            min={0}
            value={Number(h.atLeast ?? 0)}
            onChange={(n) => put({ ...h, atLeast: n })}
          />
        </>
      )}
      {p.kind === 'since' && (
        <NumField
          label="Not seen for at least (rounds)"
          integer
          min={0}
          value={Number(h.atLeast ?? 20)}
          onChange={(n) => put({ ...h, atLeast: n })}
        />
      )}
    </PredicateFields>
  );
}

// ------------------------------------------------------------------ effects

type EKind =
  | 'bet'
  | 'remove'
  | 'clear'
  | 'press'
  | 'set'
  | 'inc'
  | 'goto'
  | 'prog'
  | 'stop'
  | 'skipRound'
  | 'raw';
const E_KINDS: { value: EKind; label: string }[] = [
  { value: 'bet', label: 'Place a bet' },
  { value: 'remove', label: 'Remove a bet' },
  { value: 'clear', label: 'Take all bets down' },
  { value: 'press', label: 'Press a bet' },
  { value: 'set', label: 'Set a variable' },
  { value: 'inc', label: 'Add to a variable' },
  { value: 'goto', label: 'Go to a stage' },
  { value: 'prog', label: 'Change a progression' },
  { value: 'stop', label: 'Stop the session' },
  { value: 'skipRound', label: 'Sit out this round' },
  { value: 'raw', label: 'Advanced (JSON)' },
];
const effectKind = (e: Effect): EKind => {
  const o = e as unknown as Obj;
  for (const k of [
    'bet',
    'remove',
    'clear',
    'press',
    'set',
    'inc',
    'goto',
    'prog',
    'stop',
    'skipRound',
  ] as const) {
    if (k in o)
      return k === 'bet' &&
        Object.keys(o).some((x) => !['bet', 'amount', 'parent', 'working'].includes(x))
        ? 'raw'
        : k;
  }
  return 'raw';
};
export const EFFECT_VERBS = E_KINDS;

export function EffectEditor(p: {
  env: BuilderEnv;
  value: Effect;
  stages: string[];
  vars: string[];
  progressions: string[];
  onSave: (e: Effect) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [e, setE] = useState<Effect>(p.value);
  const o = e as unknown as Obj;
  const kind = effectKind(e);
  const set = (x: Obj) => setE(x as unknown as Effect);
  const content = useBetPick(
    p.env,
    (open) => (
      <>
        <SelectField
          label="Do"
          value={kind}
          options={E_KINDS}
          onChange={(k) => set(freshEffect(k, p))}
        />
        {(kind === 'bet' || kind === 'remove' || kind === 'press') && (
          <BetButton
            env={p.env}
            label="Bet"
            value={str(o[kind])}
            onOpen={() => open(kind, str(o[kind]))}
          />
        )}
        {kind === 'bet' && (
          <AmountFields
            value={amountFrom(o.amount)}
            env={p.env}
            progressions={p.progressions}
            allowKeep={false}
            onChange={(a) => set({ ...o, amount: amountTo(a) })}
          />
        )}
        {kind === 'press' && (
          <>
            <AmountFields
              value={amountFrom(o.by)}
              env={p.env}
              progressions={p.progressions}
              allowKeep={false}
              onChange={(a) => set({ ...o, by: amountTo(a) })}
            />
          </>
        )}
        {(kind === 'set' || kind === 'inc') && (
          <>
            <VarSelect
              vars={p.vars}
              value={str(o[kind])}
              onChange={(v) => set({ ...o, [kind]: v })}
            />
            <AmountFields
              value={amountFrom(kind === 'set' ? o.to : (o.by ?? 1))}
              env={p.env}
              progressions={p.progressions}
              allowKeep={false}
              plain
              onChange={(a) =>
                set(kind === 'set' ? { ...o, to: amountTo(a) } : { ...o, by: amountTo(a) })
              }
            />
          </>
        )}
        {kind === 'goto' && (
          <SelectField
            label="Stage"
            value={str(o.goto)}
            options={p.stages.map((s) => ({ value: s, label: s }))}
            onChange={(goto) => set({ ...o, goto })}
          />
        )}
        {kind === 'prog' && (
          <>
            <SelectField
              label="Progression"
              value={str(o.prog)}
              options={p.progressions.map((s) => ({ value: s, label: s }))}
              onChange={(prog) => set({ ...o, prog })}
            />
            <SelectField
              label="Operation"
              value={str(o.do)}
              options={['win', 'loss', 'push', 'reset', 'advance', 'back'].map((v) => ({
                value: v,
                label: v,
              }))}
              onChange={(d) => set({ ...o, do: d })}
            />
          </>
        )}
        {kind === 'stop' && (
          <TextField
            label="Reason"
            value={str(o.stop)}
            hint="Lowercase letters, digits and dashes."
            onInput={(stop) => set({ stop })}
          />
        )}
        {kind === 'raw' && (
          <JsonField
            label="Effect (JSON)"
            value={e}
            onChange={(v) => isObj(v) && setE(v as unknown as Effect)}
          />
        )}
      </>
    ),
    (field, id) => set({ ...o, [field]: id }),
  );
  return (
    <EditorSheet
      title="Effect"
      onClose={p.onClose}
      onSave={() => p.onSave(e)}
      onDelete={p.onDelete}
      preview={describeEffect(e, p.env)}
    >
      {content}
    </EditorSheet>
  );
}

function VarSelect(p: { vars: string[]; value: string; onChange: (v: string) => void }) {
  return p.vars.length === 0 ? (
    <p class="hint">No variables yet. Add one in the Variables section first.</p>
  ) : (
    <SelectField
      label="Variable"
      value={p.value}
      options={p.vars.map((v) => ({ value: v, label: v }))}
      onChange={p.onChange}
    />
  );
}

function freshEffect(
  k: EKind,
  p: { stages: string[]; vars: string[]; progressions: string[] },
): Effect {
  switch (k) {
    case 'bet':
      return { bet: 'red', amount: { units: 1 } };
    case 'remove':
      return { remove: 'red' };
    case 'clear':
      return { clear: true };
    case 'press':
      return { press: 'red', by: { units: 1 } };
    case 'set':
      return { set: p.vars[0] ?? 'x', to: 0 };
    case 'inc':
      return { inc: p.vars[0] ?? 'x' };
    case 'goto':
      return { goto: p.stages[0] ?? 'play' };
    case 'prog':
      return { prog: p.progressions[0] ?? 'm', do: 'reset' };
    case 'stop':
      return { stop: 'done' };
    case 'skipRound':
      return { skipRound: true };
    case 'raw':
      return { clear: true };
  }
}

// ------------------------------------------------------------------ progressions

export function ProgressionEditor(p: {
  env: BuilderEnv;
  name: string;
  spec: ProgressionSpec;
  existing: string[];
  onSave: (name: string, spec: ProgressionSpec) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(p.name);
  const [spec, setSpec] = useState<Obj>(p.spec as unknown as Obj);
  const [pick, setPick] = useState(false);
  const [rev, setRev] = useState(0);
  const track = spec.track;
  const dup = name !== p.name && p.existing.includes(name);
  const badName = !/^[a-z][a-z0-9-]{0,39}$/.test(name);
  if (pick) {
    return (
      <EditorSheet title="Track which bet" onClose={() => setPick(false)}>
        <BetPickView
          env={p.env}
          value={typeof track === 'string' ? track : undefined}
          onBack={() => setPick(false)}
          onPick={(id) => {
            formSet({ ...spec, track: id });
            setPick(false);
          }}
        />
      </EditorSheet>
    );
  }
  const kind = str(spec.kind);
  const fields = PROG_FIELDS[kind] ?? [];
  const formSet = (x: Obj) => {
    setSpec(x);
    setRev((r) => r + 1);
  };
  const setKey = (k: string, v: unknown) => {
    const n = { ...spec };
    if (v === undefined) delete n[k];
    else n[k] = v;
    formSet(n);
  };
  const unitsOf = (e: unknown): number | null | 'other' =>
    e === undefined
      ? null
      : isObj(e) && Object.keys(e).length === 1 && typeof e.units === 'number'
        ? e.units
        : 'other';
  const unitsField = (k: 'base' | 'maxAmount', label: string, hint: string) => {
    const u = unitsOf(spec[k]);
    return u === 'other' ? (
      <p class="hint" key={k}>
        {label} is a formula; edit it in the JSON below.
      </p>
    ) : (
      <NumField
        key={k}
        label={label}
        min={0}
        value={u ?? 0}
        hint={hint}
        onChange={(n) => setKey(k, n === 0 ? undefined : { units: n })}
      />
    );
  };
  return (
    <EditorSheet
      title="Progression"
      onClose={p.onClose}
      onSave={() => p.onSave(name, spec as unknown as ProgressionSpec)}
      saveDisabled={badName || dup}
      onDelete={p.onDelete}
    >
      <TextField
        label="Name"
        value={name}
        onInput={setName}
        hint="Lowercase letters, digits and dashes."
        error={
          badName
            ? 'Use lowercase letters, digits and dashes, starting with a letter.'
            : dup
              ? 'That name is taken.'
              : null
        }
      />
      <SelectField
        label="Kind"
        value={str(spec.kind)}
        options={PROGRESSION_KINDS.map((k) => ({ value: k, label: k }))}
        onChange={(k) => formSet(defaultSpec(k, track))}
      />
      <div class="field">
        <span class="field-label">Tracks</span>
        <div class="ed-row">
          <Segmented
            label="Tracks"
            value={track === 'round' ? 'round' : track === 'manual' ? 'manual' : 'bet'}
            options={[
              { value: 'bet', label: 'A bet' },
              { value: 'round', label: 'Each round' },
              { value: 'manual', label: 'Manual' },
            ]}
            onChange={(v) => (v === 'bet' ? setPick(true) : formSet({ ...spec, track: v }))}
          />
        </div>
        {typeof track === 'string' && track !== 'round' && track !== 'manual' ? (
          <p class="hint">Tracking {betLabel(p.env, track)}.</p>
        ) : null}
      </div>
      {fields.includes('maxSteps') ? (
        <NumField
          label={REQUIRED_STEPS.includes(kind) ? 'Maximum steps' : 'Maximum steps (0 = no limit)'}
          integer
          min={REQUIRED_STEPS.includes(kind) ? 1 : 0}
          value={Number(spec.maxSteps ?? 0)}
          onChange={(n) =>
            setKey('maxSteps', n === 0 && !REQUIRED_STEPS.includes(kind) ? undefined : n)
          }
        />
      ) : null}
      {fields.includes('multiplier') ? (
        <NumField
          label="Multiplier (0 = default)"
          min={0}
          value={Number(spec.multiplier ?? 0)}
          onChange={(n) => setKey('multiplier', n === 0 ? undefined : n)}
        />
      ) : null}
      {fields.includes('back') ? (
        <NumField
          label="Steps back after a win (0 = default)"
          integer
          min={0}
          value={Number(spec.back ?? 0)}
          onChange={(n) => setKey('back', n === 0 ? undefined : n)}
        />
      ) : null}
      {fields.includes('onCap') ? (
        <SelectField
          label="When the cap is reached"
          value={str(
            spec.onCap ?? (kind === 'martingale' || kind === 'grand-martingale' ? 'reset' : 'stay'),
          )}
          options={[
            { value: 'reset', label: 'reset' },
            { value: 'stay', label: 'stay at the cap' },
            { value: 'stop', label: 'stop the session' },
          ]}
          onChange={(onCap) => setKey('onCap', onCap)}
        />
      ) : null}
      {kind !== 'sequence'
        ? unitsField('base', 'Base amount (units, 0 = 1)', 'The first bet of each cycle.')
        : null}
      {unitsField(
        'maxAmount',
        'Cap on the bet (units, 0 = none)',
        'A step above this counts as the cap.',
      )}
      {kind === 'labouchere' || kind === 'sequence' ? (
        <p class="hint">
          {kind === 'labouchere' ? 'The line' : 'The amounts and rules'} are edited in the JSON
          below.
        </p>
      ) : null}
      <JsonField
        key={rev}
        label="Full specification (JSON)"
        value={spec}
        rows={8}
        onChange={(v) => isObj(v) && setSpec(v)}
      />
    </EditorSheet>
  );
}

const PROG_FIELDS: Record<string, string[]> = {
  flat: [],
  martingale: ['maxSteps', 'onCap', 'multiplier'],
  'grand-martingale': ['maxSteps', 'onCap'],
  fibonacci: ['maxSteps', 'back', 'onCap'],
  dalembert: ['maxSteps', 'onCap'],
  paroli: ['maxSteps', 'multiplier', 'onCap'],
  '1-3-2-6': [],
  'oscars-grind': ['maxSteps'],
  labouchere: [],
  sequence: [],
};
const REQUIRED_STEPS = ['martingale', 'grand-martingale'];

function defaultSpec(kind: string, track: unknown): Obj {
  const t = track ?? 'red';
  switch (kind) {
    case 'martingale':
    case 'grand-martingale':
      return { kind, track: t, maxSteps: 6, onCap: 'reset' };
    case 'fibonacci':
    case 'dalembert':
    case 'paroli':
    case 'oscars-grind':
      return { kind, track: t, maxSteps: 10 };
    case 'labouchere':
      return { kind, track: t, line: [1, 2, 3, 4] };
    case 'sequence':
      return {
        kind,
        track: t,
        amounts: [{ units: 1 }, { units: 2 }],
        onWin: 'reset',
        onLoss: 'advance',
      };
    default:
      return { kind, track: t };
  }
}
export { defaultSpec };
