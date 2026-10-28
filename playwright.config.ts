import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 4173);
const BASE = `http://localhost:${PORT}/spinner/`;
const perf = process.env.PERF === '1';

// Browsers: @playwright/test is pinned to the preinstalled /opt/pw-browsers build (chromium-1243).
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The shared VM runs many agents: the resource baton passes PW_WORKERS (default 2).
  workers: Number(process.env.PW_WORKERS ?? 2),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: BASE, trace: 'retain-on-failure' },
  projects: [
    { name: 'phone-360', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    {
      name: 'phone-landscape',
      use: { ...devices['Pixel 7 landscape'], viewport: { width: 844, height: 390 } },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    ...(perf
      ? [{ name: 'perf', testDir: 'tests/perf', use: { ...devices['Desktop Chrome'] } }]
      : []),
  ],
  // Serves the already-built dist (test:e2e / test:perf build first; CI downloads the artifact).
  webServer: {
    command: `npx vite preview --base /spinner/ --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
