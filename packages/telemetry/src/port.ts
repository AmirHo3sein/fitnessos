import type { TelemetryEvent } from './events'

/**
 * The telemetry sink.
 *
 * One method, and it returns `void` rather than a promise. That is deliberate: a caller
 * that could `await` this would eventually be tempted to, and a failing observability
 * service would then slow down or fail the thing it is observing. Reporting is
 * fire-and-forget by contract, not by convention.
 *
 * An implementation MUST NOT throw. Callers do not wrap it, because a try/catch around
 * every report is noise that will be forgotten once. `guarded()` below enforces the rule
 * for any implementation rather than trusting each one.
 */
export interface TelemetryPort {
  readonly report: (event: TelemetryEvent) => void
}

/**
 * Does nothing. The DEFAULT, so an unconfigured environment is silent rather than broken.
 *
 * Tests get this for free, which matters more than it sounds: a test suite that had to
 * stub a sink would grow a stub per test file, and one of them would eventually assert on
 * telemetry and couple a domain test to an observability decision.
 */
export const noopTelemetry: TelemetryPort = { report: () => {} }

/**
 * Wrap an implementation so it cannot throw or block.
 *
 * Every sink should be constructed through this. A vendor SDK that throws on a malformed
 * config, or synchronously in an ad-blocked browser, would otherwise take out the error
 * path — which is precisely when it is running.
 */
export const guarded = (inner: TelemetryPort): TelemetryPort => ({
  report: (event) => {
    try {
      inner.report(event)
    } catch {
      // Swallowed on purpose, and not logged: a sink that fails on every event would
      // otherwise fill the console with noise about the thing that was meant to record
      // noise. If telemetry is down, the signal is the absence of events.
    }
  },
})
