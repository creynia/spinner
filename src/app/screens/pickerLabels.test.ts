import { describe, expect, it } from 'vitest';
import { pickerLabels } from './pickerLabels';

describe('pickerLabels', () => {
  it('shows only name and time when they differ', () => {
    expect(
      pickerLabels([
        { name: 'A', when: '2 hours ago', sessions: 10, seed: 1 },
        { name: 'A', when: 'Oct 1, 2026', sessions: 10, seed: 1 },
      ]),
    ).toEqual(['A · 2 hours ago', 'A · Oct 1, 2026']);
  });
  it('adds sessions on a tie, then the seed', () => {
    const t = { name: 'A', when: 'just now' };
    expect(
      pickerLabels([
        { ...t, sessions: 1000, seed: 1 },
        { ...t, sessions: 2000, seed: 1 },
      ]),
    ).toEqual(['A · 1,000 sess. · just now', 'A · 2,000 sess. · just now']);
    expect(
      pickerLabels([
        { ...t, sessions: 1000, seed: 1 },
        { ...t, sessions: 1000, seed: 2 },
      ]),
    ).toEqual(['A · 1,000 sess. · seed 1 · just now', 'A · 1,000 sess. · seed 2 · just now']);
  });
});
