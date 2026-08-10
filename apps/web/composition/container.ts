import { createHttpClient, type AuthContext, type HttpClient, type HttpMode } from '@fitnessos/infra'

/**
 * The composition root (handbook §2.2, B1).
 *
 * This directory is the ONLY place in the codebase where infrastructure is
 * constructed. Everything else receives ports. `no-presentation-to-infra` enforces
 * the second half of that; this is the first half.
 *
 * **There is deliberately no `createContainer` that builds every port.**
 *
 * There was, and the bundle budget caught what it cost. A single factory returning
 * all ports means importing it pulls in every adapter, every mapper and every
 * generated schema — so the sign-in page, which needs two endpoints and no session,
 * shipped the athlete mapper and its validator: 62 kB gz against a 30 kB budget.
 * Tree-shaking cannot help, because the factory genuinely constructs them all.
 *
 * So each context gets its own factory, in its own file, and a route group's provider
 * module imports only the one it needs. The cost of adding a context is paid by the
 * routes that mount it and by nobody else.
 *
 * The HTTP client is built PER REQUEST, never at module load. On the server one Node
 * process handles many users concurrently, and a module-level client would capture
 * one request's cookie and serve it to every render that followed — silent,
 * intermittent, load-dependent, and absent in development where requests arrive one
 * at a time.
 */

export interface HttpOptions {
  readonly mode: HttpMode
  /**
   * Server mode needs an absolute internal base URL — inside a Node process there is
   * no origin for a relative path to resolve against. Browser mode leaves this
   * undefined and gets `/api/v1`, same-origin per ADR-0025.
   */
  readonly baseUrl?: string
  readonly onSessionLost?: () => void
}

export const createHttp = (options: HttpOptions): HttpClient =>
  createHttpClient({
    mode: options.mode,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.onSessionLost === undefined ? {} : { onSessionLost: options.onSessionLost }),
  })

export type { AuthContext, HttpClient, HttpMode }
