import {
  createConsoleTelemetry,
  createHttpTelemetry,
  noopTelemetry,
  type TelemetryPort,
  type Transport,
} from '@fitnessos/telemetry'

/**
 * Builds the telemetry sink.
 *
 * The console sink is refused in production, loudly. That mirrors a V1 lesson recorded in the
 * handbook: `console` SMS and email providers logged OTP codes, and the only thing keeping them out
 * of production was a person remembering. A startup assertion is not a person.
 *
 * ## Production is no longer silent
 *
 * ADR-0032 chose the seam and deliberately named no vendor; the blocker was the data-residency
 * question under ADR-0002. That is answered by sending to OUR OWN API: same-origin, so nothing leaves
 * the infrastructure that already holds the data these events are about — and the vocabulary is closed,
 * so the payload could not carry personal data even if someone tried.
 *
 * The trade, stated plainly: no vendor means no grouping, no alerting, no stack symbolisation. What it
 * buys is that a crash in production is recorded at all, and that adopting a vendor later changes this
 * one file.
 */

/**
 * The platform half, which lives here rather than in the package.
 *
 * `@fitnessos/telemetry` has no DOM lib — the compiler refused an earlier version that reached for
 * `fetch` and `navigator` inside it. That boundary is right: batching and dropping are decisions,
 * `sendBeacon` is a platform detail.
 */
const platformTransport: Transport = {
  post: (url, body) => {
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      // The report is about a session, so it must carry one. Same-origin (ADR-0025): no CORS.
      credentials: 'same-origin',
      // `keepalive`, so a flush that starts just before a navigation is not cancelled by it.
      keepalive: true,
    }).catch(() => {
      // Discarded. Telemetry is never retried — see the package's note on amplifying an outage.
    })
  },
  beacon: (url, body) => {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false
    return navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
  },
}

export const createTelemetry = (): TelemetryPort => {
  const isProduction = process.env.NODE_ENV === 'production'

  if (!isProduction) return createConsoleTelemetry()

  // Server-side rendering has no page to unload and no beacon; a sink there would also report events
  // for every request through one queue. Silent on the server, by design.
  if (typeof document === 'undefined') return noopTelemetry

  const sink = createHttpTelemetry({ url: '/api/v1/telemetry', transport: platformTransport })

  /*
   * Flush on the way out.
   *
   * `visibilitychange` to hidden and `pagehide`, NOT `unload`: `unload` is unreliable on mobile Safari
   * and disqualifies the page from the back/forward cache. The offline queue's drain settled on the
   * same pair for the same reasons.
   *
   * Registered once per document, and deliberately never removed — this lives for the life of the
   * page, and a sink that detached itself on some route change would stop reporting the crash that
   * followed.
   */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sink.flush({ viaBeacon: true })
  })
  window.addEventListener('pagehide', () => {
    sink.flush({ viaBeacon: true })
  })

  return sink
}
