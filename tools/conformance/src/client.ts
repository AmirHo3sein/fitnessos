/**
 * A deliberately dumb HTTP client for the conformance suite.
 *
 * It does NOT reuse `@fitnessos/infra`'s client, and that is the point. The infra client validates
 * responses, maps them, retries, refreshes on 401 and throws typed errors — every one of which would
 * hide the thing being measured. A conformance check needs the raw status code and the raw body,
 * including the ones the real client would never let a caller see.
 *
 * Nothing here imports from the workspace. If this suite and the client disagree, the disagreement
 * should be visible rather than shared.
 */

export interface Response<T = unknown> {
  readonly status: number
  readonly headers: Headers
  readonly body: T | null
  /** The raw text, for when the body is not JSON — a 204, or an error page from a proxy. */
  readonly text: string
}

export const baseUrl = (): string =>
  process.env['CONFORMANCE_BASE_URL'] ?? 'http://127.0.0.1:8791/api/v1'

/** The origin, for the endpoints that are not under `/api/v1` (the stub's test-only controls). */
export const origin = (): string => new URL(baseUrl()).origin

let sessionCookie: string | null = process.env['CONFORMANCE_COOKIE'] ?? null

export const setCookie = (value: string): void => {
  sessionCookie = value
}

/**
 * The session cookie, for the one caller that cannot use `request`.
 *
 * The SSE checks need a streaming body, so they call `fetch` directly and must attach the cookie
 * themselves. Exposed deliberately rather than reconstructed at the call site: the first version of
 * those checks guessed, sent nothing, and would have reported four contract violations that were
 * really one missing header.
 */
export const currentCookie = (): Record<string, string> =>
  sessionCookie === null ? {} : { cookie: sessionCookie }

export const request = async <T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response<T>> => {
  const url = path.startsWith('http') ? path : `${baseUrl()}${path}`
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(sessionCookie === null ? {} : { cookie: sessionCookie }),
      ...init.headers,
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    // No redirect following: a 302 to a login page is a finding, not something to resolve quietly.
    redirect: 'manual',
  })

  const text = await response.text()
  let body: T | null = null
  try {
    body = text === '' ? null : (JSON.parse(text) as T)
  } catch {
    // Left null. A non-JSON body is itself sometimes the finding.
  }
  return { status: response.status, headers: response.headers, body, text }
}

/**
 * A session, by whichever route is available.
 *
 * `CONFORMANCE_COOKIE` for a real backend, where an operator pastes a session they already have.
 * `CONFORMANCE_PHONE` drives the OTP flow, which is what the stub accepts and what CI uses.
 *
 * Fails loudly rather than proceeding unauthenticated: every check below would then report 401 and
 * the run would look like 20 contract violations instead of one missing variable.
 */
export const signIn = async (): Promise<void> => {
  if (sessionCookie !== null) return

  const phone = process.env['CONFORMANCE_PHONE']
  if (phone === undefined) {
    throw new Error(
      'No session. Set CONFORMANCE_COOKIE to a Cookie header value, or CONFORMANCE_PHONE to drive the OTP flow.',
    )
  }

  const requested = await request('/auth/request-code', { method: 'POST', body: { phone } })
  if (requested.status >= 400) {
    throw new Error(`request-code failed with ${String(requested.status)}: ${requested.text}`)
  }

  const code = process.env['CONFORMANCE_CODE'] ?? '000000'
  const verified = await request('/auth/verify-code', {
    method: 'POST',
    body: { phone, code },
  })
  if (verified.status >= 400) {
    throw new Error(`verify-code failed with ${String(verified.status)}: ${verified.text}`)
  }

  const setCookieHeader = verified.headers.getSetCookie().join('; ')
  if (setCookieHeader === '') throw new Error('verify-code returned no Set-Cookie')
  sessionCookie = setCookieHeader
    .split(/,\s*(?=[^;=]+=)/)
    .map((c) => c.split(';')[0])
    .join('; ')
}

/** A UUIDv7-shaped id, since the contract requires client-generated ids (ADR-0010, D-10). */
export const newId = (): string => {
  const ms = Date.now().toString(16).padStart(12, '0')
  const rand = (n: number): string =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  return `${ms.slice(0, 8)}-${ms.slice(8, 12)}-7${rand(3)}-8${rand(3)}-${rand(12)}`
}
