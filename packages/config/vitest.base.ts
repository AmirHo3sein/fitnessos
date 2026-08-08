import { defineConfig } from 'vitest/config'

/**
 * Base config for framework-free packages: kernel, editor-engine, and the
 * domain, application and infra layers.
 *
 * These must run in the `node` environment with no DOM. A package that needs
 * jsdom is presentation code and belongs in a different tier of the testing
 * pyramid (handbook section 4.3).
 */
export const nodeTestConfig = defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // `*.int.test.ts` also matches the include glob above, so without this the
    // integration tier runs twice — once here and once in its own stage. The unit
    // tier is meant to be the fast one; silently doubling it defeats the split.
    exclude: ['**/node_modules/**', '**/*.int.test.ts'],
    passWithNoTests: true,
    typecheck: { enabled: false },
  },
})

export default nodeTestConfig
