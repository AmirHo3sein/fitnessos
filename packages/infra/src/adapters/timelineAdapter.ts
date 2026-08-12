import type { Loaded, PlanSnapshot, TimelinePorts } from '@fitnessos/ctx-timeline'
import type { AuthContext, HttpClient } from '../http/client'
import { planBodyFrom, planLoadedFrom } from '../mappers/timeline'

/** HTTP implementation of the Timeline ports. */
export const createTimelineAdapter = (
  http: HttpClient,
  auth: AuthContext,
): TimelinePorts['timeline'] => ({
  current: async (signal?: AbortSignal): Promise<Loaded<PlanSnapshot> | null> => {
    const raw = await http.request('/plans/current', { auth, ...(signal ? { signal } : {}) })
    // 204 → null: "no plan yet" is the normal state before a coach writes one.
    if (raw === undefined || raw === null) return null
    // The revision comes back beside the plan, never inside it: what the caller echoes on the next
    // save is a precondition on that write, not something the editor may edit or undo (ADR-0035).
    return planLoadedFrom(raw)
  },

  save: async (
    plan: PlanSnapshot,
    baseRevision: number | null,
    signal?: AbortSignal,
  ): Promise<Loaded<PlanSnapshot>> =>
    // The response carries the NEW revision, so a caller can save twice without re-reading.
    planLoadedFrom(
      await http.request(`/plans/${plan.id}`, {
        method: 'PUT',
        body: planBodyFrom(plan, baseRevision),
        auth,
        ...(signal ? { signal } : {}),
      }),
    ),
})
