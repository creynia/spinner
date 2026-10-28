import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryBackend,
  createRepo,
  sha256Hex,
  type GalleryEntry,
  type GalleryIndexV1,
} from '@core';
import { classify, definitionLinkTarget, importBytes } from '@app/screens/Import/importFile';
import { ImportView } from '@app/screens/Import';
import { GalleryView, type GalleryDeps } from '@app/screens/Gallery';
import { rouletteDefinition } from './watch.fixture';

const fx = (n: string): Uint8Array =>
  new Uint8Array(readFileSync(join(process.cwd(), 'src/core/store/__fixtures__/runs/v1', n)));
const valid = fx('synth-small.spinner.json');
const gz = fx('synth-trimmed.spinner.json.gz');
type Doc = { game: { id: string }; version: number; meta: { resultsDigest: string } };
const edit = (mut: (o: Doc) => void): Uint8Array => {
  const o = JSON.parse(new TextDecoder().decode(valid)) as Doc;
  mut(o);
  return new TextEncoder().encode(JSON.stringify(o));
};
const foreign = edit((o) => (o.game.id = 'craps'));
const newer = edit((o) => (o.version = 2));
const damaged = edit((o) => (o.meta.resultsDigest = '0'.repeat(64)));

afterEach(cleanup);
const newRepo = () => createRepo(createMemoryBackend());

describe('importBytes', () => {
  it('stores a valid run marked imported, and recognises it the second time', async () => {
    const repo = newRepo();
    const a = await importBytes(valid, repo);
    if (!a.ok || a.kind !== 'run') throw new Error('expected a run');
    expect(a.status).toBe('imported');
    const meta = await repo.getRun(a.runId);
    expect(meta?.imported?.trimmed).toBe(false);
    expect(meta?.status).toBe('done');
    const b = await importBytes(valid, repo);
    expect(b.ok && b.kind === 'run' && b.status === 'exists' && b.runId === a.runId).toBe(true);
  });
  it('reads gzip by magic bytes (trimmed gallery bundle)', async () => {
    const out = await importBytes(gz, newRepo(), 'gallery');
    if (!out.ok || out.kind !== 'run') throw new Error('expected a run');
    expect((await newRepo().getRun(out.runId)) === undefined).toBe(true);
    expect(out.data.meta.imported?.trimmed).toBe(true);
  });
  it('reports a foreign game, a newer version, damage and non-spinner files', async () => {
    const repo = newRepo();
    const kind = async (b: Uint8Array) => {
      const o = await importBytes(b, repo);
      return o.ok ? 'ok' : o.problem.kind;
    };
    expect(await kind(foreign)).toBe('foreign-game');
    expect(await kind(newer)).toBe('newer-version');
    expect(await kind(damaged)).toBe('damaged');
    expect(await kind(new TextEncoder().encode('{"hello":1}'))).toBe('not-spinner');
    expect(await kind(new TextEncoder().encode('garbage'))).toBe('damaged');
    expect(await kind(Uint8Array.from([0x1f, 0x8b, 1, 2, 3]))).toBe('damaged');
    expect((await repo.listRuns()).length).toBe(0);
  });
  it('imports a definition.json and refuses a foreign or invalid one', async () => {
    const repo = newRepo();
    const def = rouletteDefinition();
    const out = await importBytes(new TextEncoder().encode(JSON.stringify(def)), repo);
    if (!out.ok || out.kind !== 'definition') throw new Error('expected a definition');
    expect((await repo.getDefinition(out.definitionId))?.origin).toBe('import');
    const other = await importBytes(
      new TextEncoder().encode(JSON.stringify({ ...def, game: { ...def.game, id: 'craps' } })),
      repo,
    );
    expect(!other.ok && other.problem.kind).toBe('foreign-game');
    const bad = await importBytes(
      new TextEncoder().encode(JSON.stringify({ ...def, session: { bankroll: -1, maxRounds: 0 } })),
      repo,
    );
    expect(!bad.ok && (bad.problem.items?.length ?? 0) > 0).toBe(true);
  });
  it('classifies messages and finds the definition in a pasted link', () => {
    expect(classify('this file is a craps run; open it in the craps lab').kind).toBe(
      'foreign-game',
    );
    expect(definitionLinkTarget('https://x.github.io/spinner/#/define?d=jabc&h=12')).toBe(
      '#/define?d=jabc&h=12',
    );
    expect(definitionLinkTarget('hello')).toBeNull();
  });
});

describe('Import screen', () => {
  const file = (bytes: Uint8Array, name: string): File => new File([bytes as BlobPart], name);
  async function drop(bytes: Uint8Array, name: string) {
    const repo = newRepo();
    const r = render(<ImportView getRepo={() => Promise.resolve(repo)} />);
    const input = r.container.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file(bytes, name)], configurable: true });
    fireEvent.change(input);
    await waitFor(() =>
      expect(r.container.querySelector('[data-result],[data-problem]')).not.toBeNull(),
    );
    return { r, repo };
  }
  it('has one h1, a file input, a drop zone and a link field', () => {
    const { container } = render(<ImportView getRepo={() => Promise.resolve(newRepo())} />);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('input[type=file]')).not.toBeNull();
    expect(container.querySelector('[data-dropzone]')).not.toBeNull();
    expect(container.querySelector('#imp-link-in')).not.toBeNull();
  });
  it('shows the next steps after a valid file', async () => {
    const { r } = await drop(valid, 'a.spinner.json');
    const links = [...r.container.querySelectorAll('[data-result=run] a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(links.some((h) => h?.startsWith('#/analyze/'))).toBe(true);
    expect(r.container.querySelector('.chip-note')!.textContent).toBe('imported');
  });
  it.each([
    ['foreign game', foreign, 'foreign-game', 'different game'],
    ['damaged file', damaged, 'damaged', 'damaged'],
    ['newer version', newer, 'newer-version', 'newer version'],
  ])('shows a clear error for a %s', async (_n, bytes, kind, text) => {
    const { r } = await drop(bytes, 'bad.spinner.json');
    const p = r.container.querySelector(`[data-problem=${kind}]`)!;
    expect(p.getAttribute('role')).toBe('alert');
    expect(p.textContent).toContain(text);
  });
  it('accepts dropped files', async () => {
    const repo = newRepo();
    const r = render(<ImportView getRepo={() => Promise.resolve(repo)} />);
    fireEvent.drop(r.container.querySelector('[data-dropzone]')!, {
      dataTransfer: { files: [file(valid, 'a.json')] },
    });
    await waitFor(() => expect(r.container.querySelector('[data-result=run]')).not.toBeNull());
  });
});

describe('Gallery screen', () => {
  const entry = async (bytes: Uint8Array): Promise<GalleryEntry> => ({
    file: 'demo-abcd1234.spinner.json',
    bytes: bytes.length,
    sha256: await sha256Hex(bytes),
    slug: 'demo',
    title: 'Demo bundle',
    notes: 'A note.',
    tags: ['martingale'],
    game: { id: 'roulette', version: '0.1.0' },
    coreVersion: '0.1.0',
    definitionId: 'd',
    runId: 'r',
    resultsDigest: 'x',
    trimmed: false,
    partial: false,
    sessions: 40,
    maxRounds: 100,
    bankroll: 100000,
    roundsPerHour: 60,
    headline: {
      meanNet: -4100,
      seMean: 300,
      pAhead: 0.38,
      pAheadCI: [0.3, 0.4],
      pBust: 0.02,
      pBustCI: [0, 0.05],
      expectedLossPerHour: 2700,
    },
  });
  const index = (entries: GalleryEntry[]): GalleryIndexV1 => ({
    format: 'casino-lab-gallery',
    version: 1,
    app: { id: 'spinner', version: 't' },
    totalBytes: 0,
    entries,
  });
  const mk = (entries: GalleryEntry[], bytes = valid, go = vi.fn()): GalleryDeps => {
    const repo = newRepo();
    return {
      fetchIndex: () => Promise.resolve(index(entries)),
      fetchBundle: () => Promise.resolve(bytes),
      getRepo: () => Promise.resolve(repo),
      go,
    };
  };
  const p = { params: {}, query: new URLSearchParams() };

  it('explains the empty gallery', async () => {
    const { container } = render(<GalleryView {...p} deps={mk([])} />);
    await waitFor(() => expect(container.querySelector('[data-empty]')).not.toBeNull());
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('.empty-title')!.textContent).toBe('No curated bundles yet');
  });
  it('lists entries with headline numbers and opens one read-only, idempotently', async () => {
    const e = await entry(valid);
    const go = vi.fn();
    const deps = mk([e], valid, go);
    const { container } = render(<GalleryView {...p} deps={deps} />);
    await waitFor(() => expect(container.querySelector('.gal-list')).not.toBeNull());
    const text = container.querySelector('.gal-list')!.textContent;
    expect(text).toContain('Demo bundle');
    expect(text).toContain('38.0%');
    expect(text).toContain('2.0%');
    const open = container.querySelector('button')!;
    fireEvent.click(open);
    await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
    fireEvent.click(container.querySelector('button')!);
    await waitFor(() => expect(go).toHaveBeenCalledTimes(2));
    expect(go.mock.calls[0]![0]).toMatch(/^#\/analyze\//);
    expect(go.mock.calls[1]![0]).toBe(go.mock.calls[0]![0]);
    expect((await (await deps.getRepo()).listRuns()).length).toBe(1);
  });
  it('refuses a bundle whose checksum differs from the index', async () => {
    const e = { ...(await entry(valid)), sha256: '0'.repeat(64) };
    const { container } = render(<GalleryView {...p} deps={mk([e])} />);
    await waitFor(() => expect(container.querySelector('.gal-list')).not.toBeNull());
    fireEvent.click(container.querySelector('button')!);
    await waitFor(() => expect(container.querySelector('[data-problem=damaged]')).not.toBeNull());
  });
  it('shows a retry card when the index cannot be fetched', async () => {
    const deps: GalleryDeps = {
      ...mk([]),
      fetchIndex: () => Promise.reject(new Error('offline')),
    };
    const { container } = render(<GalleryView {...p} deps={deps} />);
    await waitFor(() => expect(container.textContent).toContain('could not be loaded'));
  });
});
