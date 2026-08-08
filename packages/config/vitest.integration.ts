import { defineConfig } from 'vitest/config'

/**
 * Base config for the integration tier — 20% of tests (handbook section 4.3).
 *
 * `node` environment, no DOM: these exercise infra against a mocked *network*, not
 * a mocked module. The distinction is the whole point. A test that stubs
 * `athleteFrom` proves the mapper was called; a test that intercepts the HTTP
 * response proves the mapper is correct about what the backend actually sends.
 *
 * Separate file glob (`*.int.test.ts`) so the unit tier stays fast. Nothing here
 * may reach a real network — MSW fails the test on an unhandled request.
 */
export const integrationTestConfig = defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.int.test.ts'],
    passWithNoTests: true,
    typecheck: { enabled: false },
  },
})

export default integrationTestConfig
