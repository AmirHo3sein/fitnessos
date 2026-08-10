/**
 * The telemetry event vocabulary.
 *
 * A **closed union**, not free-form strings with arbitrary payloads. Two reasons, and the
 * second is the one that makes this a type problem rather than a convention:
 *
 * 1. Free-form event names drift. `contract_violation`, `contractViolation` and
 *    `contract-violation` all get emitted, and no dashboard can group them.
 *
 * 2. **A free-form payload leaks personal data.** This is the constraint that shapes the
 *    whole file. The obvious instinct when reporting an error is to attach the thing that
 *    caused it — and in this product that thing is a phone number, an athlete's goal in
 *    their own words, or a training history. All of it is identifying, some of it is
 *    health-adjacent, and none of it belongs in a third-party observability service.
 *
 * So every event below is a *shape*, with fields chosen so that the useful ones are
 * present and the dangerous ones cannot be expressed. There is no `payload: unknown`, no
 * `metadata: Record<string, unknown>`, and no `message: string` carrying an arbitrary
 * server or validator string.
 *
 * Adding an event means adding a variant here, which is a reviewable edit in a file whose
 * whole subject is what may leave the device.
 */

/** Which layer noticed. Enough to route an alert; not enough to identify anyone. */
export type Surface = 'query' | 'mutation' | 'render' | 'boundary'

/**
 * The API and the published contract disagree. A defect on one side or the other, and
 * never something to show an athlete.
 *
 * Carries `path` and Zod's issue `code` — deliberately NOT the validator's message.
 * Messages are mostly value-free, but `invalid_enum_value` renders the received value
 * verbatim ("Invalid enum value. Expected 'a' | 'b', received 'evil'"), so a field that
 * happens to hold user input would ship that input off the device. Codes are a closed
 * vocabulary and cannot.
 */
export interface ContractViolationEvent {
  readonly kind: 'contract-violation'
  readonly surface: Surface
  /** The schema name, e.g. `Athlete` or `DeclareGoalBody (request)`. */
  readonly resource: string
  /** Dotted field paths only. Never values. */
  readonly paths: readonly string[]
  /** Zod issue codes, positionally aligned with `paths`. */
  readonly codes: readonly string[]
}

/**
 * The API refused a request and said why.
 *
 * `code` is the Problem envelope's stable machine-readable code. The human `detail` is
 * absent on purpose: it is written for an operator, may be localised, and on the sign-in
 * path can reveal whether an account exists.
 */
export interface ApiErrorEvent {
  readonly kind: 'api-error'
  readonly surface: Surface
  readonly status: number
  readonly code: string | null
  /** Route TEMPLATE, never the concrete path — `/athletes/:id`, not `/athletes/018f…`. */
  readonly route: string
}

/** The request never reached the API. No URL, because a URL can carry an id. */
export interface NetworkErrorEvent {
  readonly kind: 'network-error'
  readonly surface: Surface
  readonly route: string
}

/**
 * Something threw that none of the above describes.
 *
 * `name` only — the constructor name. Not the message, not the stack. A stack trace from a
 * production bundle is nearly useless without source maps and is one of the more common
 * ways a user-supplied string escapes: `new Error(\`no athlete for \${phone}\`)`.
 *
 * The cost is real: this is the least actionable event here. That is the trade — an
 * unrecognised error is exactly the case where nobody has yet reasoned about what its
 * message contains.
 */
export interface UnknownErrorEvent {
  readonly kind: 'unknown-error'
  readonly surface: Surface
  readonly name: string
  readonly route: string | null
}

/**
 * A session ended because a refresh failed. Worth watching as a rate: a spike means either
 * the refresh endpoint is unhealthy or token rotation is racing somewhere.
 */
export interface SessionLostEvent {
  readonly kind: 'session-lost'
  readonly rotationsAttempted: number
}

export type TelemetryEvent =
  | ContractViolationEvent
  | ApiErrorEvent
  | NetworkErrorEvent
  | UnknownErrorEvent
  | SessionLostEvent

/**
 * Reduce a concrete path to its route template.
 *
 * `/athletes/018f2c8a-…/onboarding` becomes `/athletes/:id/onboarding`. Without this every
 * id becomes a distinct route in the dashboard — which both destroys aggregation and ships
 * an identifier for every request that failed.
 *
 * Replaces UUIDs, ULID/UUIDv7-shaped ids, long digit runs, and anything that looks like a
 * phone number. Over-matching is the safe direction: a route template that is slightly too
 * coarse costs some resolution, while one that leaks an id costs a privacy incident.
 */
export const toRouteTemplate = (path: string): string =>
  // `?? path` rather than a non-null assertion. `split` always yields at least one element,
  // so the assertion would be correct — but a suppressed check is a suppressed check, and
  // this one costs three characters to do honestly.
  (path.split('?')[0] ?? path)
    .split('/')
    .map((segment) => {
      if (segment === '') return segment
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
        return ':id'
      }
      if (/^[0-9A-Za-z]{20,}$/.test(segment)) return ':id'
      if (/^\+?[0-9]{6,}$/.test(segment)) return ':id'
      return segment
    })
    .join('/')
