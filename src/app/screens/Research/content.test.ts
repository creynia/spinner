import { describe, expect, it } from 'vitest';
import { CHAPTERS } from './content';

const ORDER = [
  'start',
  'edge',
  'martingale',
  'levels',
  'placement',
  'curve',
  'shapes',
  'cashout',
  'limits',
  'try',
  'play-c9',
];
const BANNED = /\b(variance|quantile|skew\w*|cvar|expectation)\b/i;
// The brief's pattern was /^[a-z0-9-]+:.../, but one results file is e7b-mart-L7stop.json.
const KEY = /^[A-Za-z0-9-]+:[A-Za-z0-9@_.-]+$/;
const words = (ps: string[]) => ps.join(' ').split(/\s+/).filter(Boolean).length;

describe('Research content', () => {
  it('has the ten chapters of app-plan section 3 in order, then the table how-to', () => {
    expect(CHAPTERS.map((c) => c.id)).toEqual(ORDER);
  });

  it('fills every field of every chapter', () => {
    for (const c of CHAPTERS) {
      for (const s of [c.id, c.title, c.lead]) expect(s.trim()).not.toBe('');
      for (const list of [c.body, c.takeaways, c.math.text, c.math.formulas, c.dataKeys]) {
        expect(list.length, c.id).toBeGreaterThan(0);
        for (const s of list) expect(s.trim(), c.id).not.toBe('');
      }
    }
  });

  it('keeps the banned words out of the leads, bodies and takeaways', () => {
    for (const c of CHAPTERS) {
      for (const s of [c.lead, ...c.body, ...c.takeaways]) expect(s, c.id).not.toMatch(BANNED);
    }
  });

  it('keeps to the length limits (body 120 words, math 200 words, 3 takeaways)', () => {
    for (const c of CHAPTERS) {
      expect(words(c.body), c.id).toBeLessThanOrEqual(120);
      expect(words(c.math.text), c.id).toBeLessThanOrEqual(200);
      expect(c.takeaways.length, c.id).toBeLessThanOrEqual(3);
    }
  });

  it('names data rows as <results file>:<experiment id>, without duplicates', () => {
    for (const c of CHAPTERS) {
      for (const k of c.dataKeys) expect(k, c.id).toMatch(KEY);
      expect(new Set(c.dataKeys).size, c.id).toBe(c.dataKeys.length);
    }
  });

  it('says the cost sentence in the edge chapter and the closing chapter', () => {
    const sentence = 'every dollar you bet costs 2.7 cents on average, no matter how you bet it';
    for (const id of ['edge', 'try', 'play-c9']) {
      const c = CHAPTERS.find((x) => x.id === id)!;
      expect([c.lead, ...c.body, ...c.takeaways].join(' ').toLowerCase()).toContain(sentence);
    }
  });
});
