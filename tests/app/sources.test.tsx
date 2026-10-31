import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { Sources } from '@app/screens/Sources';
import { PRESET_SOURCES, SOURCE_GROUPS, sourceById } from '@app/sources';
import { STRATEGY_PRESET_IDS } from '@game/roulette/presets';

afterEach(cleanup);

describe('Sources screen', () => {
  it('renders every group and item, with external https links', () => {
    const { container } = render(<Sources />);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelectorAll('h2')).toHaveLength(SOURCE_GROUPS.length);
    expect(container.querySelector('a[href="#/more"]')).not.toBeNull();
    for (const g of SOURCE_GROUPS) {
      for (const i of g.items) {
        const li = container.querySelector(`[data-source-id="${i.id}"]`);
        expect(li, i.id).not.toBeNull();
        const a = li!.querySelector('a');
        if (i.url) {
          expect(new URL(i.url).protocol).toBe('https:');
          expect(a!.getAttribute('target')).toBe('_blank');
          expect(a!.getAttribute('rel')).toBe('noopener noreferrer');
        } else expect(a).toBeNull();
      }
    }
  });
  it('has unique ids, and every preset source exists', () => {
    const ids = SOURCE_GROUPS.flatMap((g) => g.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const [preset, id] of Object.entries(PRESET_SOURCES)) {
      expect(STRATEGY_PRESET_IDS).toContain(preset);
      expect(sourceById(id), id).toBeDefined();
    }
  });
});
