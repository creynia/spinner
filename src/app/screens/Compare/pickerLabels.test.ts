import { describe, expect, it } from 'vitest';
import { pickerLabels } from './index';

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
    ).toEqual(['A · just now · 1,000 sessions', 'A · just now · 2,000 sessions']);
    expect(
      pickerLabels([
        { ...t, sessions: 1000, seed: 1 },
        { ...t, sessions: 1000, seed: 2 },
      ]),
    ).toEqual(['A · just now · 1,000 sessions · seed 1', 'A · just now · 1,000 sessions · seed 2']);
  });
});
