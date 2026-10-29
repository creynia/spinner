// The Compare picker lists experiments by name and a relative time, never a hash or run id; two runs
// with the same name and time get a sessions disambiguator. Four viewports, axe, no overflow.
import { expect, screenCheck, test, type Page } from './helpers';

const go = (page: Page, hash: string) => page.evaluate((h) => void (location.hash = h), hash);

async function finished(page: Page, opts: string): Promise<string> {
  await go(page, '#/');
  const id = await page.evaluate<string>(`window.__results.start(${opts})`);
  // The Library links to Analyze only once the run is done.
  await expect(async () => {
    await go(page, '#/');
    await go(page, '#/library?tab=runs');
    await expect(page.locator(`a[href$="/analyze/${id}"]`)).toHaveCount(1, { timeout: 1500 });
  }).toPass({ timeout: 60_000 });
  return id;
}

test('Compare picker shows names and relative times, no hashes', async ({ page, guard }, info) => {
  test.setTimeout(120_000);
  await page.goto('./?e2e#/');
  await page.waitForFunction('window.__results !== undefined');
  const a = await finished(page, "{ name: 'Picker alpha', sessions: 30, maxRounds: 20 }");
  const b = await finished(page, "{ name: 'Picker twin', sessions: 30, maxRounds: 20, seed: 1 }");
  const c = await finished(page, "{ name: 'Picker twin', sessions: 40, maxRounds: 20, seed: 2 }");

  await go(page, `#/compare?runs=${a}`);
  const select = page.getByLabel('Finished runs');
  await expect(select).toBeVisible();
  const options = await select.locator('option').allTextContents();
  expect(options[0]).toBe('Choose a run');
  const rest = options.slice(1);
  expect(rest).toHaveLength(2);
  for (const o of rest) {
    expect(o).toMatch(
      /^Picker twin( · [\d,]+ sess\.)?( · seed \d+)? · (just now|\d+ seconds? ago|\d+ minutes? ago)$/,
    );
    expect(o).not.toMatch(/[0-9a-f]{8,}/);
  }
  // same name, possibly the same label: either way every option is distinguishable
  expect(new Set(rest).size).toBe(2);
  // values keep the ids for the app
  expect(
    await select
      .locator('option')
      .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value)),
  ).toEqual(expect.arrayContaining([b, c]));
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/[0-9a-f]{16,}/);
  await screenCheck(page, guard, 'compare picker');

  await select.selectOption(c);
  if (process.env.SHOTS_DIR)
    await select.screenshot({
      path: `${process.env.SHOTS_DIR}/compare-picker-${info.project.name}.png`,
    });
  await select.selectOption(b);
  await page.getByRole('button', { name: 'Add to comparison' }).click();
  await expect(page.getByRole('list', { name: 'Runs being compared' })).toContainText(
    'Picker twin',
  );
  await screenCheck(page, guard, 'compare with two runs');
});
