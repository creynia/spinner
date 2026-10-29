// WP-S4 sync UI at the four viewports: the Account card in every state, the shell indicator, the
// sheets. The S0 service is inert, so the test drives its stores through `window.__spinnerSync`
// (installed with `?e2e`). Each state: no horizontal overflow, axe clean, tap targets >= 44 px.
import { mkdirSync } from 'node:fs';
import { expect, expectAxeClean, test, type Page } from './helpers';

const SHOTS = process.env.SHOTS_DIR;

type Setter = (s: Record<string, unknown>) => void;
async function drive(page: Page, store: string, value: unknown): Promise<void> {
  await page.evaluate(
    ([name, v]) => {
      const svc = (window as unknown as { __spinnerSync: Record<string, { set: Setter }> })
        .__spinnerSync;
      svc[name]!.set(v as Record<string, unknown>);
    },
    [store, value] as const,
  );
}

const status = (p: Record<string, unknown>) => ({
  state: 'idle',
  pending: 0,
  remoteOnly: { runs: 0, bytes: 0 },
  conflicts: 0,
  ...p,
});
const signedIn = { state: 'signed-in', email: 'owner@gmail.com', expiresAt: Date.now() + 3600_000 };

async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll(
      'button, a, summary, [role=radio], select, input:not(.visually-hidden)',
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.closest('[inert]')) continue;
      if (r.height < 43.5)
        bad.push(`${el.tagName}.${el.className} "${el.textContent}" ${Math.round(r.height)}`);
    }
    return bad;
  });
}

async function shot(page: Page, name: string, project: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/sync-${name}-${project}.png`, fullPage: true });
}

test('Account card: every state is clean at this viewport', async ({ page, guard }, info) => {
  await page.goto('./?e2e#/settings?account=1');
  await expect(page.locator('h1')).toHaveCount(1);
  const check = async (label: string) => {
    await guard.check(label);
    await expectAxeClean(page, label);
    expect(await smallTargets(page), `${label}: small targets`).toEqual([]);
  };

  await drive(page, 'syncAuth', { state: 'unconfigured' });
  await expect(page.getByText('Sync is not set up in this build.')).toBeVisible();
  await check('unconfigured');

  await drive(page, 'syncAuth', { state: 'signed-out' });
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await check('signed-out');
  await shot(page, 'signed-out', info.project.name);

  await drive(page, 'syncStatus', status({ state: 'off', disabledReason: 'memory-backend' }));
  await expect(page.getByText('Sync needs storage that persists.')).toBeVisible();
  await check('memory-backend');

  await drive(page, 'syncAuth', signedIn);
  await drive(page, 'syncPrefs', { enabled: true, deviceName: 'Pixel 11', runDownload: 'onOpen' });
  await drive(page, 'syncAbout', {
    email: 'owner@gmail.com',
    displayName: 'Owner',
    accountId: 'x',
    usage: 182 * 1024 * 1024,
    limit: 15 * 1024 ** 3,
    deviceBytes: 96 * 1024 * 1024,
  });
  await drive(page, 'syncDevices', [
    { id: 'a', name: 'Pixel 11', lastSyncedAt: new Date().toISOString(), appVersion: '0.1.0' },
    {
      id: 'b',
      name: 'Laptop',
      lastSyncedAt: new Date(Date.now() - 86400_000 * 3).toISOString(),
      appVersion: '0.1.0',
    },
  ]);
  await drive(page, 'conflictNotices', [
    {
      id: 'n1',
      at: new Date().toISOString(),
      key: 'def:x',
      kind: 'def',
      message:
        '“Big Martingale” was changed on two devices; this device’s copy is now “Big Martingale (Laptop)”.',
      read: false,
    },
  ]);

  const states: [string, Record<string, unknown>][] = [
    [
      'idle',
      {
        lastSyncedAt: new Date(Date.now() - 120_000).toISOString(),
        remoteOnly: { runs: 12, bytes: 31 * 1024 * 1024 },
        conflicts: 1,
        clockSkewDevice: 'Laptop',
      },
    ],
    [
      'syncing',
      {
        state: 'syncing',
        progress: { phase: 'upload-runs', done: 3, total: 12, bytes: 14 * 1024 * 1024 },
      },
    ],
    ['offline', { state: 'offline', pending: 4 }],
    ['needs-auth-pending', { state: 'needs-auth', pending: 4 }],
    ['needs-auth-clean', { state: 'needs-auth' }],
    ['waiting-run', { state: 'waiting-run' }],
    ['backoff', { state: 'backoff', retryAt: Date.now() + 120_000 }],
    ['drive-full', { state: 'drive-full' }],
    ['local-full', { state: 'local-full' }],
    ['error-newer', { state: 'error', error: { code: 'newer-layout', message: 'x' } }],
    ['error-access', { state: 'error', error: { code: 'access-removed', message: 'x' } }],
  ];
  for (const [name, s] of states) {
    await drive(page, 'syncStatus', status(s));
    await expect(page.locator('[data-sync-status]')).toBeVisible();
    await check(name);
    if (name === 'idle' || name === 'needs-auth-pending') await shot(page, name, info.project.name);
  }

  // Sheets
  await drive(page, 'syncStatus', status({}));
  await page.getByRole('button', { name: /notice/ }).click();
  await expect(page.getByRole('dialog', { name: 'Notices' })).toBeVisible();
  await check('notices sheet');
  await shot(page, 'notices', info.project.name);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Remove my data from Drive…' }).click();
  await expect(page.getByRole('dialog', { name: 'Remove from Drive?' })).toBeVisible();
  await check('remove sheet');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Rename' }).click();
  await check('rename sheet');
  await page.keyboard.press('Escape');
});

test('first-sync and account-switch sheets', async ({ page, guard }, info) => {
  await page.goto('./?e2e#/settings');
  await drive(page, 'syncAuth', signedIn);
  await drive(page, 'syncStatus', status({}));
  const counts = { experiments: 5, strategies: 2, layouts: 0, runs: 2, runBytes: 2 << 20 };
  await drive(page, 'firstSyncPrompt', {
    remoteEmpty: false,
    remote: {
      fromName: 'Laptop',
      syncedAt: new Date(Date.now() - 86400_000).toISOString(),
      experiments: 42,
      strategies: 9,
      layouts: 6,
      runs: 18,
      runBytes: 31 << 20,
    },
    local: counts,
  });
  const dlg = page.getByRole('dialog', { name: 'Your Drive already has data' });
  await expect(dlg).toBeVisible();
  await guard.check('first sync');
  await expectAxeClean(page, 'first sync');
  expect(await smallTargets(page)).toEqual([]);
  await shot(page, 'first-sync', info.project.name);
  await dlg.getByRole('button', { name: "Replace this device's data" }).click();
  await expect(page.getByRole('dialog', { name: "Replace this device's data?" })).toBeVisible();
  await guard.check('replace confirm');
  await expectAxeClean(page, 'replace confirm');

  await drive(page, 'firstSyncPrompt', { remoteEmpty: true, remote: counts, local: counts });
  await expect(page.getByRole('dialog', { name: "Upload this device's library?" })).toBeVisible();
  await expectAxeClean(page, 'empty drive');
  await drive(page, 'firstSyncPrompt', null);

  await drive(page, 'accountSwitchPrompt', { from: 'a@x.com', to: 'b@x.com' });
  await expect(page.getByRole('dialog', { name: 'Use a different Google account?' })).toBeVisible();
  await guard.check('account switch');
  await expectAxeClean(page, 'account switch');
  await shot(page, 'account-switch', info.project.name);
});

test('shell indicator: hidden off, muted when paused, amber and Reconnect when it matters', async ({
  page,
  guard,
}, info) => {
  await page.goto('./?e2e#/');
  const ind = page.locator('[data-sync-indicator]:visible');
  await expect(ind).toHaveCount(0);
  await drive(page, 'syncAuth', signedIn);
  await drive(page, 'syncStatus', status({}));
  await expect(ind).toHaveCount(1);
  await expect(ind).not.toHaveClass(/attention/);
  await guard.check('idle');
  await expectAxeClean(page, 'indicator idle');
  const box = (await ind.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(43.5);
  expect(box.height).toBeGreaterThanOrEqual(43.5);

  await drive(page, 'syncStatus', status({ state: 'needs-auth' }));
  await expect(ind).not.toHaveClass(/attention/);
  await drive(page, 'syncStatus', status({ state: 'needs-auth', pending: 3 }));
  await expect(ind).toHaveClass(/attention/);
  await expect(ind).toHaveAttribute('aria-label', 'Reconnect: Sign-in expired · 3 changes waiting');
  const wide = (page.viewportSize()?.width ?? 0) >= 400;
  await expect(ind.getByText('Reconnect')).toBeVisible({ visible: wide });
  await guard.check('amber');
  await expectAxeClean(page, 'indicator amber');
  await shot(page, 'indicator-amber', info.project.name);

  await drive(page, 'syncStatus', status({ state: 'idle' }));
  await ind.click();
  await expect(page).toHaveURL(/#\/settings\?account=1$/);
});
