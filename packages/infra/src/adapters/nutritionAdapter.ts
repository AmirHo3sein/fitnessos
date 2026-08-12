import type { Loaded, NutritionPorts, NutritionSnapshot } from '@fitnessos/ctx-nutrition'
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

  // The response IS the new state, revision included, so two saves in a row need no re-read (§2.1a).
  save: async (
    plan: NutritionSnapshot,
    baseRevision: number | null,
    signal?: AbortSignal,
  ): Promise<Loaded<NutritionSnapshot>> =>
    nutritionPlanLoadedFrom(
      await http.request(`/nutrition-plans/${plan.id}`, {
        method: 'PUT',
        body: nutritionPlanBodyFrom(plan, baseRevision),
        auth,
        ...(signal ? { signal } : {}),
      }),
    ),
})
