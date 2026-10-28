// Import (architecture.md §6.3): a file, a drop, or a pasted definition link.
import { useRef, useState } from 'preact/hooks';
import type { Repo } from '@core';
import { Button, Card } from '@core/ui';
import { href, navigate } from '../../router';
import { definitionLinkTarget, importBytes, type ImportOutcome } from './importFile';
import { getStoreRepo } from './repo';
import './import.css';

export interface ImportViewProps {
  /** Tests inject a repo. */
  getRepo?: () => Promise<Repo>;
}

export function ImportView({ getRepo = getStoreRepo }: ImportViewProps) {
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [results, setResults] = useState<{ file: string; outcome: ImportOutcome }[]>([]);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function take(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setBusy(true);
    const out: { file: string; outcome: ImportOutcome }[] = [];
    try {
      const repo = await getRepo();
      for (const f of list) {
        let outcome: ImportOutcome;
        try {
          outcome = await importBytes(new Uint8Array(await f.arrayBuffer()), repo);
        } catch (e) {
          outcome = {
            ok: false,
            problem: {
              kind: 'invalid',
              title: 'Cannot import this file',
              detail: e instanceof Error ? e.message : 'unknown error',
            },
          };
        }
        out.push({ file: f.name, outcome });
      }
    } finally {
      setResults(out);
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <>
      <h1>Import</h1>
      <p class="lead">
        Open a run file (.spinner.json or .spinner.json.gz), a definition.json, or a definition
        link.
      </p>
      <Card title="From a file">
        <div
          class={`imp-drop${over ? ' is-over' : ''}`}
          data-dropzone
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            if (e.dataTransfer?.files) void take(e.dataTransfer.files);
          }}
        >
          <p>Drop files here, or</p>
          <label class="btn btn-primary imp-pick">
            Choose files
            <input
              ref={input}
              class="visually-hidden"
              type="file"
              multiple
              accept=".json,.gz,application/json,application/gzip"
              data-file-input
              onChange={(e) => e.currentTarget.files && void take(e.currentTarget.files)}
            />
          </label>
        </div>
        {busy ? (
          <p role="status" class="muted">
            Reading files
          </p>
        ) : null}
      </Card>

      <Card title="From a definition link">
        <form
          class="imp-link"
          onSubmit={(e) => {
            e.preventDefault();
            const target = definitionLinkTarget(link);
            if (!target) return setLinkError('That does not look like a spinner definition link.');
            setLinkError('');
            navigate(target);
          }}
        >
          <label for="imp-link-in">Paste a link</label>
          <input
            id="imp-link-in"
            class="input"
            value={link}
            onInput={(e) => setLink(e.currentTarget.value)}
            aria-invalid={linkError ? 'true' : undefined}
            aria-describedby={linkError ? 'imp-link-err' : undefined}
          />
          {linkError ? (
            <p id="imp-link-err" class="error" role="alert">
              {linkError}
            </p>
          ) : null}
          <Button type="submit">Open in Define</Button>
        </form>
      </Card>

      {results.length > 0 ? (
        <section aria-label="Import results" class="imp-results">
          {results.map(({ file, outcome }, i) => (
            <Card key={i} title={file} level={3} class={outcome.ok ? 'imp-ok' : 'imp-bad'}>
              {outcome.ok ? (
                outcome.kind === 'run' ? (
                  <div data-result="run">
                    <p>
                      {outcome.status === 'exists' ? 'Already in your library: ' : 'Imported '}
                      <strong>{outcome.name}</strong> <span class="chip-note">imported</span>
                    </p>
                    <div class="actions">
                      <Button variant="primary" href={href(`/analyze/${outcome.runId}`)}>
                        Open results
                      </Button>
                      <Button href={href(`/define?from=${outcome.runId}`)}>Copy to Define</Button>
                    </div>
                  </div>
                ) : (
                  <div data-result="definition">
                    <p>
                      Saved definition <strong>{outcome.name}</strong>.
                    </p>
                    <Button variant="primary" href={href(`/define/${outcome.definitionId}`)}>
                      Open in Define
                    </Button>
                  </div>
                )
              ) : (
                <div role="alert" data-problem={outcome.problem.kind}>
                  <p class="error">
                    <span aria-hidden="true">⚠ </span>
                    <strong>{outcome.problem.title}.</strong> {outcome.problem.detail}
                  </p>
                  {outcome.problem.items ? (
                    <ul>
                      {outcome.problem.items.map((t, j) => (
                        <li key={j}>{t}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
            </Card>
          ))}
        </section>
      ) : null}
    </>
  );
}

export function Import() {
  return <ImportView />;
}
