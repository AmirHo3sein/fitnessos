import type { PrescriptionReadPort, ProgramSnapshot } from '@fitnessos/core/prescription'
import type { AuthContext, HttpClient } from '../http/client'
import { programFrom } from '../mappers/program'

/**
 * HTTP implementation of `PrescriptionReadPort`.
 *
 * A 204 becomes `null`. The http client returns `undefined` for a no-content response, and
 * `undefined` reaching a React component is how "no programme yet" becomes a blank screen
 * with no explanation — TanStack Query also treats `undefined` as "no data" and warns. Mapping
 * it to an explicit `null` at the boundary makes "the athlete has no programme" a value the UI
 * can render deliberately.
 */
export const createPrescriptionAdapter = (
  http: HttpClient,
  auth: AuthContext,
): PrescriptionReadPort => ({
  currentProgram: async (signal?: AbortSignal): Promise<ProgramSnapshot | null> => {
    const raw = await http.request('/programs/current', {
      auth,
      ...(signal ? { signal } : {}),
    })
    if (raw === undefined || raw === null) return null
    return programFrom(raw)
  },
})
