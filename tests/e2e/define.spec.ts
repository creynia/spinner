// Define at the four viewports: structure, no overflow, axe, tap targets; Quick check; define ->
// run navigation; share-link round trip. Screenshots go to SHOTS_DIR when set.
import { mkdirSync } from 'node:fs';
import { expect, expectAxeClean, test, type Page } from './helpers';

const SHOTS = process.env.SHOTS_DIR;

const actions = (page: Page) => page.getByRole('region', { name: 'Actions' });

async function expandAll(page: Page): Promise<void> {
  for (const name of ['Game & rules', 'Session', 'Run']) {
    const t = page.getByRole('button', { name: new RegExp(`^${name}`) });
    if (await t.count()) {
      if ((await t.first().getAttribute('aria-expanded')) === 'false') await t.first().click();
    }
  }
}

test('Define: one h1, four cards, no overflow, axe clean, tap targets', async ({
  page,
  guard,
}, info) => {
  await page.goto('./?e2e#/define');
  await expect(page.locator('h1')).toHaveCount(1);
  for (const name of ['Game & rules', 'Strategy', 'Session', 'Run']) {
    await expect(page.getByRole('heading', { level: 2, name: new RegExp(name) })).toBeVisible();
  }
  await expect(page.locator('li.bstage').first()).toBeVisible();
  await guard.check('define');
  await expandAll(page);
  await guard.check('define expanded');
  await expectAxeClean(page, 'define');
  const small = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll(
      'button, a.btn, [role=radio], [role=tab], select, input:not([type=hidden])',
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 43.5) bad.push(`${el.tagName}.${el.className} ${Math.round(r.height)}`);
    }
    return bad;
  });
  expect(small).toEqual([]);

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    const kind = info.project.name;
    await page.screenshot({ path: `${SHOTS}/define-full-${kind}.png`, fullPage: true });
    for (const id of ['define-game', 'define-strategy', 'define-session', 'define-run']) {
      await page.locator(`#${id}`).screenshot({ path: `${SHOTS}/${id}-${kind}.png` });
    }
  }
});

test('Define: builder editors open as sheets and the JSON tab stays in sync', async ({
  page,
  guard,
}) => {
  await page.goto('./?e2e#/define?preset=martingale-red');
  await page.locator('li.blayout button.bchip').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectAxeClean(page, 'bet sheet');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('radio', { name: 'JSON' }).click();
  const area = page.getByLabel('Strategy JSON');
  await expect(area).toHaveValue(/martingale/);
  await guard.check('json tab');
});

test('Define: validation panel lists JSON-pointer errors and blocks Run', async ({
  page,
  guard,
}, info) => {
  await page.goto('./?e2e#/define');
  await page.getByRole('radio', { name: 'JSON' }).click();
  const area = page.getByLabel('Strategy JSON');
  const doc = JSON.parse(await area.inputValue()) as { stages: { layout: { bet: string }[] }[] };
  doc.stages[0]!.layout[0]!.bet = 'nope';
  await area.fill(JSON.stringify(doc, null, 2));
  await expect(page.getByRole('button', { name: /Validation: 1 error/ })).toBeVisible();
  await expect(actions(page).getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
  if ((page.viewportSize()?.width ?? 0) >= 768) {
    await expect(page.locator('.define-diags')).toContainText('/stages/0/layout/0/bet');
  } else {
    await page.getByRole('button', { name: /Validation: 1 error/ }).click();
    await expect(page.getByRole('dialog')).toContainText('/stages/0/layout/0/bet');
    await expectAxeClean(page, 'validation sheet');
    await page.keyboard.press('Escape');
  }
  await guard.check('invalid');
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({
      path: `${SHOTS}/define-validation-${info.project.name}.png`,
      fullPage: true,
    });
  }
});

test('Define: Quick check shows a verdict, Run goes to the run page', async ({ page, guard }) => {
  await page.goto('./?e2e#/define');
  const t0 = Date.now();
  await actions(page).getByRole('button', { name: 'Quick check' }).click();
  await expect(page.locator('.define-verdict')).toContainText('P(ahead)', { timeout: 20_000 });
  expect(Date.now() - t0).toBeLessThan(20_000);
  await guard.check('quick check');
  await actions(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page).toHaveURL(/#\/run\/[^/]+$/, { timeout: 20_000 });
});

test('Define: share link round trip', async ({ page, guard }) => {
  await page.goto('./?e2e#/define');
  await page.locator('#exp-name').fill('Round trip one');
  await expandAll(page);
  await page.locator('#seed').fill('4242');
  await page.getByRole('button', { name: 'Share link' }).click();
  const link = await page.getByLabel('Link').inputValue();
  expect(link).toContain('#/define?d=');
  await page.keyboard.press('Escape');
  await page.goto('about:blank');
  await page.goto(link);
  await expect(page.locator('#exp-name')).toHaveValue('Round trip one');
  await expandAll(page);
  await expect(page.locator('#seed')).toHaveValue('4242');
  await expect(page.locator('.define-notice')).toContainText('Loaded from a link');
  await guard.check('loaded link');
});
