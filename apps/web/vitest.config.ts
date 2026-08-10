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
  /*
   * `composition/` as well as `src/`, and this was itself the failure the comment above describes.
   *
   * `composition/invalidation.test.ts` — which asserts that the event stream's invalidation map
   * targets query keys that actually exist — sat outside `src/` and was silently not collected. The
   * suite reported 25 passing tests and exit 0, and the test that would have caught a real defect
   * ran zero times.
   *
   * `composition` is where the container is assembled, so it is exactly where a wiring test belongs.
   * Widening the glob is the fix; moving the test into `src/` would put it away from the code it is
   * about in order to satisfy a pattern.
   */
  test: {
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'composition/**/*.test.ts',
      'composition/**/*.test.tsx',
    ],
  },
})
