/**
 * Lighthouse against the LOCAL PRODUCTION topology, not against the stub.
 *
 *   Browser → Caddy :18080 → Next.js :3000 (production build) → Rust API :8791 → PostgreSQL
 *
 * ## Why a second config rather than a flag
 *
 * `lighthouserc.cjs` is CI's, and CI points at `127.0.0.1:3000` with the stub behind it. That
 * measurement is worth keeping exactly as it is — it is the one that runs on every schedule and
 * whose thresholds were calibrated on a GitHub runner. This one asks a different question: what do
 * the same pages cost when a real reverse proxy and a real database are in the path?
 *
 * The stub answers from memory on loopback. It cannot show connection setup, query time, the proxy
 * hop, or derive-on-read computing an indicator series per request. Every performance number this
 * project has is from that stub, which is the same defect the readiness document found everywhere
 * else: measured against a server that is not the one shipping.
 *
 * ## Thresholds are ABSENT here, deliberately
 *
 * No assertions. A gate needs a calibrated baseline and this has none — inventing one from a single
 * laptop run is exactly the mistake `lighthouserc.cjs` documents itself having made and corrected.
 * So this collects and reports, and the numbers go in `docs/v2/` where a threshold can be argued
 * from evidence later.
 */
module.exports = {
  ci: {
    collect: {
      url: [
        'http://127.0.0.1:18080/',
        'http://127.0.0.1:18080/en',
        'http://127.0.0.1:18080/sign-in',
      ],
      numberOfRuns: 3,
      settings: {
        preset: 'perf',
        formFactor: 'mobile',
        screenEmulation: { mobile: true, width: 412, height: 915, deviceScaleFactor: 2.6 },
        throttlingMethod: 'simulate',
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        skipAudits: ['redirects-http', 'uses-http2', 'is-on-https'],
      },
    },
    /*
     * `lhci collect` always writes its reports to `.lighthouseci/`; `outputDir` here governs
     * `lhci upload` only. Stated because the first version of this file set it and expected
     * collect to honour it, which cost a confused minute looking for reports that were never
     * going to be there.
     */
    upload: { target: 'filesystem', outputDir: '.lighthouseci' },
  },
}
