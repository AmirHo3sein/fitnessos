/**
 * @fitnessos/telemetry — the observability seam.
 *
 * A separate package with ZERO runtime dependencies, because it is imported by layers that
 * are forbidden from having any: application code, and eventually the editor engine. It
 * knows nothing about React, HTTP, or any vendor.
 *
 * The event vocabulary is closed and the payloads are shaped so that personal data cannot
 * be attached — see the note in `events.ts`. In this product the thing that caused an error
 * is usually a phone number, an athlete's goal in their own words, or a training history.
 */

export {
  toRouteTemplate,
  type ApiErrorEvent,
  type ContractViolationEvent,
  type NetworkErrorEvent,
  type SessionLostEvent,
  type Surface,
  type TelemetryEvent,
  type UnknownErrorEvent,
} from './events'

export { guarded, noopTelemetry, type TelemetryPort } from './port'
export { createConsoleTelemetry } from './console'
export {
  createHttpTelemetry,
  type HttpTelemetry,
  type HttpTelemetryOptions,
  type Transport,
} from './http'
