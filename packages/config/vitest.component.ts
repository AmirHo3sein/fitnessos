import { defineConfig } from 'vitest/config'

/**
 * Base config for the component tier of the pyramid — 8% of tests
 * (handbook section 4.3).
 *
 * jsdom has no layout engine. `getBoundingClientRect` returns zeros, there is no
 * compositor, and pointer capture is a stub. So anything that depends on real
 * geometry — drag, snap, hit-testing, virtualised scroll — cannot be tested here
 * and must not be attempted here. It goes to Playwright, or better, to a unit
 * test of the pure geometry function with no DOM at all.
 *
 * What this tier is for: a component wired to real state renders the right thing
 * and responds to a real user event.
 */
export const componentTestConfig = defineConfig({
  // An inline PostCSS config, which suppresses config-file discovery.
  //
  // Without it, vitest walks up and finds `apps/web/postcss.config.mjs` — the
  // Tailwind v4 pipeline, which only loads inside a Next build and otherwise fails
  // with "Invalid PostCSS Plugin". jsdom has no rendering engine, so processed CSS
  // could not change any assertion here even if it did load.
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.tsx'],
    setupFiles: [new URL('./vitest.component.setup.ts', import.meta.url).pathname],
    passWithNoTests: true,
    typecheck: { enabled: false },
  },
})

export default componentTestConfig
