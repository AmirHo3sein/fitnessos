import type { AuthPorts } from '@fitnessos/core/auth'
import { createAuthAdapter } from '@fitnessos/infra'
import type { HttpClient } from './container'

/**
 * Auth ports. Imported by the `(auth)` route group only.
 *
 * No `AuthContext` parameter: these are the two endpoints that run *without* a
 * session. Accepting one would invite a caller to think it mattered.
 */
export const createAuthPorts = (http: HttpClient): AuthPorts => ({
  auth: createAuthAdapter(http),
})
