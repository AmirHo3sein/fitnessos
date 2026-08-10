import { defineConfig } from 'vitest/config'

/**
 * The conformance suite runs against a LIVE server, so it is not part of `pnpm check`.
 *
 * Serial, with a generous timeout: several checks write and then read back, and a real backend across
 * a network is not a stub on loopback. Parallel workers would also race each other's writes on one
 * account, which is the kind of failure that reads as a contract violation and is not one.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.conformance.ts'],
    testTimeout: 30_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
})
