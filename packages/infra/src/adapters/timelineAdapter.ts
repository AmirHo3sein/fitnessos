import type { PlanSnapshot, TimelinePorts } from '@fitnessos/ctx-timeline'
import type { AuthContext, HttpClient } from '../http/client'
import { planBodyFrom, planFrom } from '../mappers/timeline'

/** HTTP implementation of the Timeline ports. */
export const createTimelineAdapter = (
  http: HttpClient,
  auth: AuthContext,
): TimelinePorts['timeline'] => ({
  current: async (signal?: AbortSignal): Promise<PlanSnapshot | null> => {
    const raw = await http.request('/plans/current', { auth, ...(signal ? { signal } : {}) })
    // 204 → null: "no plan yet" is the normal state before a coach writes one.
    if (raw === undefined || raw === null) return null
    return planFrom(raw)
  },

  save: async (plan, signal?: AbortSignal): Promise<PlanSnapshot> =>
    planFrom(
      await http.request(`/plans/${plan.id}`, {
        method: 'PUT',
        body: planBodyFrom(plan),
        auth,
        ...(signal ? { signal } : {}),
      }),
    ),
})
