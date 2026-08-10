/**
 * Lighthouse CI — handbook stage 15, "(public) routes only".
 *
 * ## Scope
 *
 * The routes a person reaches before they have a session: the marketing page in both
 * directions, and sign-in. The handbook says `(public)`; sign-in is included because it is
 * unauthenticated, it is the first INTERACTIVE screen, and it is reached on the slowest
 * connection anyone in this product will use. Authenticated routes are absent because
 * Lighthouse cannot sign in, and a lab run against a signed-out redirect measures the redirect.
 *
 * ## Extending it to authenticated routes was tried, and abandoned — with reasons
 *
 * Every screen with real weight is behind the login, so a lab metric for the dashboard would be
 * worth having. Two attempts, both recorded here so the next person does not spend the afternoon
 * again:
 *
 * **`settings.extraHeaders: { Cookie: … }` silently measures the redirect.** A header authenticates
 * the document request; it puts nothing in the browser's COOKIE JAR. So the shell rendered, then the
 * client's own `/api/v1/*` calls went out unauthenticated, 401'd, `onSessionLost` fired, and all
 * three runs finished on `/sign-in`. `finalDisplayedUrl` said so and the reports were full of
 * "Failed to fetch RSC payload" for every prefetched nav link. It failed loudly only because
 * `errors-in-console` was asserted at zero — with a looser assertion it would have reported a
 * healthy score for a page nobody was looking at, which is the worst possible outcome for a
 * measurement.
 *
 * **`collect.puppeteerScript` is the supported answer and costs too much here.** lhci resolves
 * `puppeteer` to hand over a browser, and adding it means a second Chromium download beside the one
 * Playwright already manages. That is a large, permanent cost for a lab number, so the answer is no
 * until something else needs puppeteer anyway.
 *
 * What covers that ground instead, imperfectly and knowingly: `tools/bundle-budget.mjs` for bytes
 * per route including deferred chunks, the axe suite for accessibility on every builder, and the
 * e2e assertions that canvases have real height. None of them is LCP, CLS or TBT on a throttled
 * mobile CPU, and that remains a gap rather than something quietly covered.
 *
 * ## What this adds that the rest of the suite does not
 *
 * Bundle budgets measure bytes. The e2e suite measures behaviour. Neither can see:
 *
 *   CLS               layout shifting after paint. A screenshot taken when the page is settled
 *                     is identical whether or not it lurched to get there.
 *   LCP               when the main content actually appears, as opposed to when the DOM says it
 *                     exists.
 *   render blocking   a stylesheet or script in the critical path.
 *   console errors    Lighthouse's best-practices audit fails on them; nothing else here does.
 *
 * ## Why the thresholds are shaped this way
 *
 * A Lighthouse performance SCORE varies by several points between two runs of identical code on
 * the same machine — it is a weighted blend including CPU-bound metrics. Gating a build on it
 * produces a check that fails for reasons no one caused, which is a check that gets disabled.
 *
 * So the score assertions are deliberately loose and the METRIC assertions are tight. CLS in
 * particular is near-deterministic for a static layout: if it moves, something actually shifted.
 * `numberOfRuns: 3` and Lighthouse's median further damp the noise.
 *
 * Accessibility asserts a perfect score, and that is not redundant with the axe suite: axe runs
 * against a hydrated DOM under Playwright, Lighthouse runs its own audit set against a cold load.
 * The overlap is large and the difference is where regressions hide.
 */
module.exports = {
  ci: {
    collect: {
      url: [
        'http://127.0.0.1:3000/',
        'http://127.0.0.1:3000/en',
        'http://127.0.0.1:3000/sign-in',
      ],
      numberOfRuns: 3,
      settings: {
        // Mobile is the primary experience, so it is what gets measured. Desktop would report
        // numbers nobody in this product experiences.
        preset: 'perf',
        formFactor: 'mobile',
        screenEmulation: { mobile: true, width: 412, height: 915, deviceScaleFactor: 2.6 },
        throttlingMethod: 'simulate',
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        // The app is served over plain HTTP locally; the redirect audit would fail on that alone
        // and says nothing about the code.
        skipAudits: ['redirects-http', 'uses-http2', 'is-on-https'],
      },
    },
    assert: {
      assertions: {
        // --- category scores: loose, because they are blends and they wobble ---
        'categories:performance': ['warn', { minScore: 0.8 }],
        'categories:accessibility': ['error', { minScore: 1 }],
        'categories:best-practices': ['error', { minScore: 0.9 }],
        'categories:seo': ['warn', { minScore: 0.9 }],

        // A missing favicon is a 404 on EVERY page load. Harmless in itself and permanent noise
        // in any error reporting, which is the sort of thing that trains people to ignore the
        // console.
        'errors-in-console': ['error', { maxLength: 0 }],

        // --- metrics: tight, because a change here is a real change ---
        // Near-deterministic for a static layout. If it moves, something shifted after paint —
        // which is the one thing a screenshot suite structurally cannot notice.
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.02 }],
        // Measured 2.8 s under simulated mobile throttling. The gate sits at 3.5 s — above the
        // measurement so ordinary run-to-run variance does not fail a build, and below the 4 s
        // that Lighthouse calls poor, so a genuine regression still trips it.
        'largest-contentful-paint': ['error', { maxNumericValue: 3500 }],
        'total-blocking-time': ['warn', { maxNumericValue: 400 }],
        /*
         * Asserted on SAVINGS, not on count — the first version used `maxLength: 0` and was
         * wrong. The one blocking resource is the stylesheet, 8 kB, with an estimated saving of
         * ZERO milliseconds. A stylesheet is supposed to block: not blocking means a flash of
         * unstyled content, which in an RTL Persian layout is a flash of unstyled LTR text —
         * exactly what setting `dir` on the server exists to prevent.
         *
         * What this catches is a blocking SCRIPT, or a stylesheet that grows enough to cost real
         * time. Both move the savings number; neither is visible in a count.
         */
        'render-blocking-resources': ['error', { maxNumericValue: 100 }],

        // Informational rather than blocking. Next inlines and splits on its own terms, and
        // failing a build over its chunking strategy would mean fighting the framework rather
        // than fixing anything.
        'unused-javascript': 'off',
        'unused-css-rules': 'off',
        'legacy-javascript': 'off',
        'uses-long-cache-ttl': 'off',
      },
    },
    /*
     * Reports stay on disk. `temporary-public-storage` is the documented default and it uploads
     * a full render of the page to a public bucket — for a product behind a login, with an
     * athlete's data on adjacent screens, that is not a default to accept for the convenience of
     * a shareable link. CI keeps them as an artefact instead.
     */
    upload: { target: 'filesystem', outputDir: '.lighthouseci' },
  },
}
