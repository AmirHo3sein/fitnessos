import type { TelemetryEvent } from './events'
import { guarded, type TelemetryPort } from './port'

/**
 * Development sink. Prints events and nothing else.
 *
 * Exists so the event stream is visible while building, without wiring a vendor. It must
 * never be the production sink — see the assertion in `apps/web/composition/telemetry.ts`,
 * which refuses to construct it when NODE_ENV is production. That mirrors the V1 lesson
 * recorded in the handbook: console SMS and email providers logged OTP codes, and the only
 * thing that stopped them reaching production was a person remembering.
 */
export const createConsoleTelemetry = (): TelemetryPort =>
  guarded({
    report: (event: TelemetryEvent) => {
      // `console.warn`, not `error`: these are reports about errors, not errors in
      // themselves, and using `error` makes a CI log look like the run failed.
      console.warn('[telemetry]', event.kind, JSON.stringify(event))
    },
  })
