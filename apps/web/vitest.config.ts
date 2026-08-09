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
  /*
   * `jsx: 'automatic'`, which the workspace packages do not need.
   *
   * Vitest transforms with esbuild, which takes its JSX setting from tsconfig. Packages compile
   * with `"jsx": "react-jsx"`; this app uses `"jsx": "preserve"` because Next owns the
   * transform. Under test there is no Next, so every component rendered here failed with
   * "React is not defined" — a build-configuration error that reads like a missing import.
   */
  esbuild: { jsx: 'automatic' },
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
})
