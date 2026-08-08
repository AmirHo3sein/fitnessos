import type { AthletePorts } from '@fitnessos/core'
import {
  createAthleteReadAdapter,
  createHttpClient,
  type AuthContext,
  type HttpMode,
} from '@fitnessos/infra'

/**
 * The composition root (handbook §2.2, B1).
 *
 * This is the ONLY place in the codebase where infrastructure is constructed.
 * Everything else receives ports. `no-presentation-to-infra` enforces the second
 * half of that; this file is the first half.
 *
 * The container is built PER REQUEST, not once at module load. On the server a
 * single Node process handles many users concurrently, and a module-level
 * container would capture one request's cookie and serve it to every render that
 * followed. That failure is silent, intermittent and load-dependent — it will not
 * appear in development, where requests arrive one at a time.
 */

export interface Container {
  readonly athlete: AthletePorts
}

export interface ContainerOptions {
  readonly mode: HttpMode
  /**
   * Server mode needs an absolute internal base URL — there is no origin for a
   * relative path to resolve against inside a Node process. Browser mode leaves
   * this undefined and gets `/api/v1`, same-origin per ADR-0025.
   */
  readonly baseUrl?: string
  readonly auth?: AuthContext
  readonly onSessionLost?: () => void
}

export const createContainer = (options: ContainerOptions): Container => {
  const http = createHttpClient({
    mode: options.mode,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.onSessionLost === undefined ? {} : { onSessionLost: options.onSessionLost }),
  })

  const auth: AuthContext = options.auth ?? {}

  return {
    athlete: { athlete: createAthleteReadAdapter(http, auth) },
  }
}
