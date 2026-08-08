import type { AthleteSnapshot, AthleteWritePort } from '@fitnessos/core/athlete'
import type { AuthContext, HttpClient } from '../http/client'
import { athleteFrom, onboardingBodyFrom } from '../mappers/athlete'

/**
 * The HTTP implementation of `AthleteWritePort`.
 *
 * `PUT`, matching the spec: submitting the same body twice must leave the athlete in
 * the same state. Onboarding is a form a user will resubmit after a network hiccup, and
 * an idempotent verb is what makes that safe without a client-generated request id.
 *
 * The response is mapped through `athleteFrom`, the same function the read path uses —
 * so the mutation returns the server's own view of the athlete and the cache can be
 * SET rather than invalidated. One fewer round trip on the slowest connection in the
 * flow, and no window in which the cache and the database disagree.
 */
export const createAthleteWriteAdapter = (
  http: HttpClient,
  auth: AuthContext,
): AthleteWritePort => ({
  completeOnboarding: async (input, signal): Promise<AthleteSnapshot> => {
    const raw = await http.request('/athletes/me/onboarding', {
      method: 'PUT',
      // Validated on the way out, not just on the way in.
      body: onboardingBodyFrom(input),
      auth,
      ...(signal ? { signal } : {}),
    })
    return athleteFrom(raw)
  },
})
