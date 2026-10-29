// Define with chips, end to end at the four viewports (layouts.md WP-L7): tap a layout on the table
// and run it, lift a preset, a progression chip, cancelling the editor (and Android Back), and a
// sweep of the chip value. Axe, no overflow and no console errors at every state; screenshots go to
// SHOTS_DIR when set.
import { mkdirSync } from 'node:fs';
import { expect, screenCheck, test, type Page } from './helpers';

const SHOTS = process.env.SHOTS_DIR;
const actions = (page: Page) => page.getByRole('region', { name: 'Actions' });
const editor = (page: Page) => page.getByRole('dialog', { name: 'Chips on the table' });
const board = (page: Page) => editor(page).locator('.le-board');

async function shot(page: Page, name: string, project: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}-${project}.png` });
}

async function expandCards(page: Page): Promise<void> {
  for (const name of ['Session', 'Run']) {
    const t = page.getByRole('button', { name: new RegExp(`^${name}`) });
    if (await t.count()) {
      if ((await t.first().getAttribute('aria-expanded')) === 'false') await t.first().click();
    }
  }
}

/** A short run: 200 sessions of 30 spins. */
async function quickRun(page: Page, name: string): Promise<void> {
  await expandCards(page);
  await page.locator('#rounds').fill('30');
  await page.locator('#sessions').fill('200');
  await page.locator('#exp-name').fill(name);
}
async function runAndWait(page: Page): Promise<void> {
  await actions(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page).toHaveURL(/#\/run\/[^/]+$/, { timeout: 30_000 });
  await expect(page.locator('[data-status=done]')).toBeVisible({ timeout: 120_000 });
}

/** The definition ids of every run in this browser, oldest first (read from IndexedDB). */
async function runDefinitionIds(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('spinner');
        open.onerror = () => reject(new Error('cannot open the database'));
        open.onsuccess = () => {
          const all = open.result.transaction('runs').objectStore('runs').getAll();
          all.onsuccess = () => {
            const rows = all.result as { definitionId: string; createdAt: string }[];
            resolve(
              rows
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                .map((r) => r.definitionId),
            );
          };
          all.onerror = () => reject(new Error('cannot read runs'));
        };
      }),
  );
}

/** The strategy JSON as the definition sees it: keys sorted, empty rule lists dropped. */
async function strategyJson(page: Page): Promise<string> {
  await page.getByRole('radio', { name: 'JSON' }).click();
  const raw = JSON.parse(await page.getByLabel('Strategy JSON').inputValue()) as unknown;
  await page.getByRole('radio', { name: 'Builder' }).click();
  const norm = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(norm)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .filter(([k, x]) => !(k === 'rules' && Array.isArray(x) && x.length === 0))
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, norm(x)]),
          )
        : v;
  return JSON.stringify(norm(raw));
}

async function openMode(page: Page): Promise<void> {
  await editor(page).locator('.rl-mode').click();
}
/** Taps the edge shared by two neighbouring cells, with the bet-type lock on Split. */
async function tapBetween(page: Page, a: string, b: string): Promise<void> {
  const box = async (p: string) =>
    (await board(page).locator(`[data-pocket="${p}"]`).boundingBox())!;
  const [A, B] = [await box(a), await box(b)];
  await page.mouse.click(
    (A.x + A.width / 2 + B.x + B.width / 2) / 2,
    (A.y + A.height / 2 + B.y + B.height / 2) / 2,
  );
}

test('new strategy: Tap chips, Red x5 + a split + voisins at $5, run, results', async ({
  page,
  guard,
}, info) => {
  const project = info.project.name;
  await page.goto('./?e2e#/define');
  await expect(page.getByRole('heading', { name: 'Chips on the table' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Other bets' })).toBeVisible();
  await screenCheck(page, guard, 'define with the chips panel');
  await shot(page, 'define-chips-panel', project);

  await page.getByRole('button', { name: 'Tap chips' }).click();
  await expect(editor(page)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear' }).click();
  await expect(editor(page).getByText(/Empty/)).toBeVisible();

  // The first tap on a small layout is a hint, not a failure.
  await board(page).locator('[data-bet="red"]').first().click();
  await expect(editor(page).locator('.le-summary')).not.toContainText('!');
  for (let i = 0; i < 4; i++) await board(page).locator('[data-bet="red"]').first().click();
  await expect(editor(page).getByText(/5 chips · 1 spot/)).toBeVisible();

  // A split, in Split mode.
  await openMode(page);
  await page.getByRole('radio', { name: '2, split' }).click();
  await tapBetween(page, '17', '20');
  await expect(editor(page).getByText(/6 chips · 2 spots/)).toBeVisible();

  // Voisins du zero, from Call bets.
  await openMode(page);
  await page.getByRole('button', { name: /Call bets/ }).click();
  await page.getByRole('button', { name: /^Add 9 chips to Voisins/ }).click();
  await expect(
    page.getByRole('dialog', { name: 'Call bets' }).locator('output[aria-label^="9 chips"]'),
  ).toBeVisible();
  await shot(page, 'define-chips-editor-calls', project);
  await page
    .getByRole('dialog', { name: 'Call bets' })
    .getByRole('button', { name: 'Close' })
    .click();
  await expect(editor(page).getByText(/15 chips · 3 spots/)).toBeVisible();
  await screenCheck(page, guard, 'editor');
  await shot(page, 'define-chips-editor', project);
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);

  // The $5 chip: 15 chips = $75 a spin.
  await page
    .getByRole('radiogroup', { name: 'Chip value' })
    .getByRole('radio', { name: '$5', exact: true })
    .click();
  await expect(page.getByTestId('chip-value-text')).toContainText('$5');
  await expect(page.locator('.bchips-cost')).toContainText('$75 a spin');
  await expect(page.locator('.bchips-cost')).toContainText('fits this table');
  await screenCheck(page, guard, 'chips panel at $5');
  await shot(page, 'define-chips-panel-filled', project);

  await quickRun(page, 'Chips on the table e2e');
  await runAndWait(page);
  await screenCheck(page, guard, 'run done');
  await page.getByRole('link', { name: 'Analyze', exact: true }).click();
  await expect(page.locator('[data-verdict]')).toBeVisible();
  await screenCheck(page, guard, 'results');
});

test('a lifted preset (James Bond) runs unchanged: same definition id as the preset', async ({
  page,
  guard,
}) => {
  test.setTimeout(240_000);
  await page.goto('./?e2e#/define?preset=james-bond');
  await quickRun(page, 'Bond');
  await runAndWait(page);

  // Lift with "Edit on the table", look, and cancel: nothing changed.
  await page.goto('./?e2e#/define?preset=james-bond');
  await page.getByRole('button', { name: 'Edit on the table' }).click();
  await expect(editor(page)).toBeVisible();
  await screenCheck(page, guard, 'editor on a lifted preset');
  await editor(page).getByRole('button', { name: 'Back' }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit on the table' })).toBeVisible();
  await quickRun(page, 'Bond');
  await runAndWait(page);
  const [first, second] = await runDefinitionIds(page);
  expect(second).toBe(first);

  // Lifted and saved as is: the same bets, so the same spins, and it runs.
  await page.goto('./?e2e#/define?preset=james-bond');
  await page.getByRole('button', { name: 'Edit on the table' }).click();
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit chips' })).toBeVisible();
  await expect(page.locator('.bchips-title')).toContainText('3 spots');
  await quickRun(page, 'Bond lifted');
  await runAndWait(page);
  await screenCheck(page, guard, 'lifted preset run');
});

test('Martingale: the chip follows the progression', async ({ page, guard }) => {
  await page.goto('./?e2e#/define?preset=martingale-red');
  await page.getByRole('button', { name: 'Tap chips' }).click();
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('chip-value-text')).toContainText('Chips follow');
  await expect(page.getByLabel('Follows progression')).not.toHaveValue('');
  await expect(page.locator('.bchips-cost')).toContainText('From');
  await screenCheck(page, guard, 'follows progression');
  await quickRun(page, 'Chips martingale');
  await runAndWait(page);
});

test('cancel leaves the definition unchanged, and Android Back asks first', async ({
  page,
  guard,
}) => {
  await page.goto('./?e2e#/define');
  const before = await strategyJson(page);

  // Tap chips, change something, Back, Discard.
  await page.getByRole('button', { name: 'Tap chips' }).click();
  await board(page).locator('[data-bet="dozen:2"]').first().click();
  await editor(page).getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toBeVisible();
  await screenCheck(page, guard, 'discard changes');
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  expect(await strategyJson(page)).toBe(before);

  // Android Back with unsaved edits: the guard, not a lost editor.
  await page.getByRole('button', { name: 'Tap chips' }).click();
  await board(page).locator('[data-bet="dozen:2"]').first().click();
  await page.evaluate(() => history.back());
  await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toBeVisible();
  await expect(editor(page)).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await page.evaluate(() => history.back());
  await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toBeVisible();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  expect(await strategyJson(page)).toBe(before);
  await guard.check('after cancel');
});

test('sweep the chip value: $5 / $25 / $100', async ({ page, guard }) => {
  test.setTimeout(300_000);
  await page.goto('./?e2e#/define');
  await page.getByRole('button', { name: 'Tap chips' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear' }).click();
  for (let i = 0; i < 5; i++) await board(page).locator('[data-bet="red"]').first().click();
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
  await page
    .getByRole('radiogroup', { name: 'Chip value' })
    .getByRole('radio', { name: '$5', exact: true })
    .click();
  await quickRun(page, 'Chip sweep base');
  await runAndWait(page);

  await page.goto('./?e2e#/sweep/new');
  const baseValue = await page
    .locator('#sw-base option', { hasText: /^Chip sweep base/ })
    .first()
    .getAttribute('value');
  await page.locator('#sw-base').selectOption(baseValue);
  await page.locator('#sw-path').selectOption({ label: 'Stage flat: chip value (now 500)' });
  await page.locator('#sw-values').fill('500, 2500, 10000');
  await screenCheck(page, guard, 'sweep form');
  await page.getByRole('button', { name: 'Create and run' }).click();
  await expect(page).toHaveURL(/#\/sweep\/.+/);
  await expect(page.locator('p', { hasText: 'variants finished' })).toContainText(
    '3 of 3 variants finished',
    {
      timeout: 240_000,
    },
  );
  await screenCheck(page, guard, 'sweep done');
});
