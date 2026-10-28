// A tiny CompileContext for strategy tests: five bets, a few facts and events. No game imports.
import type { BetCatalogEntry, RoundOutcome } from '../../contracts/game';
import type { CompileContext } from '../../contracts/strategy';
import type { FactSchema, FactValue } from '../../contracts/facts';

export const STUB_CATALOG: BetCatalogEntry[] = [
  entry('a', 'outside', false, false),
  entry('b', 'outside', true, false),
  entry('c', 'outside', true, true),
  entry('in1', 'inside', false, false),
  { ...entry('odds', 'outside', true, false), needsParent: ['b'] },
];

function entry(
  id: string,
  limitClass: string,
  persistent: boolean,
  contract: boolean,
): BetCatalogEntry {
  return { id, label: id, category: 'stub', limitClass, description: '', persistent, contract };
}

export const STUB_FACTS: FactSchema = {
  facts: [
    {
      name: 'color',
      label: 'colour',
      doc: '',
      scope: 'round',
      nullable: true,
      value: { type: 'enum', values: ['red', 'black', 'green'] },
    },
    {
      name: 'dozen',
      label: 'dozen',
      doc: '',
      scope: 'round',
      nullable: true,
      value: { type: 'enum', values: [0, 1, 2, 3] },
    },
    {
      name: 'hot',
      label: 'hot',
      doc: '',
      scope: 'state',
      nullable: false,
      value: { type: 'boolean' },
    },
    {
      name: 'level',
      label: 'level',
      doc: '',
      scope: 'state',
      nullable: false,
      value: { type: 'number', unit: 'count', integer: true },
    },
    {
      name: 'score',
      label: 'score',
      doc: '',
      scope: 'round',
      nullable: true,
      value: { type: 'number', unit: 'scalar' },
    },
    {
      name: 'since',
      label: 'since',
      doc: '',
      scope: 'state',
      nullable: false,
      params: [{ name: 'target', type: 'target', values: ['zero'] }],
      value: { type: 'number', unit: 'count', integer: true },
    },
    {
      name: 'count',
      label: 'count',
      doc: '',
      scope: 'state',
      nullable: false,
      params: [
        { name: 'n', type: 'number', min: 1, max: 100 },
        { name: 'target', type: 'target' },
      ],
      value: { type: 'number', unit: 'count', integer: true },
    },
    {
      name: 'mode',
      label: 'mode',
      doc: '',
      scope: 'state',
      nullable: false,
      params: [{ name: 'which', type: 'enum', values: ['x', 'y'] }],
      value: { type: 'number', unit: 'count' },
    },
  ],
  events: [
    { name: 'zero', label: 'zero', doc: '' },
    {
      name: 'hit',
      label: 'hit',
      doc: '',
      params: [
        { name: 'bet', type: 'bet' },
        { name: 'k', type: 'number' },
      ],
    },
  ],
  actions: [{ name: 'fold', label: 'fold', doc: '' }],
};

export interface StubView {
  color: string | null;
  dozen: number | null;
  hot: boolean;
  level: number;
  score: number | null;
  since: Record<string, number>;
}

export const stubView = (over: Partial<StubView> = {}): StubView => ({
  color: null,
  dozen: null,
  hot: false,
  level: 0,
  score: null,
  since: {},
  ...over,
});

export function makeCtx(over: Partial<CompileContext<object, StubView>> = {}): CompileContext {
  const ids = new Set(STUB_CATALOG.map((e) => e.id));
  const ctx: CompileContext<object, StubView> = {
    catalog: STUB_CATALOG,
    parseBet: (id) => {
      const x = id.trim().toLowerCase();
      return ids.has(x) ? x : null;
    },
    facts: STUB_FACTS,
    rules: {},
    limits: (b) => {
      if (b === 'outside' || b === 'a' || b === 'b' || b === 'c' || b === 'odds')
        return { min: 2500, max: 500_000 };
      if (b === 'inside') return { min: 2500, max: 100_000 };
      if (b === 'in1') return { min: 100, max: 50_000 };
      return null;
    },
    compileFact: (ref) => {
      const [name, ...rest] = ref.split(':');
      return (view: StubView, _last: RoundOutcome | null): FactValue | null => {
        switch (name) {
          case 'color':
            return view.color;
          case 'dozen':
            return view.dozen;
          case 'hot':
            return view.hot;
          case 'level':
            return view.level;
          case 'score':
            return view.score;
          case 'since':
            return view.since[rest.join(':')] ?? 0;
          default:
            return 0;
        }
      };
    },
    ...over,
  };
  return { ...ctx, gameId: 'stub' } as unknown as CompileContext;
}
