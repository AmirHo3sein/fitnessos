/**
 * Registers the jest-dom matcher types on vitest's `expect`.
 *
 * A `.d.ts` in `src` rather than a `types` entry in tsconfig: setting `types`
 * suppresses automatic @types discovery for every other package, which is a
 * large side effect for one matcher set.
 */
import '@testing-library/jest-dom/vitest'
