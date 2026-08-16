import { defineConfig, devices } from '@playwright/test'

/**
 * A config of its own, and the differences from `apps/web/playwright.config.ts` are the point.
 *
 * No `webServer`: this suite does NOT start anything. The whole claim it makes is about a topology
 * somebody stood up — proxy, production build, real API, real database — and a config that starts
 * the app for you is a config that quietly starts a different app from the one being verified.
 *
 * No `globalSetup`: nothing to reset, because there is no stub. Each test signs in as a phone
 * number derived from the clock, so runs do not collide and nothing needs tearing down.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /(smoke|journey)\.spec\.ts/,
  fullyParallel: false,
  reporter: 'list',
  timeout: 60_000,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
