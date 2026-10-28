// Builder | JSON tabs over one strategy document (strategy.md §13). The JSON tab validates live;
// the builder is offered only while the document is structurally a strategy.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Diagnostic, StrategyDefinition } from '@core/contracts/strategy';
import { Segmented, useId } from '../kit';
import { Builder } from './Builder';
import type { BuilderEnv } from './env';

const BLOCKING = ['E_TYPE', 'E_REQUIRED', 'E_ONE_OF', 'E_UNKNOWN_KEY', 'E_SCHEMA_VERSION'];

/** Diagnostics after which the builder cannot show the document. */
export function builderBlockers(value: unknown, structural: readonly Diagnostic[]): Diagnostic[] {
  const o = value as { stages?: unknown } | null;
  if (typeof value !== 'object' || value === null || !Array.isArray(o?.stages)) {
    return [
      {
        code: 'E_TYPE',
        severity: 'error',
        path: '',
        message: 'The document must be an object with a stages list.',
      },
    ];
  }
  return structural.filter((d) => d.severity === 'error' && BLOCKING.includes(d.code));
}

export interface StrategyEditorProps {
  /** The strategy document; may be invalid. */
  value: unknown;
  onChange: (next: unknown) => void;
  env: BuilderEnv;
  /** Every diagnostic (plugin context), JSON-pointer paths into the strategy. */
  diagnostics: readonly Diagnostic[];
  /** Structural-only diagnostics, used to gate the builder. */
  structural: readonly Diagnostic[];
}

export function StrategyEditor(p: StrategyEditorProps) {
  const [tab, setTab] = useState<'builder' | 'json'>('builder');
  const blockers = builderBlockers(p.value, p.structural);
  const showJson = tab === 'json' || blockers.length > 0;
  return (
    <div class="strategy-editor">
      <Segmented
        label="Editor"
        value={showJson ? 'json' : 'builder'}
        options={[
          { value: 'builder', label: 'Builder' },
          { value: 'json', label: 'JSON' },
        ]}
        onChange={(v) => {
          if (v === 'builder' && blockers.length > 0) return;
          setTab(v);
        }}
      />
      {blockers.length > 0 ? (
        <p class="b-err-note" role="status">
          The builder is unavailable until the JSON has the right shape ({blockers[0]!.message}).
        </p>
      ) : null}
      {showJson ? (
        <JsonTab value={p.value} onChange={p.onChange} />
      ) : (
        <Builder
          value={p.value as StrategyDefinition}
          onChange={p.onChange}
          env={p.env}
          diagnostics={p.diagnostics}
        />
      )}
    </div>
  );
}

function JsonTab(p: { value: unknown; onChange: (v: unknown) => void }) {
  const id = useId('strategy-json');
  const last = useRef<unknown>(p.value);
  const [text, setText] = useState(() => JSON.stringify(p.value, null, 2));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (p.value !== last.current) {
      last.current = p.value;
      setText(JSON.stringify(p.value, null, 2));
      setErr(null);
    }
  }, [p.value]);
  return (
    <div class="field">
      <label for={id}>Strategy JSON</label>
      <textarea
        id={id}
        class="input json-area json-area--big"
        rows={18}
        spellcheck={false}
        value={text}
        aria-invalid={err ? 'true' : undefined}
        aria-describedby={err ? `${id}-err` : undefined}
        onInput={(e) => {
          const t = e.currentTarget.value;
          setText(t);
          try {
            const v: unknown = JSON.parse(t);
            last.current = v;
            setErr(null);
            p.onChange(v);
          } catch (x) {
            setErr(x instanceof Error ? x.message : 'Not valid JSON');
          }
        }}
      />
      {err ? (
        <p class="error" id={`${id}-err`} role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}
