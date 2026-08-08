import { defineConfig, devices } from '@playwright/test'

/**
 * E2E — 2% of the pyramid (handbook section 4.3), and the only tier with a real
 * layout engine.
 *
 * That last part is the reason this tier exists at all. jsdom returns zeros from
 * `getBoundingClientRect`, has no compositor and stubs pointer capture, so drag,
 * snap, hit-testing and virtualised scroll cannot be tested anywhere else. When the
 * editor lands, its geometry lives here — and only its geometry. Everything that
 * can be tested with less machinery should be.
 *
 * `@critical` marks the flows that must never break. CI runs only those on every
 * PR; the full suite runs on a schedule. A 2% tier that takes twenty minutes stops
 * being run, and a test nobody runs is worse than no test, because it still looks
 * like coverage.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  // Spread rather than `workers: undefined`. Under `exactOptionalPropertyTypes` an
  // explicit `undefined` is not the same as an absent key, and Playwright's own
  // idiom of assigning undefined to mean "use the default" does not typecheck.
  ...(process.env['CI'] ? { workers: 2 } : {}),
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Persian RTL on a phone is the primary experience, not an edge case, so it is
    // a first-class project rather than a variant added later.
    { name: 'mobile-rtl', use: { ...devices['Pixel 7'], locale: 'fa-IR' } },
  ],

  webServer: {
    command: 'pnpm start',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    env: {
      // The app refuses to start without this (see composition/server.ts). E2E
      // points it at a stub API rather than a real backend, so a failing backend
      // cannot fail the frontend's own critical-path suite.
      INTERNAL_API_URL: process.env['INTERNAL_API_URL'] ?? 'http://127.0.0.1:3000/api/v1',
    },
  },
})
