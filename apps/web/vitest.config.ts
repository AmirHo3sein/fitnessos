import { mergeConfig } from 'vitest/config'
import { componentTestConfig } from '@fitnessos/config/vitest.component.ts'

/**
 * The shared component config, widened to `.ts` as well as `.tsx`.
 *
 * The app has logic that is neither a component nor a package — the CSP policy builder, and
 * whatever joins it — and the base config's `src/**\/*.test.tsx` silently skips those files. A
 * test suite that reports "no test files found" and exits 0 is the failure mode worth avoiding:
 * it looks exactly like a suite that passed.
 */
export default mergeConfig(componentTestConfig, {
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
})
