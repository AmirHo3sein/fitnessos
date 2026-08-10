import { ApiError, ContractViolationError, NetworkError } from '@fitnessos/infra'
import { toRouteTemplate, type Surface, type TelemetryEvent } from '@fitnessos/telemetry'

/**
 * Classify a thrown error into a telemetry event.
 *
 * **One reporting point, not instrumentation scattered through adapters.** Every query and
 * mutation error passes through the QueryClient's cache callbacks, so this is the single
 * place that needs to know about telemetry — which keeps `infra` free of it, keeps the
 * mappers pure functions, and means adding a new adapter cannot forget to report.
 *
 * The classification is exhaustive by construction: anything unrecognised becomes
 * `unknown-error` carrying only a constructor name. That is the least actionable event in
 * the vocabulary, and deliberately so — an unrecognised error is exactly the case where
 * nobody has yet reasoned about what its message contains, so its message is not sent.
 */
export const classifyError = (
  error: unknown,
  surface: Surface,
  route: string | null,
): TelemetryEvent => {
  const template = route === null ? null : toRouteTemplate(route)

  if (error instanceof ContractViolationError) {
    return {
      kind: 'contract-violation',
      surface,
      resource: error.resource,
      // Paths and codes only. `message` stays on the device — see ContractIssue.
      paths: error.issues.map((issue) => issue.path),
      codes: error.issues.map((issue) => issue.code),
    }
  }

  if (error instanceof ApiError) {
    return {
      kind: 'api-error',
      surface,
      status: error.status,
      code: error.code,
      route: template ?? 'unknown',
    }
  }

  if (error instanceof NetworkError) {
    return { kind: 'network-error', surface, route: template ?? 'unknown' }
  }

  return {
    kind: 'unknown-error',
    surface,
    // Constructor name only. Not the message, not the stack: a stack from a production
    // bundle is near-useless without source maps, and messages are a common way a
    // user-supplied string escapes — `new Error(\`no athlete for ${phone}\`)`.
    name: error instanceof Error ? error.name : typeof error,
    route: template,
  }
}
