import type { AthletePorts } from '@fitnessos/core/athlete'
import { createAthleteReadAdapter } from '@fitnessos/infra'
import type { AuthContext, HttpClient } from './container'

/**
 * Athlete ports. Imported by the `(app)` route group and by the server prefetch, and
 * by nothing else — see the note in `container.ts` on why there is no single factory
 * that builds every context's ports.
 *
 * `auth` is a per-request value, not module state. On the server one process serves
 * many users concurrently, so a module-level auth context would let one athlete's
 * cookie serve another athlete's render.
 */
export const createAthletePorts = (http: HttpClient, auth: AuthContext): AthletePorts => ({
  athlete: createAthleteReadAdapter(http, auth),
})
