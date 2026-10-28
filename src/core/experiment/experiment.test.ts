import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ExperimentDefinition, Json, NormalizedDefinition } from '../contracts/experiment';
import { coin } from '../testing';
import {
  base64Decode,
  base64Encode,
  canonicalJson,
  crockfordBase32,
  decodeShareLink,
  DefinitionFormatError,
  definitionId,
  encodeShareLink,
  exportDefinitionFile,
  importDefinitionFile,
  migrateDefinition,
  newRunId,
  normalizeDefinition,
  RUN_ID_PATTERN,
  runId8,
  runKey,
  runMigrations,
  setPointer,
  sha256Hex,
  sha256Pure,
  simKey,
  applySweepValue,
  sweepPathAllowed,
  toHex,
} from './index';
import { ctx, hooks } from './__fixtures__/stub';

const fixture = (p: string): ExperimentDefinition =>
  JSON.parse(
    readFileSync(new URL(`./__fixtures__/definitions/${p}`, import.meta.url), 'utf8'),
  ) as ExperimentDefinition;

function norm(d: ExperimentDefinition): NormalizedDefinition {
  const r = normalizeDefinition(d, ctx, hooks);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.definition;
}

// Re-pinned by core-store (reconciliation E2/E3): `normalizeStrategy` drops `"rules":[]`, so the
// canonical string of harness-data-analysis.md §8.3 loses `,"rules":[]` (11 bytes: 418 -> 407).
const FLAT_RED_CANONICAL =
  '{"game":{"id":"roulette","rules":{"overrides":{},"preset":"european"}},"name":"Flat red","run":{"checkpointSchedule":"auto","sampleSessions":24,"seed":42,"sessions":10000},"schema":1,"session":{"bankroll":100000,"maxRounds":500,"roundsPerHour":40},"strategy":{"game":"roulette","id":"flat-red","name":"Flat red","schema":1,"stages":[{"id":"main","layout":[{"amount":{"units":1},"bet":"red"}]}],"unit":2500}}';
const FLAT_RED_ID = '843d24d54068203f750224020025a3218ca509dffab614b76b0381f71df1f361';
const PINNED_FLAT_RED_SIMKEY = '1d7c24cf7f4556ba37b8bab68edab7a0e688c7a87519861e92ad09cfa857a9f5';

describe('canonical JSON', () => {
  it('sorts keys, drops whitespace and undefined members', () => {
    expect(
      canonicalJson({ b: 1, a: [true, null, 'x'], c: { z: 0, y: undefined } } as unknown as Json),
    ).toBe('{"a":[true,null,"x"],"b":1,"c":{"z":0}}');
  });
  it('sorts by UTF-16 code units, not locale', () => {
    expect(canonicalJson({ b: 1, B: 2, é: 3, a: 4 })).toBe('{"B":2,"a":4,"b":1,"é":3}');
    expect(canonicalJson({ '😀': 1, '～': 2 })).toBe('{"😀":1,"～":2}');
  });
  it('writes numbers like ECMAScript and -0 as 0', () => {
    expect(canonicalJson([1e21, 1.5, -0, 0.1, 100, 1e-7])).toBe('[1e+21,1.5,0,0.1,100,1e-7]');
  });
  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson(NaN)).toThrow();
    expect(() => canonicalJson({ a: Infinity })).toThrow();
  });
  it('escapes strings as JSON.stringify does', () => {
    expect(canonicalJson('a"b\n ')).toBe(JSON.stringify('a"b\n '));
  });
});

describe('sha256', () => {
  const vectors: [string, string][] = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
  ];
  it.each(vectors)('WebCrypto path: %j', async (input, hex) => {
    expect(await sha256Hex(input)).toBe(hex);
  });
  it.each(vectors)('pure TS path: %j', (input, hex) => {
    expect(toHex(sha256Pure(new TextEncoder().encode(input)))).toBe(hex);
  });
  it('the pure path matches node:crypto for every length around block boundaries', () => {
    for (const n of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000, 100_000]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 255);
      expect(toHex(sha256Pure(bytes))).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
  });
  it('falls back to the pure path without WebCrypto', async () => {
    vi.stubGlobal('crypto', undefined);
    try {
      expect(await sha256Hex('abc')).toBe(vectors[1]?.[1]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('base64', () => {
  it('round trips, standard and url-safe', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 100, 1001]) {
      const b = new Uint8Array(n).map((_, i) => (i * 97 + 13) & 255);
      expect(base64Encode(b)).toBe(Buffer.from(b).toString('base64'));
      expect(base64Decode(base64Encode(b))).toEqual(b);
      expect(base64Decode(Buffer.from(b).toString('base64url'))).toEqual(b);
    }
  });
  it('rejects garbage', () => {
    expect(() => base64Decode('a$b')).toThrow();
    expect(() => base64Decode('a')).toThrow();
  });
});

describe('definition identity', () => {
  const d = norm(fixture('flat-red.json'));

  it('normalizes flat-red to the re-pinned canonical string', () => {
    const s = canonicalJson(d as unknown as Json);
    expect(s).toBe(FLAT_RED_CANONICAL);
    expect(new TextEncoder().encode(s).length).toBe(407);
  });
  it('has the re-pinned definitionId', async () => {
    expect(await definitionId(d)).toBe(FLAT_RED_ID);
    expect(createHash('sha256').update(FLAT_RED_CANONICAL).digest('hex')).toBe(FLAT_RED_ID);
  });
  it('with an identity strategy normalizer reproduces the original 418-byte vector of the design doc', async () => {
    const r = normalizeDefinition(fixture('flat-red.json'), ctx, {
      normalizeStrategy: (x) => x,
      validateStrategy: () => [],
    });
    if (!r.ok) throw new Error('invalid');
    expect(new TextEncoder().encode(canonicalJson(r.definition as unknown as Json)).length).toBe(
      418,
    );
    expect(await definitionId(r.definition)).toBe(
      'f8126470b3609e8aae6ec3c8667ff63ded8cbd819e7c6e25366f1d0832d7f0a5',
    );
  });
  it('is independent of key order', async () => {
    const shuffled = JSON.parse(
      JSON.stringify(d, (_k, v: unknown) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(Object.entries(v).reverse())
          : v,
      ),
    ) as NormalizedDefinition;
    expect(await definitionId(shuffled)).toBe(FLAT_RED_ID);
  });
  it('hashes the name; simKey ignores name, notes and tags', async () => {
    const renamed = {
      ...d,
      name: 'Other',
      notes: 'n',
      tags: ['t'],
      strategy: { ...d.strategy, name: 'Z', notes: 'q' },
    };
    expect(await definitionId(renamed)).not.toBe(FLAT_RED_ID);
    expect(await simKey(renamed, '1', '2')).toBe(await simKey(d, '1', '2'));
    expect(await simKey(d, '1', '2')).not.toBe(await simKey(d, '1', '3'));
    expect(await simKey(d, '1', '2')).not.toBe(await simKey(d, '2', '2'));
    const seeded = { ...d, run: { ...d.run, seed: 43 } };
    expect(await simKey(seeded, '1', '2')).not.toBe(await simKey(d, '1', '2'));
    expect(await runKey(FLAT_RED_ID, '1', '2')).toMatch(/^[0-9a-f]{64}$/);
  });
  it('makes run ids of the E4 shape', () => {
    expect(crockfordBase32(new Uint8Array([0, 0, 0, 0, 0]))).toBe('00000000');
    expect(crockfordBase32(new Uint8Array([255, 255, 255, 255, 255]))).toBe('zzzzzzzz');
    const id = newRunId(FLAT_RED_ID, () => new Uint8Array([1, 2, 3, 4, 5]));
    expect(id).toMatch(RUN_ID_PATTERN);
    expect(id.startsWith(FLAT_RED_ID.slice(0, 16) + '-')).toBe(true);
    expect(runId8(id)).toHaveLength(8);
    expect(newRunId(FLAT_RED_ID)).toMatch(RUN_ID_PATTERN);
  });
});

describe('normalizeDefinition', () => {
  it('is idempotent on every fixture', () => {
    for (const f of readdirSync(new URL('./__fixtures__/definitions/v1', import.meta.url))) {
      const once = norm(fixture(`v1/${f}`));
      expect(norm(once)).toEqual(once);
      expect(canonicalJson(norm(once) as unknown as Json)).toBe(
        canonicalJson(once as unknown as Json),
      );
    }
  });
  it('inlines refs, sorts tags, prunes default overrides, makes defaults explicit', () => {
    const d = norm(fixture('v1/library-ref.json'));
    expect(d.name).toBe('Library flat');
    expect(d.notes).toBeUndefined();
    expect(d.tags).toEqual(['a', 'b']);
    expect(d.game.rules).toEqual({ preset: 'european', overrides: {} });
    expect(d.strategy.id).toBe('flat-red');
    expect(d.run.checkpointSchedule).toEqual([0, 10, 50, 100]);
    expect(d.run.sampleSessions).toBe(0);
    expect(d.session.roundsPerHour).toBe(40);
    expect('stopLoss' in d.session).toBe(false);
  });
  it('takes roundsPerHour from the plugin pace', () => {
    expect(norm(fixture('v1/inline-extras.json')).session.roundsPerHour).toBe(38);
    expect(norm(fixture('v1/inline-extras.json')).strategy).toHaveProperty('x-note');
  });
  it('reports errors with JSON pointers', () => {
    const bad = {
      ...fixture('flat-red.json'),
      game: { id: 'craps', rules: 'european' },
      session: { bankroll: 0.5, maxRounds: 200_000 },
      run: { sessions: 100_000, seed: -1 },
    } as unknown as ExperimentDefinition;
    const r = normalizeDefinition(bad, ctx, hooks);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const paths = r.errors.map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining(['/game/id', '/session/bankroll', '/session/maxRounds', '/run/seed']),
    );
    expect(r.errors.find((e) => e.path === '/session/bankroll')?.code).toBe('not-integer');
  });
  it('refuses sessions x maxRounds above 5e8, unknown refs, unknown rules and non-finite numbers', () => {
    const base = fixture('flat-red.json');
    const big = normalizeDefinition(
      {
        ...base,
        session: { bankroll: 1, maxRounds: 100_000 },
        run: { sessions: 100_000, seed: 1 },
      },
      ctx,
      hooks,
    );
    expect(big.ok).toBe(false);
    const ref = normalizeDefinition({ ...base, strategy: { ref: 'nope' } }, ctx, hooks);
    expect(!ref.ok && ref.errors[0]?.code).toBe('E_STRATEGY_REF');
    const rules = normalizeDefinition(
      { ...base, game: { id: 'roulette', rules: 'martian' } },
      ctx,
      hooks,
    );
    expect(!rules.ok && rules.errors[0]?.path).toBe('/game/rules');
    const nan = normalizeDefinition(
      { ...base, session: { bankroll: NaN, maxRounds: 5 } },
      ctx,
      hooks,
    );
    expect(!nan.ok && nan.errors.some((e) => e.code === 'E_NOT_FINITE')).toBe(true);
  });
  it('turns -0 into 0', () => {
    const d = norm({ ...fixture('flat-red.json'), run: { sessions: 5, seed: -0 } });
    expect(Object.is(d.run.seed, 0)).toBe(true);
  });
  it('prefixes strategy diagnostics with /strategy and keeps warnings apart', () => {
    const r = normalizeDefinition(fixture('flat-red.json'), ctx, {
      ...hooks,
      validateStrategy: () => [
        { code: 'E_X', severity: 'error', path: '/stages/0', message: 'x' },
        { code: 'W_Y', severity: 'warning', path: '', message: 'y' },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.warnings[0]?.code).toBe('W_Y');
    if (!r.ok) expect(r.errors[0]?.path).toBe('/strategy/stages/0');
  });
  it('runs against the real coin plugin and the default hooks while core-strategy is a stub', () => {
    const r = normalizeDefinition(
      {
        schema: 1,
        name: 'coin flat',
        game: { id: 'coin', rules: 'standard' },
        strategy: {
          schema: 1,
          id: 'flat',
          name: 'flat',
          game: 'coin',
          unit: 100,
          stages: [{ id: 'main', layout: [{ bet: 'heads', amount: { units: 1 } }] }],
        },
        session: { bankroll: 10_000, maxRounds: 50 },
        run: { sessions: 10, seed: 1 },
      },
      { plugin: coin, resolveStrategyRef: () => undefined },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.definition.session.roundsPerHour).toBe(60);
  });
});

describe('migrations', () => {
  const dir = new URL('./__fixtures__/definitions/', import.meta.url);
  const versions = readdirSync(dir).filter((x) => /^v\d+$/.test(x));

  it('has fixtures for every past schema', () => {
    expect(versions).toContain('v1');
  });
  for (const v of versions) {
    for (const f of readdirSync(new URL(`${v}/`, dir))) {
      it(`migrates ${v}/${f} to the current schema with a stable hash`, async () => {
        const raw: unknown = JSON.parse(readFileSync(new URL(`${v}/${f}`, dir), 'utf8'));
        const migrated = migrateDefinition(raw);
        expect(migrated.schema).toBe(1);
        const a = await definitionId(norm(migrated));
        const b = await definitionId(norm(migrateDefinition(migrated)));
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{64}$/);
      });
    }
  }
  it('refuses non-definitions and newer schemas', () => {
    expect(() => migrateDefinition(5)).toThrow(DefinitionFormatError);
    expect(() => migrateDefinition({})).toThrow(/schema/);
    expect(() => migrateDefinition({ schema: 2 })).toThrow(/newer version/);
    expect(() => migrateDefinition({ schema: 1, strategy: { schema: 9 } })).toThrow(
      /newer version/,
    );
    expect(() => migrateDefinition({ schema: 0 })).toThrow(DefinitionFormatError);
  });
  it('chains injected migrations in order and does not mutate the input', () => {
    const table = {
      1: (x: Record<string, unknown>) => ({ ...x, schema: 2, renamed: x.old }),
      2: (x: Record<string, unknown>) => ({ ...x, schema: 3, extra: true }),
    };
    const input = { schema: 1, old: 'v' };
    const out = runMigrations(input, 3, table, 'thing', (m) => new Error(m));
    expect(out).toEqual({ schema: 3, old: 'v', renamed: 'v', extra: true });
    expect(input).toEqual({ schema: 1, old: 'v' });
    expect(() =>
      runMigrations({ schema: 1 }, 3, { 1: table[1] }, 'thing', (m) => new Error(m)),
    ).toThrow(/no migration/);
    expect(() =>
      runMigrations({ schema: 1 }, 2, { 1: (x) => x }, 'thing', (m) => new Error(m)),
    ).toThrow(/failed/);
  });
  it('migrates a synthetic v0 definition through the definition table', () => {
    const out = migrateDefinition(
      { schema: 0.5 + 0.5, name: 'x' },
      { current: 2, definition: { 1: (x) => ({ ...x, schema: 2, migrated: true }) } },
    );
    expect(out).toMatchObject({ schema: 2, migrated: true });
  });
});

describe('share links', () => {
  const d = norm(fixture('flat-red.json'));

  it('round trips with compression', async () => {
    const link = await encodeShareLink(d);
    expect('hash' in link).toBe(true);
    if (!('hash' in link)) return;
    expect(link.hash.startsWith('#/define?d=z')).toBe(true);
    const params = new URLSearchParams(link.hash.slice('#/define?'.length));
    expect(params.get('h')).toBe(FLAT_RED_ID.slice(0, 12));
    const back = await decodeShareLink(params);
    expect(back.checksumOk).toBe(true);
    expect(back.definition).toEqual(d);
  });
  it('is compact (the doc measured 327 characters compressed, 558 not)', async () => {
    const link = await encodeShareLink(d);
    if (!('hash' in link)) throw new Error('too long');
    const payload = new URLSearchParams(link.hash.slice(9)).get('d') as string;
    expect(payload.length).toBeLessThan(420);
    const node =
      'z' + deflateRawSync(Buffer.from(FLAT_RED_CANONICAL), { level: 9 }).toString('base64url');
    expect(Math.abs(payload.length - node.length)).toBeLessThan(12);
  });
  it('decodes a link made by node zlib', async () => {
    const payload =
      'z' + deflateRawSync(Buffer.from(canonicalJson(d as unknown as Json))).toString('base64url');
    const back = await decodeShareLink(new URLSearchParams({ d: payload }));
    expect(back.definition).toEqual(d);
    expect(back.checksumOk).toBeNull();
  });
  it('falls back to uncompressed j links without CompressionStream', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    try {
      const link = await encodeShareLink(d);
      if (!('hash' in link)) throw new Error('too long');
      expect(link.hash.startsWith('#/define?d=j')).toBe(true);
      const params = new URLSearchParams(link.hash.slice(9));
      expect((await decodeShareLink(params)).definition).toEqual(d);
      // a 'z' link needs DecompressionStream
      vi.stubGlobal('DecompressionStream', undefined);
      await expect(decodeShareLink(new URLSearchParams({ d: 'zAAAA' }))).rejects.toThrow(/too old/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('flags an edited link', async () => {
    const link = await encodeShareLink(d);
    if (!('hash' in link)) throw new Error('too long');
    const params = new URLSearchParams(link.hash.slice(9));
    params.set('h', '000000000000');
    expect((await decodeShareLink(params)).checksumOk).toBe(false);
  });
  it('refuses damaged and unknown links with a DefinitionFormatError', async () => {
    for (const d2 of [
      '',
      'zzzz!',
      'zAAAA',
      'j' + Buffer.from('{').toString('base64url'),
      'q' + 'AAAA',
    ]) {
      await expect(decodeShareLink(new URLSearchParams({ d: d2 }))).rejects.toThrow(
        DefinitionFormatError,
      );
    }
    await expect(decodeShareLink(new URLSearchParams())).rejects.toThrow(/no definition/);
  });
  it('returns tooLong above 8000 characters', async () => {
    let seed = 1;
    const noise = Array.from({ length: 12_000 }, () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed.toString(36);
    }).join('');
    const big = { ...d, notes: noise };
    const link = await encodeShareLink(big);
    expect(link).toMatchObject({ tooLong: true });
    if ('chars' in link) expect(link.chars).toBeGreaterThan(8000);
  });
  it('exports and imports the definition file fallback', () => {
    const text = exportDefinitionFile(d);
    expect(text).toContain('\n  "game": {');
    expect(importDefinitionFile(text)).toEqual(d);
    expect(() => importDefinitionFile('nope')).toThrow(DefinitionFormatError);
  });
});

describe('setPointer and sweepPathAllowed', () => {
  const d = norm(fixture('flat-red.json'));
  it('sets an existing scalar leaf on a clone', () => {
    const v = setPointer(d, '/session/bankroll', 200_000) as NormalizedDefinition;
    expect(v.session.bankroll).toBe(200_000);
    expect(d.session.bankroll).toBe(100_000);
    const w = setPointer(d, '/strategy/stages/0/layout/0/amount/units', 3) as NormalizedDefinition;
    expect(w.strategy.stages[0]?.layout?.[0]?.amount).toEqual({ units: 3 });
  });
  it('refuses missing paths, objects and bad pointers', () => {
    for (const p of [
      '/session/nope',
      '/session',
      '',
      'session',
      '/strategy/stages/9/id',
      '/a~2b',
    ]) {
      expect(() => setPointer(d, p, 1)).toThrow();
    }
  });
  it('unescapes ~0 and ~1', () => {
    const o = { a: { 'x/y': 1, 'p~q': 2 } } as unknown as ExperimentDefinition;
    expect(setPointer(o, '/a/x~1y', 5)).toMatchObject({ a: { 'x/y': 5 } });
    expect(setPointer(o, '/a/p~0q', 6)).toMatchObject({ a: { 'p~q': 6 } });
  });
  it('allows only sweepable paths', () => {
    expect(sweepPathAllowed('/session/bankroll')).toBe(true);
    expect(sweepPathAllowed('/strategy/unit')).toBe(true);
    for (const p of [
      '/schema',
      '/game/id',
      '/run/seed',
      '/run',
      '/strategy/schema',
      '/strategy/game',
      '',
      'x',
    ]) {
      expect(sweepPathAllowed(p)).toBe(false);
    }
  });
});

describe('chip sweeps and simKey provenance (layouts.md §8)', () => {
  const chipped = (over: Record<string, unknown> = {}): NormalizedDefinition => {
    const d = norm(fixture('flat-red.json'));
    const stage = {
      ...d.strategy.stages[0],
      'x-chips': { v: 1, spots: [{ bet: 'red', chips: 3 }], chip: 500, ...over },
      layout: [
        { bet: 'red', amount: 1500 },
        { bet: 'black', amount: 100 },
      ],
    };
    return {
      ...d,
      strategy: { ...d.strategy, stages: [stage] },
    } as unknown as NormalizedDefinition;
  };
  const C = '/strategy/stages/0/x-chips/chip';
  const from = { id: 'a', hash: 'h', name: 'A' };

  it('allows only the chip value among x- paths', () => {
    const d = chipped();
    expect(sweepPathAllowed(C)).toBe(true);
    expect(sweepPathAllowed(C, d)).toBe(true);
    for (const p of [
      '/strategy/stages/0/x-chips/spots/0/chips',
      '/strategy/stages/0/x-chips/from/hash',
      '/strategy/stages/0/x-chips/v',
      '/strategy/stages/0/x-other',
      '/strategy/x-foo',
    ]) {
      expect(sweepPathAllowed(p), p).toBe(false);
      expect(sweepPathAllowed(p, d), p).toBe(false);
    }
  });
  it('denies compiled chip rows only with the definition, and only for i < spots.length', () => {
    const d = chipped();
    expect(sweepPathAllowed('/strategy/stages/0/layout/0/amount', d)).toBe(false);
    expect(sweepPathAllowed('/strategy/stages/0/layout/0/amount')).toBe(true);
    expect(sweepPathAllowed('/strategy/stages/0/layout/1/amount', d)).toBe(true);
  });
  it('denies a non-numeric chip value with the definition', () => {
    const d = chipped({ chip: { units: 1 } });
    expect(sweepPathAllowed(C, d)).toBe(false);
  });
  it('applySweepValue recompiles the prefix rows and keeps manual rows', () => {
    const v = applySweepValue(chipped(), C, 2500) as NormalizedDefinition;
    expect(v.strategy.stages[0]?.layout).toEqual([
      { bet: 'red', amount: 7500 },
      { bet: 'black', amount: 100 },
    ]);
    expect(applySweepValue(chipped(), '/session/bankroll', 5)).toMatchObject({
      session: { bankroll: 5 },
    });
  });
  it('applySweepValue refuses bad chip values before recompiling', () => {
    for (const bad of [0, -5, 2.5, '500', null, 2 ** 31]) {
      expect(() => applySweepValue(chipped(), C, bad as number)).toThrow(/whole cents|too large/);
    }
  });
  it('simKey ignores x-chips.from; definitionId does not', async () => {
    const a = chipped({ from });
    const b = chipped({ from: { ...from, name: 'Renamed', hash: 'z' } });
    const c = chipped();
    expect(await simKey(a, '1', '2')).toBe(await simKey(b, '1', '2'));
    expect(await simKey(a, '1', '2')).toBe(await simKey(c, '1', '2'));
    expect(await definitionId(a)).not.toBe(await definitionId(b));
    expect(await definitionId(a)).not.toBe(await definitionId(c));
    const other = chipped({ chip: 100 });
    expect(await simKey(other, '1', '2')).not.toBe(await simKey(c, '1', '2'));
  });
  it('leaves simKey of definitions without x-chips unchanged', async () => {
    const flat = norm(fixture('flat-red.json'));
    const variants = [
      flat,
      { ...flat, run: { ...flat.run, seed: 43 } },
      { ...flat, session: { ...flat.session, bankroll: 5_000 } },
    ] as NormalizedDefinition[];
    for (const d of variants) {
      const { name: _n, ...rest } = d;
      const strategy = { ...d.strategy } as Record<string, unknown>;
      delete strategy.name;
      const want = createHash('sha256')
        .update(
          canonicalJson({
            definition: { ...rest, strategy },
            gameVersion: '1',
            coreVersion: '2',
          } as unknown as Json),
        )
        .digest('hex');
      expect(await simKey(d, '1', '2')).toBe(want);
    }
    const d = flat;
    expect(await simKey(d, '1', '2')).toBe(PINNED_FLAT_RED_SIMKEY);
  });
});
