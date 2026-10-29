// A sheet to rename a saved experiment (its definition record). Enter saves, Esc cancels (the
// Sheet handles Esc and returns focus to the control that opened it). The name is validated by
// the store (`validateDefinitionName`); duplicate names are fine because ids differ.
import { useState } from 'preact/hooks';
import { DEFINITION_NAME_MAX, validateDefinitionName } from '@core';
import { Button, Field, Sheet, showToast, useId } from '@core/ui';
import { renameDefinition } from './Define/data';

export function RenameExperiment(p: {
  id: string;
  name: string;
  onClose: () => void;
  onRenamed?: (name: string) => void;
}) {
  const fid = useId('exp-rename');
  const [value, setValue] = useState(p.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const check = validateDefinitionName(value);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(true);
    try {
      if (check.name !== p.name) {
        await renameDefinition(p.id, check.name);
        showToast(`Renamed to ${check.name}`);
        p.onRenamed?.(check.name);
      }
      p.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rename.');
      setBusy(false);
    }
  };

  return (
    <Sheet open title="Rename experiment" onClose={p.onClose}>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void save();
        }}
      >
        <Field
          label="Name"
          id={fid}
          error={error}
          hint={`Up to ${DEFINITION_NAME_MAX} characters.`}
        >
          <input
            class="input"
            id={fid}
            data-autofocus
            value={value}
            maxLength={DEFINITION_NAME_MAX + 40}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? `${fid}-err ${fid}-hint` : `${fid}-hint`}
            onInput={(e) => {
              setValue(e.currentTarget.value);
              setError(null);
            }}
          />
        </Field>
        <div class="actions">
          <Button type="submit" variant="primary" disabled={busy}>
            Rename
          </Button>
          <Button onClick={p.onClose}>Cancel</Button>
        </div>
      </form>
    </Sheet>
  );
}
