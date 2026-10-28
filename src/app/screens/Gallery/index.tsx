// Gallery (architecture.md §6.3, §9): curated result bundles from gallery/index.json, opened
// read-only: the bundle is imported (origin 'gallery', marked imported) and Analyze opens on it.
// Opening twice reuses the run already in the store (repo.importRun is idempotent per digest).
import { useEffect, useState } from 'preact/hooks';
import { formatMoney, sha256Hex, type GalleryEntry, type GalleryIndexV1, type Repo } from '@core';
import { Button, Card, EmptyState } from '@core/ui';
import { href, navigate } from '../../router';
import { importBytes, type ImportProblem } from '../Import/importFile';
import { getStoreRepo } from '../Import/repo';
import type { ScreenProps } from '../types';
import './gallery.css';

export interface GalleryDeps {
  fetchIndex: () => Promise<GalleryIndexV1>;
  fetchBundle: (entry: GalleryEntry) => Promise<Uint8Array>;
  getRepo: () => Promise<Repo>;
  go: (hash: string) => void;
}

const base = (): string =>
  typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';

export const defaultGalleryDeps: GalleryDeps = {
  async fetchIndex() {
    const r = await fetch(new URL('gallery/index.json', base()));
    if (!r.ok) throw new Error(`gallery index: HTTP ${r.status}`);
    const j = (await r.json()) as GalleryIndexV1;
    if (j.format !== 'casino-lab-gallery' || j.version !== 1 || !Array.isArray(j.entries))
      throw new Error('gallery index: unexpected format');
    return j;
  },
  async fetchBundle(entry) {
    const r = await fetch(new URL(`gallery/${entry.file}`, base()));
    if (!r.ok) throw new Error(`${entry.file}: HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  },
  getRepo: getStoreRepo,
  go: navigate,
};

type Load =
  { s: 'loading' } | { s: 'error'; message: string } | { s: 'ready'; index: GalleryIndexV1 };

const pct = (p: number): string => `${(p * 100).toFixed(1)}%`;
const kb = (n: number): string =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

export function GalleryView(props: ScreenProps & { deps?: GalleryDeps }) {
  const deps = props.deps ?? defaultGalleryDeps;
  const [load, setLoad] = useState<Load>({ s: 'loading' });
  const [opening, setOpening] = useState<string | null>(null);
  const [problem, setProblem] = useState<ImportProblem | null>(null);
  const [tries, setTries] = useState(0);
  const wanted = props.params['bundleId'];

  async function open(e: GalleryEntry) {
    setOpening(e.slug);
    setProblem(null);
    try {
      const bytes = await deps.fetchBundle(e);
      if ((await sha256Hex(bytes)) !== e.sha256) {
        setProblem({
          kind: 'damaged',
          title: 'This bundle is damaged',
          detail: 'file damaged: checksum does not match the gallery index',
        });
        return;
      }
      const out = await importBytes(bytes, await deps.getRepo(), 'gallery');
      if (!out.ok) setProblem(out.problem);
      else if (out.kind === 'run') deps.go(`#/analyze/${out.runId}`);
    } catch (err) {
      setProblem({
        kind: 'invalid',
        title: 'Could not open this bundle',
        detail: err instanceof Error ? err.message : 'unknown error',
      });
    } finally {
      setOpening(null);
    }
  }

  useEffect(() => {
    let live = true;
    setLoad({ s: 'loading' });
    deps
      .fetchIndex()
      .then((index) => {
        if (!live) return;
        setLoad({ s: 'ready', index });
        const hit = wanted ? index.entries.find((x) => x.slug === wanted) : undefined;
        if (hit) void open(hit);
      })
      .catch(
        (err: unknown) =>
          live &&
          setLoad({ s: 'error', message: err instanceof Error ? err.message : String(err) }),
      );
    return () => {
      live = false;
    };
  }, [tries, wanted]);

  return (
    <>
      <h1>Gallery</h1>
      <p class="lead">
        Curated result bundles. They open read-only; nothing here is changed or sent anywhere.
      </p>
      {problem ? (
        <p class="error" role="alert" data-problem={problem.kind}>
          <span aria-hidden="true">⚠ </span>
          <strong>{problem.title}.</strong> {problem.detail}
        </p>
      ) : null}
      {load.s === 'loading' ? (
        <Card>
          <p role="status" class="muted">
            Loading the gallery
          </p>
        </Card>
      ) : load.s === 'error' ? (
        <Card>
          <EmptyState
            title="The gallery could not be loaded"
            action={<Button onClick={() => setTries(tries + 1)}>Try again</Button>}
          >
            {load.message}. The gallery needs a connection the first time; bundles you opened before
            stay in your library.
          </EmptyState>
        </Card>
      ) : load.index.entries.length === 0 ? (
        <Card>
          <EmptyState
            title="No curated bundles yet"
            action={<Button href={href('/define')}>Run your own experiment</Button>}
          >
            The gallery will list finished experiments worth reading, each a result bundle you can
            open without running anything. Until then, run one yourself, or import a bundle someone
            sent you.
          </EmptyState>
        </Card>
      ) : (
        <ul class="gal-list" aria-label="Gallery bundles">
          {load.index.entries.map((e) => (
            <li key={e.slug}>
              <Card title={e.title} level={2}>
                {e.notes ? <p>{e.notes}</p> : null}
                {e.tags.length > 0 ? (
                  <ul class="chips" aria-label="Tags">
                    {e.tags.map((t) => (
                      <li key={t} class="chip-note">
                        {t}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <dl class="facts gal-facts">
                  <div>
                    <dt>Mean net per session</dt>
                    <dd>
                      {formatMoney(e.headline.meanNet)} ±{' '}
                      {formatMoney(Math.round(1.96 * e.headline.seMean))}
                    </dd>
                  </div>
                  <div>
                    <dt>Chance of finishing ahead</dt>
                    <dd>{pct(e.headline.pAhead)}</dd>
                  </div>
                  <div>
                    <dt>Chance of going bust</dt>
                    <dd>{pct(e.headline.pBust)}</dd>
                  </div>
                  <div>
                    <dt>Expected loss per hour</dt>
                    <dd>{formatMoney(Math.round(e.headline.expectedLossPerHour))}</dd>
                  </div>
                  <div>
                    <dt>Sessions</dt>
                    <dd>
                      {e.sessions.toLocaleString('en-US')} × {e.maxRounds.toLocaleString('en-US')}{' '}
                      rounds
                    </dd>
                  </div>
                  <div>
                    <dt>Size</dt>
                    <dd>
                      {kb(e.bytes)}
                      {e.trimmed ? ', trimmed' : ''}
                      {e.partial ? ', partial' : ''}
                    </dd>
                  </div>
                </dl>
                <Button
                  variant="primary"
                  disabled={opening !== null}
                  onClick={() => void open(e)}
                  aria-label={`Open ${e.title}`}
                >
                  {opening === e.slug ? 'Opening' : 'Open'}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function Gallery(props: ScreenProps) {
  return <GalleryView {...props} />;
}
