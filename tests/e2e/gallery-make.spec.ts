// Not part of the normal suite: `GALLERY_MAKE=1 PORT=<p> npx playwright test gallery-make --project=desktop`
// drives the real app (Define -> Run -> Analyze -> Export with the gallery trim) for each curated
// preset and writes gallery/<slug>.spinner.json.gz. Same seed for every run so they pair in Compare.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { expect, test } from './helpers';

const PRESETS = [
  [
    'flat-red',
    'Flat on red',
    'The baseline: the same $25 on red every spin.',
    ['flat', 'baseline'],
  ],
  [
    'martingale-red',
    'Martingale on red',
    'Double after every loss, back to one unit after a win, capped at 8 steps.',
    ['negative progression'],
  ],
  [
    'fibonacci-red',
    'Fibonacci on red',
    'Move along the Fibonacci sequence after a loss, back two places after a win.',
    ['negative progression'],
  ],
  [
    'james-bond',
    'James Bond',
    'A fixed spread of inside and outside bets covering 25 of 37 numbers.',
    ['fixed layout', 'inside'],
  ],
  [
    'dalembert-red',
    "d'Alembert on red",
    'Add one unit after a loss, take one away after a win.',
    ['negative progression'],
  ],
  [
    'labouchere-red',
    'Labouchere on red',
    'Cross off the ends of a list 1-2-3-4 and add to it after a loss.',
    ['cancellation'],
  ],
] as const;

/** Canonical JSON (sorted keys, no whitespace), as core-store writes it. */
function canonical(v: unknown): string {
  const sort = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(sort)
      : x && typeof x === 'object'
        ? Object.fromEntries(
            Object.entries(x as Record<string, unknown>)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, y]) => [k, sort(y)]),
          )
        : x;
  return JSON.stringify(sort(v));
}

/** Notes and tags are part of the definition id (sha256 of the canonical definition): recompute it. */
function annotate(file: string, notes: string, tags: readonly string[]): void {
  const b = JSON.parse(gunzipSync(readFileSync(file)).toString()) as {
    definitionId: string;
    definition: { notes?: string; tags?: string[] };
  };
  b.definition.notes = `${notes} 10,000 sessions of 500 spins, seed 2026.`;
  b.definition.tags = [...tags];
  b.definitionId = createHash('sha256').update(canonical(b.definition)).digest('hex');
  writeFileSync(file, gzipSync(canonical(b), { level: 9 }));
}

test.skip(process.env.GALLERY_MAKE !== '1', 'curation only');

for (const [preset, name, notes, tags] of PRESETS) {
  test(`gallery bundle: ${preset}`, async ({ page }) => {
    test.setTimeout(600_000);
    await page.goto(`./?e2e#/define?preset=${preset}`);
    await page.locator('#exp-name').fill(name);
    for (const card of ['Session', 'Run']) {
      const t = page.getByRole('button', { name: new RegExp(`^${card}`) });
      if ((await t.count()) && (await t.first().getAttribute('aria-expanded')) === 'false')
        await t.first().click();
    }
    await page.locator('#sessions').fill('10000');
    await page.locator('#rounds').fill('500');
    await page.locator('#seed').fill('2026');
    await page
      .getByRole('region', { name: 'Actions' })
      .getByRole('button', { name: 'Run', exact: true })
      .click();
    await expect(page.locator('[data-status=done]')).toBeVisible({
      timeout: Number(process.env.GALLERY_TO ?? 540_000),
    });
    await page.getByRole('link', { name: 'Analyze', exact: true }).click();
    await page.getByRole('tab', { name: 'Export' }).click();
    await page.getByRole('switch', { name: /Gallery trim/ }).click();
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download run file' }).click();
    const file = await dl;
    mkdirSync('gallery', { recursive: true });
    const out = join('gallery', `${preset}.spinner.json.gz`);
    await file.saveAs(out);
    annotate(out, notes, tags);
  });
}
