import {
  PlanConflictError,
  type Loaded,
  type PlanSnapshot,
  type TimelinePorts,
} from '@fitnessos/ctx-timeline'
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

  /**
   * The two statuses that carry a plan.
   *
   *   200  saved. The response carries the NEW revision, so a caller can save twice without
   *        re-reading.
   *   409  `baseRevision` is not the revision stored — another author saved while this one was
   *        editing, or this save asserted no base at all against a plan that already exists
   *        (§2.1a). `allowStatus` keeps the body, because the body is the plan as it now stands
   *        and discarding it would leave the author with an error message and no way to see what
   *        they collided with.
   */
  save: async (
    plan: PlanSnapshot,
    baseRevision: number | null,
    signal?: AbortSignal,
  ): Promise<Loaded<PlanSnapshot>> => {
    const { status, body: raw } = await http.requestWithStatus(`/plans/${plan.id}`, {
      method: 'PUT',
      body: planBodyFrom(plan, baseRevision),
      auth,
      allowStatus: [409],
      ...(signal ? { signal } : {}),
    })

    // Mapped before the status is inspected: a 409 body is a Plan too, and a malformed one is a
    // contract violation whichever status carried it.
    const loaded = planLoadedFrom(raw)
    if (status === 409) throw new PlanConflictError(loaded)
    return loaded
  },
})
