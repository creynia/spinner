// The strategy builder (strategy.md §13; architecture.md §6.3): stages as reorderable cards, each
// with a layout list and rule rows that read as sentences. Edits flow model -> JSON on every change.
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import type { Condition, Diagnostic, Effect, StrategyDefinition } from '../../contracts/strategy';
import { Button, Select, Toggle } from '../kit';
import { describeAmount, describeChip, describeEffect } from './describe';
import {
  AmountEditor,
  BetPickView,
  ConditionEditor,
  EditorSheet,
  EffectEditor,
  ProgressionEditor,
} from './editors';
import { betLabel, diagsAt, type BuilderEnv } from './env';
import { NumField, SelectField, TextField } from './fields';
import {
  chipFromCond,
  chipToCondition,
  emptyStage,
  freshSlug,
  fromJson,
  moveItem,
  toJson,
  type AmountModel,
  type BuilderModel,
  type ConditionChip,
  type ConditionChips,
  type LayoutRow,
  type RuleRow,
} from './model';
import './builder.css';

export interface BuilderProps {
  value: StrategyDefinition;
  onChange: (next: StrategyDefinition) => void;
  env: BuilderEnv;
  diagnostics: readonly Diagnostic[];
}

type Where = { si: number; ri: number } | { si: number; li: number };
type Ed =
  | { t: 'bet'; si: number; li: number }
  | { t: 'amount'; si: number; li: number }
  | { t: 'cond'; at: Where; ci: number | 'new' }
  | { t: 'effect'; si: number; list: 'then' | 'onEnter' | 'onExit'; ri: number; ei: number | 'new' }
  | { t: 'prog'; name: string | null }
  | { t: 'rule'; si: number; ri: number }
  | { t: 'stage'; si: number }
  | { t: 'delstage'; si: number };

const isRuleAt = (w: Where): w is { si: number; ri: number } => 'ri' in w;

function ErrorList({ id, diags }: { id: string; diags: readonly Diagnostic[] }) {
  if (diags.length === 0) return null;
  return (
    <ul class="b-errs" id={id}>
      {diags.map((d, i) => (
        <li key={i} class={d.severity === 'error' ? 'b-err' : 'b-warn'}>
          <span class="b-sev">{d.severity === 'error' ? 'Error' : 'Warning'}</span> {d.message}{' '}
          <code class="b-code">{d.code}</code>
        </li>
      ))}
    </ul>
  );
}

function BChip(p: {
  text: string;
  onClick: () => void;
  diags?: readonly Diagnostic[];
  describedBy?: string;
  label?: string;
}) {
  const bad = p.diags?.some((d) => d.severity === 'error');
  const warn = !bad && (p.diags?.length ?? 0) > 0;
  return (
    <button
      type="button"
      class={`bchip${bad ? ' bchip--err' : warn ? ' bchip--warn' : ''}`}
      onClick={p.onClick}
      aria-describedby={p.describedBy}
      aria-label={p.label ? `${p.label}: ${p.text}${bad ? ' (has an error)' : ''}` : undefined}
    >
      {bad ? (
        <span aria-hidden="true" class="bchip-mark">
          !
        </span>
      ) : null}
      {p.text}
    </button>
  );
}

function IconBtn(p: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      class="b-icon"
      aria-label={p.label}
      disabled={p.disabled}
      onClick={p.onClick}
    >
      <span aria-hidden="true">{p.children}</span>
    </button>
  );
}

function Tools(p: {
  noun: string;
  index: number;
  count: number;
  onMove: (to: number) => void;
  onDelete: () => void;
}) {
  const n = p.index + 1;
  // After a move the list re-renders with the item at its new place: put focus back on its button.
  const move = (to: number, dir: 'up' | 'down') => {
    p.onMove(to);
    setTimeout(() => {
      const want = (d: string) =>
        document.querySelector<HTMLButtonElement>(
          `button[aria-label="Move ${p.noun} ${to + 1} ${d}"]`,
        );
      const first = want(dir);
      (first && !first.disabled ? first : want(dir === 'up' ? 'down' : 'up'))?.focus();
    }, 30);
  };
  return (
    <span class="b-tools">
      <IconBtn
        label={`Move ${p.noun} ${n} up`}
        disabled={p.index === 0}
        onClick={() => move(p.index - 1, 'up')}
      >
        {'\u2191'}
      </IconBtn>
      <IconBtn
        label={`Move ${p.noun} ${n} down`}
        disabled={p.index === p.count - 1}
        onClick={() => move(p.index + 1, 'down')}
      >
        {'\u2193'}
      </IconBtn>
      <IconBtn label={`Delete ${p.noun} ${n}`} onClick={p.onDelete}>
        {'\u00d7'}
      </IconBtn>
    </span>
  );
}

function WhenChips(p: {
  when: ConditionChips;
  basePath: string;
  env: BuilderEnv;
  diags: readonly Diagnostic[];
  onEdit: (ci: number) => void;
  onAdd: () => void;
  onMode: (m: 'all' | 'any') => void;
  addLabel: string;
}) {
  const { when } = p;
  if (when.chips.length === 0)
    return (
      <>
        <span class="b-always">always</span>
        <button type="button" class="b-add" onClick={p.onAdd}>
          {p.addLabel}
        </button>
      </>
    );
  return (
    <>
      {when.chips.map((c: ConditionChip, i) => {
        const path = when.chips.length > 1 ? `${p.basePath}/${when.mode}/${i}` : p.basePath;
        return (
          <>
            {i > 0 ? (
              <button
                type="button"
                class="b-joiner"
                aria-label={`Joined with ${when.mode === 'all' ? 'and' : 'or'}; switch to ${when.mode === 'all' ? 'or' : 'and'}`}
                onClick={() => p.onMode(when.mode === 'all' ? 'any' : 'all')}
              >
                {when.mode === 'all' ? 'and' : 'or'}
              </button>
            ) : null}
            <BChip
              key={i}
              text={describeChip(c, p.env)}
              diags={diagsAt(p.diags, path)}
              onClick={() => p.onEdit(i)}
              label={`Condition ${i + 1}`}
            />
          </>
        );
      })}
      <button type="button" class="b-add" onClick={p.onAdd}>
        {p.addLabel}
      </button>
    </>
  );
}

export function Builder({ value, onChange, env, diagnostics }: BuilderProps) {
  const model = useMemo(() => fromJson(value), [value]);
  const [ed, setEd] = useState<Ed | null>(null);
  const close = () => setEd(null);
  const mutate = (
    fn: (m: BuilderModel) => void,
    post?: (j: StrategyDefinition) => StrategyDefinition,
  ) => {
    const m = structuredClone(model);
    fn(m);
    const json = toJson(m);
    onChange(post ? post(json) : json);
  };
  const stageIds = model.stages.map((s) => s.id);
  const varNames = (model.vars ?? []).map((v) => v.name);
  const progNames = (model.progressions ?? []).map((p) => p.name);

  const rename = (m: BuilderModel, from: string, to: string) => {
    const fix = (e: Effect): Effect =>
      (e as { goto?: string }).goto === from ? { ...e, goto: to } : e;
    for (const s of m.stages) {
      if (s.extends === from) s.extends = to;
      for (const r of s.rules) r.then = r.then.map((c) => ({ effect: fix(c.effect) }));
    }
  };

  const stageCards = model.stages.map((s, si) => {
    const sp = `/stages/${si}`;
    const hookDiags = diagnostics.some(
      (d) => d.path.startsWith(`${sp}/onEnter`) || d.path.startsWith(`${sp}/onExit`),
    );
    return (
      <li key={s.id} class="bstage" id={`b-stage-${si}`}>
        <section aria-labelledby={`stage-h-${si}`}>
          <header class="bstage-head">
            <h4 id={`stage-h-${si}`} class="bstage-title">
              Stage {si + 1}: {s.label ?? s.id}
              {si === 0 ? <span class="b-pill">entry</span> : null}
            </h4>
            <span class="b-tools">
              <button type="button" class="btn" onClick={() => setEd({ t: 'stage', si })}>
                Stage settings
              </button>
              <Tools
                noun="stage"
                index={si}
                count={model.stages.length}
                onMove={(to) => mutate((m) => (m.stages = moveItem(m.stages, si, to)))}
                onDelete={() => setEd({ t: 'delstage', si })}
              />
            </span>
          </header>
          <ErrorList
            id={`stage-e-${si}`}
            diags={diagnostics.filter(
              (d) =>
                d.path === sp ||
                (/^\/stages\/\d+\/(id|extends|label)$/.test(d.path) && d.path.startsWith(sp + '/')),
            )}
          />

          <h5 class="bsec">Layout</h5>
          <ul class="blist" aria-label={`Stage ${si + 1} layout`}>
            {s.layout.length === 0 ? <li class="muted">No bets placed in this stage.</li> : null}
            {s.layout.map((l: LayoutRow, li) => {
              const lp = `${sp}/layout/${li}`;
              const ds = diagsAt(diagnostics, lp);
              return (
                <li key={li} class="blayout" id={`b-lay-${si}-${li}`}>
                  <div class="brow">
                    <span class="bkw">bet</span>
                    <BChip
                      text={betLabel(env, l.bet)}
                      diags={diagsAt(diagnostics, `${lp}/bet`)}
                      onClick={() => setEd({ t: 'bet', si, li })}
                      label="Bet"
                    />
                    <span class="bkw">for</span>
                    <BChip
                      text={describeAmount(l.amount, env)}
                      diags={diagsAt(diagnostics, `${lp}/amount`)}
                      onClick={() => setEd({ t: 'amount', si, li })}
                      label="Amount"
                    />
                    {l.when ? (
                      <>
                        <span class="bkw">when</span>
                        <WhenChips
                          when={l.when}
                          basePath={`${lp}/when`}
                          env={env}
                          diags={diagnostics}
                          addLabel="+ condition"
                          onEdit={(ci) => setEd({ t: 'cond', at: { si, li }, ci })}
                          onAdd={() => setEd({ t: 'cond', at: { si, li }, ci: 'new' })}
                          onMode={(mode) =>
                            mutate((m) => (m.stages[si]!.layout[li]!.when!.mode = mode))
                          }
                        />
                      </>
                    ) : (
                      <button
                        type="button"
                        class="b-add"
                        onClick={() => setEd({ t: 'cond', at: { si, li }, ci: 'new' })}
                      >
                        + only when…
                      </button>
                    )}
                    <Tools
                      noun={`bet in stage ${si + 1}, row`}
                      index={li}
                      count={s.layout.length}
                      onMove={(to) =>
                        mutate(
                          (m) => (m.stages[si]!.layout = moveItem(m.stages[si]!.layout, li, to)),
                        )
                      }
                      onDelete={() => mutate((m) => m.stages[si]!.layout.splice(li, 1))}
                    />
                  </div>
                  <ErrorList id={`lay-e-${si}-${li}`} diags={ds} />
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            class="btn"
            onClick={() =>
              mutate((m) => {
                m.stages[si]!.layout.push({
                  bet: 'red',
                  amount: { kind: 'units', n: 1 },
                  extra: {},
                });
                setEd({ t: 'bet', si, li: m.stages[si]!.layout.length - 1 });
              })
            }
          >
            Add bet
          </button>

          <h5 class="bsec">Rules</h5>
          <ol class="blist" aria-label={`Stage ${si + 1} rules`}>
            {s.rules.length === 0 ? (
              <li class="muted">No rules: this stage never changes.</li>
            ) : null}
            {s.rules.map((r: RuleRow, ri) => {
              const rp = `${sp}/rules/${ri}`;
              const ds = diagsAt(diagnostics, rp);
              return (
                <li
                  key={ri}
                  id={`b-rule-${si}-${ri}`}
                  class={`brule${r.enabled ? '' : ' brule--off'}`}
                >
                  <div class="brow brow--sentence">
                    <span class="bkw">when</span>
                    <WhenChips
                      when={r.when}
                      basePath={`${rp}/when`}
                      env={env}
                      diags={diagnostics}
                      addLabel="+ condition"
                      onEdit={(ci) => setEd({ t: 'cond', at: { si, ri }, ci })}
                      onAdd={() => setEd({ t: 'cond', at: { si, ri }, ci: 'new' })}
                      onMode={(mode) => mutate((m) => (m.stages[si]!.rules[ri]!.when.mode = mode))}
                    />
                    <span class="bkw">then</span>
                    {r.then.map((c, ei) => (
                      <>
                        {ei > 0 ? <span class="b-comma">,</span> : null}
                        <BChip
                          key={ei}
                          text={describeEffect(c.effect, env)}
                          diags={diagsAt(diagnostics, `${rp}/then/${ei}`)}
                          onClick={() => setEd({ t: 'effect', si, list: 'then', ri, ei })}
                          describedBy={ds.length ? `rule-e-${si}-${ri}` : undefined}
                          label={`Effect ${ei + 1}`}
                        />
                      </>
                    ))}
                    <button
                      type="button"
                      class="b-add"
                      onClick={() => setEd({ t: 'effect', si, list: 'then', ri, ei: 'new' })}
                    >
                      + effect
                    </button>
                  </div>
                  <div class="brow brow--meta">
                    {r.once !== false ? (
                      <span class="b-pill">{r.once === 'stage' ? 'once per stage' : 'once'}</span>
                    ) : null}
                    {r.cooldown ? <span class="b-pill">cooldown {r.cooldown}</span> : null}
                    {!r.enabled ? <span class="b-pill">off</span> : null}
                    {r.label ? <span class="muted">{r.label}</span> : null}
                    <button
                      type="button"
                      class="b-add"
                      onClick={() => setEd({ t: 'rule', si, ri })}
                    >
                      Rule options
                    </button>
                    <Tools
                      noun={`rule in stage ${si + 1}, rule`}
                      index={ri}
                      count={s.rules.length}
                      onMove={(to) =>
                        mutate((m) => (m.stages[si]!.rules = moveItem(m.stages[si]!.rules, ri, to)))
                      }
                      onDelete={() => mutate((m) => m.stages[si]!.rules.splice(ri, 1))}
                    />
                  </div>
                  <ErrorList id={`rule-e-${si}-${ri}`} diags={ds} />
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            class="btn"
            onClick={() =>
              mutate((m) => {
                m.stages[si]!.rules.push({
                  enabled: true,
                  when: { mode: 'all', chips: [] },
                  then: [{ effect: { skipRound: true } }],
                  once: false,
                  extra: {},
                });
              })
            }
          >
            Add rule
          </button>

          <details class="bhooks" open={hookDiags ? true : undefined}>
            <summary>On enter and on exit</summary>
            {(['onEnter', 'onExit'] as const).map((list) => (
              <div class="brow" key={list}>
                <span class="bkw">{list === 'onEnter' ? 'on enter' : 'on exit'}</span>
                {s[list].map((c, ei) => (
                  <BChip
                    key={ei}
                    text={describeEffect(c.effect, env)}
                    diags={diagsAt(diagnostics, `${sp}/${list}/${ei}`)}
                    onClick={() => setEd({ t: 'effect', si, list, ri: -1, ei })}
                    label={`${list} effect ${ei + 1}`}
                  />
                ))}
                <button
                  type="button"
                  class="b-add"
                  onClick={() => setEd({ t: 'effect', si, list, ri: -1, ei: 'new' })}
                >
                  + effect
                </button>
              </div>
            ))}
          </details>
        </section>
      </li>
    );
  });

  // ---------------------------------------------------------------- editor sheets
  let sheet: ComponentChildren = null;
  if (ed) {
    switch (ed.t) {
      case 'bet': {
        const cur = model.stages[ed.si]?.layout[ed.li]?.bet;
        sheet = (
          <EditorSheet title="Choose a bet" onClose={close}>
            <BetPickView
              env={env}
              value={cur}
              onBack={close}
              onPick={(id) => {
                mutate((m) => (m.stages[ed.si]!.layout[ed.li]!.bet = id));
                close();
              }}
            />
          </EditorSheet>
        );
        break;
      }
      case 'amount': {
        const row = model.stages[ed.si]?.layout[ed.li];
        if (row)
          sheet = (
            <AmountEditor
              env={env}
              value={row.amount}
              progressions={progNames}
              onClose={close}
              onSave={(a: AmountModel) => {
                mutate((m) => (m.stages[ed.si]!.layout[ed.li]!.amount = a));
                close();
              }}
            />
          );
        break;
      }
      case 'cond': {
        const w = ed.at;
        const st = model.stages[w.si];
        const holder = st
          ? isRuleAt(w)
            ? st.rules[w.ri]?.when
            : st.layout[w.li]?.when
          : undefined;
        const chip = ed.ci === 'new' ? undefined : holder?.chips[ed.ci];
        const negated = chip?.kind === 'not';
        const cond: Condition = chip
          ? chip.kind === 'not'
            ? chipToCondition(chip.chip)
            : chipToCondition(chip)
          : { cmp: ['net', '<=', -10000] };
        const put = (fn: (c: ConditionChips) => void) =>
          mutate((m) => {
            const s2 = m.stages[w.si]!;
            if (isRuleAt(w)) fn(s2.rules[w.ri]!.when);
            else {
              s2.layout[w.li]!.when ??= { mode: 'all', chips: [] };
              fn(s2.layout[w.li]!.when!);
              if (s2.layout[w.li]!.when!.chips.length === 0) delete s2.layout[w.li]!.when;
            }
          });
        sheet = (
          <ConditionEditor
            env={env}
            value={cond}
            negated={negated}
            onClose={close}
            onSave={(c, neg) => {
              const next = chipFromCond(neg ? { not: c } : c);
              put((when) => {
                if (ed.ci === 'new') when.chips.push(next);
                else when.chips[ed.ci] = next;
              });
              close();
            }}
            onDelete={
              ed.ci === 'new'
                ? undefined
                : () => {
                    put((when) => when.chips.splice(ed.ci as number, 1));
                    close();
                  }
            }
          />
        );
        break;
      }
      case 'effect': {
        const st = model.stages[ed.si];
        const list = st ? (ed.list === 'then' ? st.rules[ed.ri]?.then : st[ed.list]) : undefined;
        const cur = ed.ei === 'new' ? ({ skipRound: true } as Effect) : list?.[ed.ei]?.effect;
        if (cur)
          sheet = (
            <EffectEditor
              env={env}
              value={cur}
              stages={stageIds}
              vars={varNames}
              progressions={progNames}
              onClose={close}
              onSave={(e) => {
                mutate((m) => {
                  const s2 = m.stages[ed.si]!;
                  const l = ed.list === 'then' ? s2.rules[ed.ri]!.then : s2[ed.list];
                  if (ed.ei === 'new') l.push({ effect: e });
                  else l[ed.ei] = { effect: e };
                  if (ed.list !== 'then') s2.has[ed.list] = true;
                });
                close();
              }}
              onDelete={
                ed.ei === 'new'
                  ? undefined
                  : () => {
                      mutate((m) => {
                        const s2 = m.stages[ed.si]!;
                        (ed.list === 'then' ? s2.rules[ed.ri]!.then : s2[ed.list]).splice(
                          ed.ei as number,
                          1,
                        );
                      });
                      close();
                    }
              }
            />
          );
        break;
      }
      case 'prog': {
        const cur =
          ed.name === null ? undefined : model.progressions?.find((p) => p.name === ed.name);
        sheet = (
          <ProgressionEditor
            env={env}
            name={cur?.name ?? freshSlug('prog', progNames)}
            spec={cur?.spec ?? { kind: 'martingale', track: 'red', maxSteps: 6, onCap: 'reset' }}
            existing={progNames}
            onClose={close}
            onSave={(name, spec) => {
              mutate(
                (m) => {
                  m.progressions ??= [];
                  const i = m.progressions.findIndex((p) => p.name === ed.name);
                  if (i >= 0) {
                    m.progressions[i] = { name, spec };
                  } else m.progressions.push({ name, spec });
                },
                (j) =>
                  ed.name && name !== ed.name
                    ? renameRefs(j, ['prog', 'progStep', 'progCaps'], ed.name, name)
                    : j,
              );
              close();
            }}
            onDelete={
              cur
                ? () => {
                    mutate((m) => {
                      m.progressions = m.progressions!.filter((p) => p.name !== cur.name);
                      if (m.progressions.length === 0) delete m.progressions;
                    });
                    close();
                  }
                : undefined
            }
          />
        );
        break;
      }
      case 'rule': {
        const r = model.stages[ed.si]?.rules[ed.ri];
        if (r)
          sheet = (
            <RuleOptions
              rule={r}
              onClose={close}
              onSave={(n) => {
                mutate((m) => (m.stages[ed.si]!.rules[ed.ri] = n));
                close();
              }}
            />
          );
        break;
      }
      case 'delstage': {
        const s = model.stages[ed.si];
        if (s)
          sheet = (
            <EditorSheet title="Delete this stage?" onClose={close}>
              <p>
                Delete stage <strong>{s.label ?? s.id}</strong> with its {s.layout.length} bets and{' '}
                {s.rules.length} rules? Go-to effects that point at it will show an error.
              </p>
              <div class="ed-actions">
                <Button
                  variant="danger"
                  onClick={() => {
                    mutate((m) => m.stages.splice(ed.si, 1));
                    close();
                  }}
                >
                  Delete stage
                </Button>
                <Button onClick={close}>Cancel</Button>
              </div>
            </EditorSheet>
          );
        break;
      }
      case 'stage': {
        const s = model.stages[ed.si];
        if (s)
          sheet = (
            <StageOptions
              stage={s}
              others={stageIds.filter((x) => x !== s.id)}
              onClose={close}
              onSave={(id, label, ext) => {
                mutate((m) => {
                  const st = m.stages[ed.si]!;
                  const old = st.id;
                  st.id = id;
                  if (label) st.label = label;
                  else delete st.label;
                  if (ext) st.extends = ext;
                  else delete st.extends;
                  if (old !== id) rename(m, old, id);
                });
                close();
              }}
            />
          );
      }
    }
  }

  return (
    <div class="builder">
      <section class="bmeta" aria-label="Strategy name">
        <TextField
          label="Strategy name"
          value={model.head.name}
          onInput={(name) => mutate((m) => (m.head.name = name))}
        />
      </section>

      <section aria-labelledby="b-vars-h">
        <h3 id="b-vars-h" class="bsec">
          Variables
        </h3>
        {(model.vars ?? []).length === 0 ? (
          <p class="muted">None. Variables remember numbers between rounds.</p>
        ) : null}
        <ul class="blist">
          {(model.vars ?? []).map((v, i) => (
            <li key={i} class="bvar">
              <TextField
                label={`Variable ${i + 1} name`}
                value={v.name}
                onInput={(name) => {
                  const old = v.name;
                  mutate(
                    (m) => (m.vars![i]!.name = name),
                    (j) => renameRefs(j, ['set', 'inc', 'var'], old, name),
                  );
                }}
              />
              <NumField
                label={`Variable ${i + 1} starts at`}
                value={v.initial}
                onChange={(n) => mutate((m) => (m.vars![i]!.initial = n))}
              />
              <IconBtn
                label={`Delete variable ${i + 1}`}
                onClick={() =>
                  mutate((m) => {
                    m.vars!.splice(i, 1);
                    if (m.vars!.length === 0) delete m.vars;
                  })
                }
              >
                {'×'}
              </IconBtn>
            </li>
          ))}
        </ul>
        <button
          type="button"
          class="btn"
          onClick={() =>
            mutate((m) => {
              m.vars ??= [];
              m.vars.push({
                name: freshSlug(
                  'v',
                  m.vars.map((x) => x.name),
                ).replace(/-/g, '_'),
                initial: 0,
              });
            })
          }
        >
          Add variable
        </button>
      </section>

      <section aria-labelledby="b-prog-h">
        <h3 id="b-prog-h" class="bsec">
          Progressions
        </h3>
        {(model.progressions ?? []).length === 0 ? (
          <p class="muted">
            None. A progression sizes a bet after wins and losses (Martingale, Fibonacci...).
          </p>
        ) : null}
        <div class="brow">
          {(model.progressions ?? []).map((p) => (
            <BChip
              key={p.name}
              text={`${p.name}: ${p.spec.kind}`}
              diags={diagnostics.filter((d) => d.path.startsWith(`/progressions/${p.name}`))}
              onClick={() => setEd({ t: 'prog', name: p.name })}
              label="Progression"
            />
          ))}
          <button type="button" class="btn" onClick={() => setEd({ t: 'prog', name: null })}>
            Add progression
          </button>
        </div>
      </section>

      <section aria-labelledby="b-stages-h">
        <h3 id="b-stages-h" class="bsec bsec--big">
          Stages
        </h3>
        <ol class="bstages">{stageCards}</ol>
        <button
          type="button"
          class="btn"
          onClick={() => mutate((m) => m.stages.push(emptyStage(m.stages.map((s) => s.id))))}
        >
          Add stage
        </button>
      </section>
      {sheet}
    </div>
  );
}

/** Rewrites references (`{ prog: x }`, `{ set: v }`, ...) to a renamed progression or variable. */
function renameRefs(
  def: StrategyDefinition,
  keys: string[],
  from: string,
  to: string,
): StrategyDefinition {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
        out[k] = keys.includes(k) && v === from ? to : walk(v);
      }
      return out;
    }
    return x;
  };
  const d = def as unknown as Record<string, unknown>;
  return {
    ...d,
    stages: walk(d.stages),
    ...(d.progressions ? { progressions: walk(d.progressions) } : {}),
  } as unknown as StrategyDefinition;
}

function RuleOptions(p: { rule: RuleRow; onClose: () => void; onSave: (r: RuleRow) => void }) {
  const [r, setR] = useState(p.rule);
  const [cool, setCool] = useState(r.cooldown !== undefined);
  return (
    <EditorSheet
      title="Rule options"
      onClose={p.onClose}
      onSave={() => p.onSave({ ...r, cooldown: cool ? r.cooldown : undefined })}
    >
      <TextField
        label="Label (optional)"
        value={r.label ?? ''}
        onInput={(v) => setR({ ...r, label: v || undefined })}
      />
      <Toggle
        label="Rule is on"
        checked={r.enabled}
        onChange={(enabled) => setR({ ...r, enabled })}
      />
      <SelectField
        label="How often"
        value={r.once === false ? 'every' : r.once === true ? 'once' : 'stage'}
        options={[
          { value: 'every', label: 'Every time it applies' },
          { value: 'once', label: 'Once per session' },
          { value: 'stage', label: 'Once each time the stage is entered' },
        ]}
        onChange={(v) =>
          setR({ ...r, once: v === 'every' ? false : v === 'once' ? true : 'stage' })
        }
      />
      <Toggle
        label="Pause after firing (cooldown)"
        checked={cool}
        onChange={(c) => {
          setCool(c);
          if (c && r.cooldown === undefined) setR({ ...r, cooldown: 1 });
        }}
      />
      {cool ? (
        <NumField
          label="Skip this many rounds"
          integer
          min={1}
          value={r.cooldown ?? 1}
          onChange={(n) => setR({ ...r, cooldown: n })}
        />
      ) : null}
    </EditorSheet>
  );
}

function StageOptions(p: {
  stage: BuilderModel['stages'][number];
  others: string[];
  onClose: () => void;
  onSave: (id: string, label: string, ext: string) => void;
}) {
  const [id, setId] = useState(p.stage.id);
  const [label, setLabel] = useState(p.stage.label ?? '');
  const [ext, setExt] = useState(p.stage.extends ?? '');
  const bad = !/^[a-z][a-z0-9-]{0,39}$/.test(id) || (id !== p.stage.id && p.others.includes(id));
  return (
    <EditorSheet
      title="Stage settings"
      onClose={p.onClose}
      onSave={() => p.onSave(id, label, ext)}
      saveDisabled={bad}
    >
      <TextField
        label="Stage id"
        value={id}
        onInput={setId}
        hint="Used by go-to effects."
        error={
          bad ? 'Lowercase letters, digits and dashes, starting with a letter, and unique.' : null
        }
      />
      <TextField label="Label (optional)" value={label} onInput={setLabel} />
      <div class="field">
        <label for="stage-ext">Inherit layout and rules from</label>
        <Select
          id="stage-ext"
          value={ext}
          options={[
            { value: '', label: 'Nothing' },
            ...p.others.map((o) => ({ value: o, label: o })),
          ]}
          onChange={setExt}
        />
      </div>
    </EditorSheet>
  );
}
