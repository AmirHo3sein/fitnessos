/**
 * HTTP error model.
 *
 * Handbook §2.2: `Result` lives inside domain and editor-engine. At the
 * infrastructure boundary we THROW, so TanStack Query's `error` state and React
 * error boundaries work with the grain rather than against it. This is that
 * boundary — the one sanctioned place where a failure becomes an exception.
 */

export class ApiError extends Error {
  override readonly name = 'ApiError'

  constructor(
    readonly status: number,
    /** Stable machine-readable code from the Problem schema, when present. */
    readonly code: string | null,
    message: string,
  ) {
    super(message)
  }

  /** A session problem the caller may be able to resolve by refreshing. */
  get isUnauthorized(): boolean {
    return this.status === 401
  }
}

export class NetworkError extends Error {
  override readonly name = 'NetworkError'

  constructor(override readonly cause: unknown) {
    super('network request failed')
  }
}

export interface ContractIssue {
  /** Dotted path to the offending field, e.g. `availability.daysPerWeek`. */
  readonly path: string
  readonly message: string
}

/**
 * The response was well-formed HTTP but did not match the published contract
 * (ADR-0031).
 *
 * A distinct type from `ApiError` on purpose. `ApiError` means the request failed
 * and the API said why — a condition the UI should render. This means the API and
 * the spec disagree, which is a defect on one side or the other and never something
 * to show an athlete. Keeping them apart lets an error boundary render one and
 * report the other, and lets telemetry alert on this without drowning in 404s.
 *
 * `issues` is a plain array rather than a `ZodError`, so this module needs no
 * validator dependency and the payload is directly serialisable for telemetry. The
 * paths are the whole diagnostic value: "expected string, received number at
 * availability.daysPerWeek" locates a backend change in one line.
 */
export class ContractViolationError extends Error {
  override readonly name = 'ContractViolationError'

  constructor(
    readonly resource: string,
    readonly issues: readonly ContractIssue[],
  ) {
    super(
      `${resource} response did not match the contract: ` +
        issues.map((i) => `${i.path || '(root)'}: ${i.message}`).join('; '),
    )
  }
}

interface Problem {
  code?: unknown
  detail?: unknown
}

/**
 * Extract a Problem body without trusting it.
 *
 * FastAPI-style APIs return an ARRAY for validation errors, so a naive
 * `body.detail` yields "[object Object]" in the UI. V1 had exactly that latent
 * bug; this narrows explicitly instead.
 */
export const problemFrom = async (response: Response): Promise<ApiError> => {
  let code: string | null = null
  let detail = response.statusText || `HTTP ${String(response.status)}`

  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null) {
      const problem = body as Problem
      if (typeof problem.code === 'string') code = problem.code
      if (typeof problem.detail === 'string') detail = problem.detail
      else if (Array.isArray(problem.detail)) detail = 'request validation failed'
    }
  } catch {
    // Non-JSON body. The status line is all we have.
  }

  return new ApiError(response.status, code, detail)
}
