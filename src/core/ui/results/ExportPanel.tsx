// Export tab: run bundle (.spinner.json[.gz], optional gallery trim), summaries.csv, fan.csv,
// definition.json and a share link. Everything is built from the stored run, in the browser.
import { useState } from 'preact/hooks';
import type { RunData } from '../../contracts/run';
import { fanChart } from '../../analysis';
import { encodeShareLink, exportDefinitionFile, hasCompression } from '../../experiment';
import { formatDollarsExact } from '../../money';
import { encodeRunBundle, runFileName, summariesCsv } from '../../store';
import { Button, Card, Toggle } from '../kit';
import { fmtBytes } from './format';

export interface ExportPanelProps {
  data: RunData;
  /** Base URL for the share link, e.g. `https://host/spinner/` (default: this page without the hash). */
  baseUrl?: string;
}

/** `fan.csv` (harness-data-analysis.md section 10.3), net in dollars. */
export function fanCsv(data: RunData): string {
  const f = fanChart(data);
  const rph = data.definition.session.roundsPerHour;
  const d = (v: number) => (Number.isFinite(v) ? formatDollarsExact(Math.round(v)) : '');
  const lines = ['checkpoint,round,hours,p5,p25,p50,p75,p95,mean,expected,alive_share'];
  for (let i = 0; i < f.rounds.length; i++) {
    const r = f.rounds[i]!;
    lines.push(
      [
        i,
        r,
        (r / rph).toFixed(4),
        d(f.p5[i]!),
        d(f.p25[i]!),
        d(f.p50[i]!),
        d(f.p75[i]!),
        d(f.p95[i]!),
        d(f.mean[i]!),
        d(f.expected[i]!),
        f.alive[i]!.toFixed(6),
      ].join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

function save(name: string, bytes: Uint8Array | string, type: string): void {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ExportPanel({ data, baseUrl }: ExportPanelProps) {
  const [trim, setTrim] = useState(false);
  const [status, setStatus] = useState('');
  const [link, setLink] = useState('');
  const name = data.definition.name;
  const runId = data.meta.runId;
  const gz = hasCompression();
  const partial = data.sessions < data.meta.sessions;

  const run = async (what: string, fn: () => Promise<void> | void) => {
    setStatus(`Preparing ${what}...`);
    try {
      await fn();
      setStatus(`${what} ready.`);
    } catch (e) {
      setStatus(`Could not export ${what}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const bundle = () =>
    run('run file', async () => {
      const bytes = await encodeRunBundle(data, { gzip: gz, trimForGallery: trim });
      save(
        runFileName(name, runId, gz ? 'gzip' : 'bundle'),
        bytes,
        gz ? 'application/gzip' : 'application/json',
      );
      setStatus(`Run file saved (${fmtBytes(bytes.length)}${trim ? ', gallery trim' : ''}).`);
    });
  const csv = () =>
    run('summaries.csv', () =>
      save(runFileName(name, runId, 'csv'), summariesCsv(data), 'text/csv'),
    );
  const fan = () =>
    run('fan.csv', () =>
      save(runFileName(name, runId, 'csv').replace('summaries', 'fan'), fanCsv(data), 'text/csv'),
    );
  const def = () =>
    run('definition.json', () =>
      save('definition.json', exportDefinitionFile(data.definition), 'application/json'),
    );
  const share = () =>
    run('share link', async () => {
      const r = await encodeShareLink(data.definition);
      if ('tooLong' in r) {
        setLink('');
        setStatus('This definition is too long for a link. Download definition.json instead.');
        return;
      }
      const base = baseUrl ?? `${location.origin}${location.pathname}`;
      const url = `${base}${r.hash}`;
      setLink(url);
      try {
        await navigator.clipboard.writeText(url);
        setStatus('Share link copied.');
      } catch {
        setStatus('Share link ready below; copy it from the box.');
      }
    });

  return (
    <div class="export-grid">
      <Card title="Run file">
        <p class="muted">
          Everything needed to analyze this run again, on any device:{' '}
          {gz ? 'gzip-compressed JSON' : 'JSON'}
          {partial
            ? `; only the first ${data.sessions.toLocaleString('en-US')} of ${data.meta.sessions.toLocaleString('en-US')} sessions`
            : ''}
          .
        </p>
        <Toggle
          label="Gallery trim (smaller: 48 checkpoints, 6 samples)"
          checked={trim}
          onChange={setTrim}
        />
        <div class="actions">
          <Button variant="primary" onClick={() => void bundle()}>
            Download run file
          </Button>
        </div>
      </Card>
      <Card title="Tables">
        <p class="muted">Spreadsheet-friendly, money in dollars.</p>
        <div class="actions">
          <Button onClick={() => void csv()}>summaries.csv</Button>
          <Button onClick={() => void fan()}>fan.csv</Button>
        </div>
      </Card>
      <Card title="Definition">
        <p class="muted">The experiment itself, to run again or share.</p>
        <div class="actions">
          <Button onClick={() => void def()}>definition.json</Button>
          <Button onClick={() => void share()}>Copy share link</Button>
        </div>
        {link ? (
          <input
            class="input share-link"
            readOnly
            value={link}
            aria-label="Share link"
            onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
          />
        ) : null}
      </Card>
      <p role="status" class="export-status muted">
        {status}
      </p>
    </div>
  );
}
