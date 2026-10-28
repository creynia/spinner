// OutcomeGlyph: the pocket that came up as a number plus its colour as a word, never colour alone.
import type { OutcomeGlyphProps } from '@core/ui';
import { colorOfLabel } from './names';

export function pocketOf(outcome: OutcomeGlyphProps['outcome']): string {
  const p = outcome.summary['pocket'];
  return typeof p === 'string' || typeof p === 'number' ? String(p) : '?';
}

export function OutcomeGlyph({ outcome }: OutcomeGlyphProps) {
  const pocket = pocketOf(outcome);
  const color = colorOfLabel(pocket);
  return (
    <span class={`rl-ui rl-glyph rl-glyph--${color}`} role="img" aria-label={`${pocket} ${color}`}>
      <span class="rl-glyph__n" aria-hidden="true">
        {pocket}
      </span>
      <span class="rl-glyph__c" aria-hidden="true">
        {color}
      </span>
    </span>
  );
}
