import { createConsoleTelemetry, noopTelemetry, type TelemetryPort } from '@fitnessos/telemetry'

/**
 * Builds the telemetry sink.
 *
 * The console sink is refused in production, loudly. That mirrors a V1 lesson recorded in
 * the handbook: `console` SMS and email providers logged OTP codes, and the only thing
 * keeping them out of production was a person remembering. A startup assertion is not a
 * person.
 *
 * The default is `noopTelemetry`, not the console sink — an unconfigured environment should
 * be silent, not chatty. Silence is also the honest signal: if no events arrive, telemetry
 * is not configured, which is a different problem from no errors occurring.
 */
export const createTelemetry = (): TelemetryPort => {
  const isProduction = process.env.NODE_ENV === 'production'

  if (!isProduction) return createConsoleTelemetry()

  // A real sink lands here once the vendor decision is made (ADR-0032 records what the
  // seam guarantees, deliberately without naming one). Until then production is silent,
  // which is worse than reporting and better than a console sink shipping event payloads
  // into server logs nobody reads.
  return noopTelemetry
}
