// "Save as layout": the bets on the felt become a chip layout in the library (Library → Layouts).
import { formatMoney } from '@core/money';
import { spotsFromBets, type PlayBet } from '@core/play';
import { Button, Field, Sheet, TextInput, showToast } from '@core/ui';
import { rouletteUi } from '@game/roulette/ui';
import { useState } from 'preact/hooks';
import { createLayout, LayoutInvalidError } from '../../services/layouts';

export interface SaveLayoutSheetProps {
  open: boolean;
  onClose: () => void;
  bets: readonly PlayBet[];
  variant: string;
}

export function SaveLayoutSheet({ open, onClose, bets, variant }: SaveLayoutSheetProps) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = (bet: string): number => rouletteUi.chips?.step(bet) ?? 1;
  const { spots, chipValue } = spotsFromBets(bets, step);
  const trimmed = name.trim();

  const save = async () => {
    if (!trimmed || spots.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const rec = await createLayout({ name: trimmed.slice(0, 80), variant, spots });
      showToast(`Saved layout "${rec.layout.name}"`);
      setName('');
      onClose();
    } catch (e) {
      setError(
        e instanceof LayoutInvalidError
          ? e.items.join('; ')
          : e instanceof Error
            ? e.message
            : 'Could not save the layout',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} title="Save as layout" onClose={onClose}>
      {spots.length === 0 ? (
        <p class="muted">Place some chips first: the layout is made from the bets on the table.</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p class="muted">
            {spots.length} {spots.length === 1 ? 'spot' : 'spots'}, saved as chip counts at{' '}
            {formatMoney(chipValue)} a chip. Find it in Library → Layouts.
          </p>
          <Field label="Name" id="play-layout-name" error={error}>
            <TextInput
              id="play-layout-name"
              value={name}
              onInput={setName}
              placeholder="My layout"
              invalid={error !== null}
            />
          </Field>
          <div class="actions">
            <Button type="submit" variant="primary" disabled={busy || trimmed === ''}>
              Save layout
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
