// Open in Define: every candidate normalizes, encodes to a Define link and decodes back to the
// same definition; a too-long link falls back to the definition file.
import { describe, expect, it } from 'vitest';
import { decodeShareLink, type NormalizedDefinition } from '@core';
import { data } from './data';
import {
  TRY_RULES,
  TRY_SETUP,
  candidateDefinition,
  candidateLink,
  normalizeCandidate,
} from './share';

const params = (hash: string) => new URLSearchParams(hash.slice(hash.indexOf('?') + 1));

describe('share', () => {
  it('has the three candidates', () => {
    expect(data.candidates.map((c) => c.id).sort()).toEqual([
      'keeper-b3-two-streets-l29',
      'keeper-c9-streets-to12-cashout',
      'keeper-c9-streets-to12-stack',
    ]);
  });

  it('uses the rules and session the data was produced with', () => {
    for (const c of data.candidates) {
      expect(c.rules).toEqual(TRY_RULES);
      expect(c.session).toEqual({ bankroll: TRY_SETUP.bankroll, maxRounds: TRY_SETUP.maxRounds });
    }
  });

  it('builds the full definition of a candidate', () => {
    const c = data.candidates[0]!;
    expect(candidateDefinition(c)).toEqual({
      schema: 1,
      name: c.name,
      game: { id: 'roulette', rules: TRY_RULES },
      strategy: c.strategy,
      session: { bankroll: 500000, maxRounds: 500 },
      run: { sessions: 10000, seed: 20261031 },
    });
  });

  for (const c of data.candidates) {
    it(`${c.id}: normalizes, encodes and decodes to the same definition`, async () => {
      const n = normalizeCandidate(c);
      expect(n.ok).toBe(true);
      const link = await candidateLink(c);
      expect(link.kind).toBe('link');
      if (link.kind !== 'link') return;
      expect(link.hash).toMatch(/^#\/define\?d=[A-Za-z0-9_-]+&h=[0-9a-f]{12}$/);
      const { definition, checksumOk } = await decodeShareLink(params(link.hash));
      expect(checksumOk).toBe(true);
      const d = definition as NormalizedDefinition;
      expect(d.strategy.id).toBe(c.id);
      expect(d.game.rules.overrides).toEqual({
        limits: { outside: { min: 100 }, inside: { minTotal: 100 } },
      });
      expect(d.session.bankroll).toBe(500000);
      expect(d.session.maxRounds).toBe(500);
      expect(d.run.seed).toBe(20261031);
      expect(d.run.sessions).toBe(10000);
      if (n.ok) expect(d).toEqual(n.definition);
    });
  }

  it('falls back to the definition file when the link is too long', async () => {
    const c = data.candidates[0]!;
    const link = await candidateLink(c, () => Promise.resolve({ tooLong: true, chars: 9000 }));
    expect(link.kind).toBe('file');
    if (link.kind !== 'file') return;
    expect(link.chars).toBe(9000);
    expect(link.filename).toBe(`${c.id}.definition.json`);
    expect((JSON.parse(link.file) as { strategy: { id: string } }).strategy.id).toBe(c.id);
  });

  it('reports a candidate that does not load', async () => {
    const bad = { ...data.candidates[0]!, strategy: { schema: 1, id: 'x' } };
    const link = await candidateLink(bad);
    expect(link.kind).toBe('error');
  });
});
