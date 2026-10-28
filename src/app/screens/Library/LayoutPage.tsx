// The editor page (layouts.md §4.7): hosts the real `LayoutEditor` full-page inside the Library at
// `#/library?tab=layouts&edit=<id|new>`. Save creates or updates a library layout; closing runs
// through the editor's own unsaved-changes guard.
import { useEffect, useState } from 'preact/hooks';
import type { ChipLayout, LayoutRecord } from '@core/contracts/layout';
import { Button, EmptyState, LayoutEditor, defaultDenom, showToast } from '@core/ui';
import { DEFAULT_RULE_PRESET, resolveRules, roulette } from '@game/roulette';
import { rouletteUi } from '@game/roulette/ui';
import { libraryRepo } from '../Define/data';
import {
  createLayout,
  isBuiltinId,
  LayoutInvalidError,
  saveLayout,
  VARIANTS,
} from '../../services/layouts';

/** Session bankroll for the table check: large, so only table limits decide. */
const BANKROLL = 1_000_000_000;

type Loaded =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'builtin' }
  | { kind: 'ready'; record: LayoutRecord | null };

export function LayoutPage({
  id: routeId,
  onClose,
  onSaved,
}: {
  id: string;
  onClose: () => void;
  /** A new layout got its id; the host swaps `new` for it in the address. */
  onSaved: (id: string) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [savedId, setSavedId] = useState<string | null>(routeId === 'new' ? null : routeId);
  const [variant, setVariant] = useState(DEFAULT_RULE_PRESET as string);

  useEffect(() => {
    let live = true;
    if (routeId === 'new') {
      setLoaded({ kind: 'ready', record: null });
      return;
    }
    if (isBuiltinId(routeId)) {
      setLoaded({ kind: 'builtin' });
      return;
    }
    void (async () => {
      const rec = await (await libraryRepo()).getLayout(routeId).catch(() => undefined);
      if (!live) return;
      if (!rec) setLoaded({ kind: 'missing' });
      else {
        setVariant(rec.layout.variant);
        setLoaded({ kind: 'ready', record: rec });
      }
    })();
    return () => {
      live = false;
    };
  }, [routeId]);

  if (loaded.kind === 'loading') return <p class="muted">Loading</p>;
  if (loaded.kind !== 'ready')
    return (
      <EmptyState
        title={loaded.kind === 'builtin' ? 'Built-in layouts are read-only' : 'Layout not found'}
        action={<Button onClick={onClose}>Back to layouts</Button>}
      >
        {loaded.kind === 'builtin'
          ? 'Use "Duplicate to edit" in the list to make your own copy.'
          : 'It may have been deleted.'}
      </EmptyState>
    );

  const rec = loaded.record;
  const rules = resolveRules(variant);
  const initial = rec?.layout.spots ?? [];
  const chipValue = initial.length
    ? defaultDenom(roulette as never, rules, initial, rouletteUi.chips!.denominations).denom
    : null;

  const onSave = async (r: {
    spots: ChipLayout['spots'];
    name: string;
    variant: string;
    notes?: string;
  }) => {
    try {
      const base = savedId ? (await (await libraryRepo()).getLayout(savedId))?.layout : undefined;
      if (base) {
        const next: ChipLayout = { ...base, name: r.name, variant: r.variant, spots: r.spots };
        if (r.notes !== undefined) next.notes = r.notes;
        else delete next.notes;
        await saveLayout(next);
      } else {
        const created = await createLayout({
          name: r.name,
          variant: r.variant,
          spots: r.spots,
          ...(r.notes !== undefined ? { notes: r.notes } : {}),
        });
        setSavedId(created.id);
        onSaved(created.id);
      }
      showToast(`Saved ${r.name}`);
    } catch (e) {
      const msg =
        e instanceof LayoutInvalidError
          ? `Cannot save: ${e.items[0] ?? 'invalid layout'}`
          : e instanceof Error
            ? e.message
            : 'Could not save.';
      showToast(msg, { tone: 'error' });
      throw e;
    }
  };

  return (
    <LayoutEditor
      plugin={roulette}
      rules={rules}
      ui={rouletteUi as never}
      initialSpots={initial}
      name={rec?.layout.name ?? ''}
      variant={variant}
      {...(rec?.layout.notes ? { notes: rec.layout.notes } : {})}
      variants={VARIANTS}
      onVariantChange={setVariant}
      chipValue={chipValue}
      bankroll={BANKROLL}
      onSave={onSave}
      onClose={onClose}
    />
  );
}
