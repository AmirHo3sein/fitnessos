'use client'

import { Button, Card, CardDescription, CardTitle } from '@fitnessos/ui'
import { toRouteTemplate, type TelemetryPort } from '@fitnessos/telemetry'
import { useEffect } from 'react'

/**
 * What a user sees when something throws during render.
 *
 * Until this existed there were no error boundaries anywhere, so any render throw produced
 * Next's built-in fallback: unstyled, English-only, and offering nothing but a reload. For a
 * product whose primary language is Persian that is not a degraded experience, it is a different
 * product appearing without warning.
 *
 * ## The message is never shown, and that is the important part
 *
 * `error.message` may contain user data. This is not hypothetical in this codebase — the
 * telemetry vocabulary already refuses validator messages for exactly this reason: Zod's
 * `invalid_enum_value` renders the received value verbatim, so a field holding a phone number
 * or an athlete's own words would put it on screen and, worse, into a screenshot in a support
 * ticket.
 *
 * `digest` is different and IS shown. Next computes it server-side as a hash of the error; it
 * identifies the failure without describing it, which is exactly what someone contacting
 * support needs and exactly what an attacker cannot use.
 */

export interface ErrorPanelLabels {
  readonly title: string
  readonly body: string
  readonly retry: string
  readonly home: string
  /** Prefixes the digest. "Reference: a1b2c3" — a support handle, not an explanation. */
  readonly reference: string
}

export interface ErrorPanelProps {
  readonly error: Error & { digest?: string }
  /** Re-renders the failed segment. Next supplies it; a transient failure recovers in place. */
  readonly reset: () => void
  readonly labels: ErrorPanelLabels
  readonly telemetry: TelemetryPort
  /** Where the failure happened, for the report. Defaults to the live location. */
  readonly route?: string
}

export const ErrorPanel = ({
  error,
  reset,
  labels,
  telemetry,
  route,
}: ErrorPanelProps) => {
  useEffect(() => {
    /*
     * The `name` only — never the message, never the stack. A stack from a production bundle is
     * nearly useless without source maps, and is one of the more common ways a user-supplied
     * string escapes the device.
     *
     * The route is reduced to its template, so `/programme/018f…` reports as `/programme/:id`.
     * An id in a route both destroys aggregation and ships an identifier for every crash.
     */
    telemetry.report({
      kind: 'unknown-error',
      surface: 'boundary',
      name: error.name,
      route: toRouteTemplate(route ?? (typeof location === 'undefined' ? '' : location.pathname)),
    })
    // Keyed on the error, not on `telemetry` or `labels`: re-reporting because a label object
    // was rebuilt would inflate the count of a crash that happened once.
  }, [error, telemetry, route])

  return (
    <Card>
      <CardTitle>{labels.title}</CardTitle>
      <CardDescription>{labels.body}</CardDescription>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" onPress={reset}>
          {labels.retry}
        </Button>
        {/*
          `location.assign`, not the router's `Link`. This renders because something already
          broke, and the escape route must not depend on the part of the app that might be what
          broke — a client-side navigation would re-enter the router that may be the problem.
        */}
        <Button
          type="button"
          variant="secondary"
          onPress={() => {
            globalThis.location.assign('/')
          }}
        >
          {labels.home}
        </Button>
      </div>

      {error.digest !== undefined && (
        <p className="text-muted mt-4 text-xs">
          {labels.reference} <span className="nums">{error.digest}</span>
        </p>
      )}
    </Card>
  )
}
