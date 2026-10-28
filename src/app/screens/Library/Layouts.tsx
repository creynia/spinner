// Library → Layouts tab (layouts.md §4.7): thumbnails, built-ins, new, edit, duplicate, rename,
// delete, export, "used in" and a variant filter. Built-in layouts are read-only.
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  LayoutThumb,
  Sheet,
  TextInput,
  showToast,
} from '@core/ui';
import { resolveRules } from '@game/roulette';
import { rouletteUi } from '@game/roulette/ui';
import { href } from '../../router';
import { useStore } from '../../state/store';
import { libraryVersion } from '../Define/data';
import {
  deleteLayout,
  duplicateLayout,
  layoutFileName,
  layoutFileText,
  listLayoutEntries,
  renameLayout,
  usedInOf,
  variantLabel,
  VARIANTS,
  type LayoutEntry,
} from '../../services/layouts';

export const editHref = (id: string): string =>
  `/library?tab=layouts&edit=${encodeURIComponent(id)}`;

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const totalChips = (spots: readonly { chips: number }[]) => spots.reduce((n, s) => n + s.chips, 0);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

type Pending =
  | { kind: 'delete'; entry: LayoutEntry; used: { definitions: number; strategies: number } }
  | { kind: 'rename'; entry: LayoutEntry; name: string };

export function Layouts({
  matches,
  onOpen,
}: {
  matches: (...parts: (string | undefined)[]) => boolean;
  onOpen: (id: string) => void;
}) {
  const version = useStore(libraryVersion, (v) => v);
  const [entries, setEntries] = useState<LayoutEntry[] | null>(null);
  const [variant, setVariant] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    let live = true;
    void listLayoutEntries()
      .then((e) => live && setEntries(e))
      .catch(() => live && setEntries([]));
    return () => {
      live = false;
    };
  }, [version]);

  const rulesFor = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof resolveRules>>();
    return (v: string) => {
      let r = cache.get(v);
      if (!r) cache.set(v, (r = resolveRules(v)));
      return r;
    };
  }, []);

  if (entries === null) return <p class="muted">Loading</p>;

  const shown = entries.filter(
    (e) =>
      (variant === null || e.layout.variant === variant) &&
      matches(e.layout.name, e.id, e.layout.notes, ...(e.layout.tags ?? [])),
  );
  const variants = VARIANTS.filter((v) => entries.some((e) => e.layout.variant === v.id));

  const act = async (fn: () => Promise<void>, fail: string) => {
    try {
      await fn();
    } catch (e) {
      showToast(e instanceof Error ? e.message : fail, { tone: 'error' });
    }
  };
  const askDelete = (entry: LayoutEntry) =>
    void act(async () => {
      setPending({ kind: 'delete', entry, used: await usedInOf(entry.id, false) });
    }, 'Could not check where it is used.');

  const confirm = () => {
    const p = pending;
    if (!p) return;
    void act(async () => {
      if (p.kind === 'delete') {
        await deleteLayout(p.entry.id);
        showToast(`Deleted ${p.entry.layout.name}`);
      } else {
        const name = p.name.trim();
        if (name.length < 1 || name.length > 80) throw new Error('Name: 1 to 80 characters.');
        await renameLayout(p.entry.id, name);
        showToast(`Renamed to ${name}`);
      }
      setPending(null);
    }, 'Could not save.');
  };

  const usedText = (n: number) => `Used in ${n}`;

  return (
    <>
      <Card title="Chip layouts">
        <div class="lib-toolbar">
          <Button variant="primary" onClick={() => onOpen('new')}>
            New layout
          </Button>
          <Button href={href('/import')}>Import layout</Button>
        </div>
        {variants.length > 1 ? (
          <ul class="chips" aria-label="Filter by wheel">
            {variants.map((v) => (
              <li key={v.id}>
                <Chip
                  selected={variant === v.id}
                  onClick={() => setVariant(variant === v.id ? null : v.id)}
                >
                  {v.label}
                </Chip>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      {shown.length === 0 ? (
        <EmptyState title="No match">Try another search or wheel.</EmptyState>
      ) : (
        <ul class="lay-list" aria-label="Layouts">
          {shown.map((e) => {
            const l = e.layout;
            return (
              <li key={`${e.builtin ? 'b' : 'u'}-${e.id}`} class="lay-card" data-layout={e.id}>
                <div class="lay-thumb">
                  <LayoutThumb
                    ui={rouletteUi}
                    rules={rulesFor(l.variant)}
                    spots={l.spots}
                    chipValue={null}
                  />
                </div>
                <div class="lay-body">
                  <h3 class="lay-name">
                    {l.name}
                    {e.builtin ? <span class="lay-pill">Built-in</span> : null}
                  </h3>
                  <p class="row-sub">
                    {variantLabel(l.variant)} · {plural(l.spots.length, 'spot')} ·{' '}
                    {plural(totalChips(l.spots), 'chip')} ·{' '}
                    <span data-used-in={e.usedIn}>{usedText(e.usedIn)}</span>
                  </p>
                  <div class="lib-actions">
                    {e.builtin ? (
                      <Button
                        variant="primary"
                        aria-label={`Duplicate ${l.name} to edit`}
                        onClick={() =>
                          void act(async () => {
                            const rec = await duplicateLayout(e);
                            showToast(`Duplicated as ${rec.layout.name}`);
                          }, 'Could not duplicate.')
                        }
                      >
                        Duplicate to edit
                      </Button>
                    ) : (
                      <>
                        <Button aria-label={`Edit ${l.name}`} onClick={() => onOpen(e.id)}>
                          Edit
                        </Button>
                        <Button
                          aria-label={`Duplicate ${l.name}`}
                          onClick={() =>
                            void act(async () => {
                              const rec = await duplicateLayout(e);
                              showToast(`Duplicated as ${rec.layout.name}`);
                            }, 'Could not duplicate.')
                          }
                        >
                          Duplicate
                        </Button>
                        <Button
                          aria-label={`Rename ${l.name}`}
                          onClick={() => setPending({ kind: 'rename', entry: e, name: l.name })}
                        >
                          Rename
                        </Button>
                      </>
                    )}
                    <Button
                      aria-label={`Export ${l.name}`}
                      onClick={() => {
                        download(layoutFileName(l), layoutFileText([l]));
                        showToast(`Exported ${layoutFileName(l)}`);
                      }}
                    >
                      Export
                    </Button>
                    <Button
                      aria-label={`Use ${l.name} in a new experiment`}
                      href={href(`/define?layout=${encodeURIComponent(e.id)}`)}
                    >
                      Use in Define
                    </Button>
                    {e.builtin ? null : (
                      <Button
                        variant="danger"
                        aria-label={`Delete ${l.name}`}
                        onClick={() => askDelete(e)}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pending?.kind === 'delete' ? (
        <Sheet open title="Delete layout?" onClose={() => setPending(null)}>
          <p>
            Delete <strong>{pending.entry.layout.name}</strong>? This cannot be undone.
          </p>
          {pending.used.definitions + pending.used.strategies > 0 ? (
            <p role="note">
              It is used in {plural(pending.used.definitions, 'definition')} and{' '}
              {plural(pending.used.strategies, 'strategy').replace('strategys', 'strategies')}. They
              keep their own copy of the chips.
            </p>
          ) : (
            <p class="muted">Stages that used it keep their copy.</p>
          )}
          <div class="actions">
            <Button variant="danger" onClick={confirm}>
              Delete
            </Button>
            <Button autoFocus onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </Sheet>
      ) : pending?.kind === 'rename' ? (
        <Sheet open title="Rename layout" onClose={() => setPending(null)}>
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              confirm();
            }}
          >
            <Field label="Name" id="lay-rename">
              <TextInput
                id="lay-rename"
                value={pending.name}
                onInput={(v) => setPending({ ...pending, name: v })}
              />
            </Field>
            <div class="actions">
              <Button type="submit" variant="primary">
                Rename
              </Button>
              <Button onClick={() => setPending(null)}>Cancel</Button>
            </div>
          </form>
        </Sheet>
      ) : null}
    </>
  );
}
