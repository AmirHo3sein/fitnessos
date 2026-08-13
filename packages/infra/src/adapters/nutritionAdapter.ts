import {
  NutritionConflictError,
  type Loaded,
  type NutritionPorts,
  type NutritionSnapshot,
} from '@fitnessos/ctx-nutrition'
import type { AuthContext, HttpClient } from '../http/client'
import { nutritionPlanBodyFrom, nutritionPlanLoadedFrom } from '../mappers/nutrition'

/** HTTP implementation of the Nutrition ports. */
export const createNutritionAdapter = (
  http: HttpClient,
  auth: AuthContext,
): NutritionPorts['nutrition'] => ({
  current: async (signal?: AbortSignal): Promise<Loaded<NutritionSnapshot> | null> => {
    const raw = await http.request('/nutrition-plans/current', {
      auth,
      ...(signal ? { signal } : {}),
    })
    // 204 → null: no plan yet is the normal state before a coach writes one.
    if (raw === undefined || raw === null) return null
    return nutritionPlanLoadedFrom(raw)
  },

  /*
    The response IS the new state, revision included, so two saves in a row need no re-read (§2.1a).

    A 409 says the stored revision is no longer the one `baseRevision` named — someone else saved
    while this plan was open. `allowStatus` keeps that body: it is the plan as the server now holds
    it, and `request` would have turned the status into an `ApiError` that records the code and
    throws the plan away, which is how a collision used to reach the coach as a bare "save failed".
  */
  save: async (
    plan: NutritionSnapshot,
    baseRevision: number | null,
    signal?: AbortSignal,
  ): Promise<Loaded<NutritionSnapshot>> => {
    const { status, body: raw } = await http.requestWithStatus(`/nutrition-plans/${plan.id}`, {
      method: 'PUT',
      body: nutritionPlanBodyFrom(plan, baseRevision),
      auth,
      allowStatus: [409],
      ...(signal ? { signal } : {}),
    })

    // Mapped before the status is inspected: a 409 body is a NutritionPlan too, and a malformed one
    // is a contract violation whichever status carried it.
    const loaded = nutritionPlanLoadedFrom(raw)
    if (status === 409) throw new NutritionConflictError(loaded)
    return loaded
  },
})
