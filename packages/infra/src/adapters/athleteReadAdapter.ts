import type { AthleteReadPort, AthleteSnapshot } from '@fitnessos/core'
import type { HttpClient, AuthContext } from '../http/client'
import { athleteFrom } from '../mappers/athlete'

/**
 * The HTTP implementation of `AthleteReadPort`.
 *
 * The port is declared in the application layer; this is the adapter. Note the
 * direction of the dependency — infra imports the application's interface, never
 * the other way round.
 *
 * `auth` is a per-request value, not module state. On the server one process
 * handles many users' requests concurrently, so a module-level auth context
 * would let one athlete's cookie serve another athlete's render. That failure is
 * silent, intermittent, and load-dependent — the worst combination there is —
 * which is why the container is built per request rather than once at startup.
 */
export const createAthleteReadAdapter = (
  http: HttpClient,
  auth: AuthContext,
): AthleteReadPort => ({
  getMine: async (signal?: AbortSignal): Promise<AthleteSnapshot> => {
    // No type argument. The body is `unknown` until `athleteFrom` validates it
    // against the generated contract schema (ADR-0031). An earlier version passed
    // the contract type here, which told TypeScript a comforting lie about a payload
    // nobody had checked.
    const raw = await http.request('/athletes/me', {
      auth,
      // `exactOptionalPropertyTypes` is on, so `{ signal: undefined }` is not the
      // same as an absent key. Spreading conditionally is the honest way to say
      // "no signal" rather than "a signal that is undefined".
      ...(signal ? { signal } : {}),
    })
    return athleteFrom(raw)
  },
})
