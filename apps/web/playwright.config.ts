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
const STUB_API = process.env['STUB_API_URL'] ?? 'http://127.0.0.1:8791'

/**
 * Wipe the stub before the suite.
 *
 * The stub is stateful by design — logging a session has to actually change what is upcoming, or
 * the write path cannot be asserted end to end. Locally Playwright reuses a running stub, so that
 * state outlives the run and a later run finds sessions already logged.
 */
const globalSetup = new URL('./e2e/reset-stub.ts', import.meta.url).pathname

export default defineConfig({
  globalSetup,
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

  /**
   * Two servers: the stub API and the app.
   *
   * The stub is a separate process, never part of the app build — an endpoint that
   * returns fabricated athlete data must not be capable of existing in a production
   * bundle. Both the RSC prefetch (server-side, via INTERNAL_API_URL) and the browser
   * (relative /api/v1, via the rewrite STUB_API_URL enables) reach the same process,
   * so the whole request path is exercised rather than half of it.
   */
  webServer: [
    {
      command: 'pnpm --filter @fitnessos/stub-api start',
      url: `${STUB_API}/api/v1/athletes/me`,
      reuseExistingServer: !process.env['CI'],
      timeout: 30_000,
      // /athletes/me answers 401 without a session, which is a valid readiness signal.
      ignoreHTTPSErrors: true,
    },
    {
      command: 'pnpm start',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      env: {
        // The app refuses to start without this (see composition/server.ts).
        INTERNAL_API_URL: `${STUB_API}/api/v1`,
        STUB_API_URL: STUB_API,
      },
    },
  ],
})
