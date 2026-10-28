// "Use a saved layout" (layouts.md §4.7, §7.2): library and built-in layouts with thumbnails.
// Picking one copies it into the stage; the caller sets `from`.
import type { Cents } from '../../contracts/game';
import { Button, Sheet } from '../kit';
import { plural, totalChips } from '../layout/adjust';
import { LayoutThumb } from '../layout/LayoutThumb';
import type { BuilderChipsEnv, LayoutChoice } from '../layout/types';

export interface LayoutPickSheetProps {
  env: BuilderChipsEnv<unknown>;
  rules: unknown;
  /** Null while the library is loading (or could not be read). */
  choices: readonly LayoutChoice[] | null;
  /** Only layouts drawn on this rules preset are offered; absent: all. */
  variant?: string;
  /** Money to draw the thumbnails at, or null for chip counts. */
  chipValue: Cents | null;
  onPick: (choice: LayoutChoice) => void;
  onClose: () => void;
}

export function LayoutPickSheet(p: LayoutPickSheetProps) {
  const all = p.choices ?? [];
  const shown = p.variant ? all.filter((c) => c.layout.variant === p.variant) : all;
  const hidden = all.length - shown.length;
  return (
    <Sheet open title="Use a saved layout" onClose={p.onClose}>
      <div class="b-pick">
        {p.choices === null ? <p class="muted">Loading layouts…</p> : null}
        {p.choices !== null && shown.length === 0 ? (
          <p class="muted">No saved layouts for this table yet. Build one with Edit chips.</p>
        ) : null}
        <ul class="blist" aria-label="Saved layouts">
          {shown.map((c) => (
            <li key={c.layout.id} class="b-pick-item">
              <LayoutThumb
                ui={p.env.ui}
                rules={p.rules}
                spots={c.layout.spots}
                chipValue={p.chipValue}
              />
              <div class="b-pick-info">
                <strong>{c.layout.name}</strong>
                {c.builtin ? <span class="b-pill">Built-in</span> : null}
                <span class="muted">
                  {plural(c.layout.spots.length, 'spot')} ·{' '}
                  {plural(totalChips(c.layout.spots), 'chip')}
                </span>
                <Button aria-label={`Use ${c.layout.name}`} onClick={() => p.onPick(c)}>
                  Use
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {hidden > 0 ? (
          <p class="hint">
            {plural(hidden, 'layout')} for other wheels {hidden === 1 ? 'is' : 'are'} hidden.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
