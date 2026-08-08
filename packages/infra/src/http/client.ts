import { ApiError, NetworkError, problemFrom } from './errors'
import { createRefresher, type Refresher } from './refresh'

/**
 * HTTP client.
 *
 * Two modes, because the same code runs in two places (handbook §3.3):
 *
 *   browser  cookies are attached automatically by the platform
 *   server   an RSC prefetch must forward the incoming cookie explicitly, since
 *            fetch on the server carries no ambient session
 *
 * The auth context is a PER-REQUEST parameter, never module-level state. A shared
 * mutable would bleed one user's session into another's render under concurrency.
 */

export interface AuthContext {
  /** Cookie header to forward. Server-side only; omit in the browser. */
  readonly cookie?: string
}

/**
 * Which of the two modes above this client is running in.
 *
 * Not a convenience flag. It decides whether a 401 may be refreshed, and getting
 * that wrong signs the user out — see the note in `request`.
 */
export type HttpMode = 'browser' | 'server'

export interface HttpConfig {
  /**
   * Relative by default — ADR-0025 puts the API on the same origin behind a
   * reverse proxy, which removes CORS and cookie-domain problems entirely.
   *
   * A server-mode client must pass an absolute URL: inside a Node process there
   * is no origin for a relative path to resolve against.
   */
  readonly baseUrl?: string
  readonly mode?: HttpMode
  readonly fetch?: typeof globalThis.fetch
  readonly onSessionLost?: () => void
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  readonly body?: unknown
  readonly auth?: AuthContext
  readonly signal?: AbortSignal
  /** Internal: suppresses the refresh-and-retry path. */
  readonly _isRetry?: boolean
}

export interface HttpClient {
  /**
   * Defaults to `unknown`, deliberately.
   *
   * A response body is not typed until something validates it (ADR-0031). Defaulting
   * to `unknown` means the lazy call — `http.request('/x')` — is also the safe one:
   * the result has to go through a mapper before it can be used. Supplying a type
   * argument is still possible, and is the right thing for a 204 or a body the
   * contract does not describe, but it is now an explicit assertion rather than the
   * path of least resistance.
   */
  request: <T = unknown>(path: string, options?: RequestOptions) => Promise<T>
  readonly refresher: Refresher
}

const REFRESH_PATH = '/auth/refresh'

export const createHttpClient = (config: HttpConfig = {}): HttpClient => {
  const baseUrl = config.baseUrl ?? '/api/v1'
  const mode: HttpMode = config.mode ?? 'browser'
  const doFetch = config.fetch ?? globalThis.fetch

  const send = async (path: string, options: RequestOptions): Promise<Response> => {
    const headers: Record<string, string> = {}
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    if (options.auth?.cookie) headers['cookie'] = options.auth.cookie

    try {
      return await doFetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET',
        credentials: 'include',
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        ...(options.signal ? { signal: options.signal } : {}),
      })
    } catch (cause) {
      throw new NetworkError(cause)
    }
  }

  const refresher = createRefresher({
    rotate: async () => {
      const response = await send(REFRESH_PATH, { method: 'POST' })
      if (!response.ok) throw await problemFrom(response)
    },
    ...(config.onSessionLost ? { onSessionLost: config.onSessionLost } : {}),
  })

  const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
    const response = await send(path, options)

    const mayRefresh =
      response.status === 401 &&
      !options._isRetry &&
      path !== REFRESH_PATH &&
      // A server-mode client must NOT refresh, and this is the subtle one.
      //
      // Refresh tokens rotate strictly: a successful rotation invalidates the
      // one presented. On the server we can perform the rotation, but we cannot
      // deliver the resulting Set-Cookie to the browser — an RSC render has no
      // access to the outgoing response headers. So the new token is discarded
      // while the old one is already revoked, and the user's *next* request
      // authenticates with a dead token. A silent logout on navigation, caused
      // by the refresh that was meant to prevent one.
      //
      // The correct server behaviour is to let the 401 propagate: middleware sees
      // the missing/expired cookie on the next navigation, or the client-side
      // client refreshes where it can actually persist the result.
      mode === 'browser'

    if (mayRefresh) {
      // Join any refresh already in flight rather than starting another.
      // If the refresh itself fails, surface THAT error — retrying against a
      // dead session would loop.
      await refresher.refresh()
      return request<T>(path, { ...options, _isRetry: true })
    }

    if (!response.ok) throw await problemFrom(response)
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  return { request, refresher }
}

export { ApiError, NetworkError }
