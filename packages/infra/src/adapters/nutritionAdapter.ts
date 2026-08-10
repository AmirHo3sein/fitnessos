import type { NutritionPorts, NutritionSnapshot } from '@fitnessos/ctx-nutrition'
import type { AuthContext, HttpClient } from '../http/client'
import { nutritionPlanBodyFrom, nutritionPlanFrom } from '../mappers/nutrition'

/** HTTP implementation of the Nutrition ports. */
export const createNutritionAdapter = (
  http: HttpClient,
  auth: AuthContext,
): NutritionPorts['nutrition'] => ({
  current: async (signal?: AbortSignal): Promise<NutritionSnapshot | null> => {
    const raw = await http.request('/nutrition-plans/current', {
      auth,
      ...(signal ? { signal } : {}),
    })
    // 204 → null: no plan yet is the normal state before a coach writes one.
    if (raw === undefined || raw === null) return null
    return nutritionPlanFrom(raw)
  },

  save: async (plan, signal?: AbortSignal): Promise<NutritionSnapshot> =>
    nutritionPlanFrom(
      await http.request(`/nutrition-plans/${plan.id}`, {
        method: 'PUT',
        body: nutritionPlanBodyFrom(plan),
        auth,
        ...(signal ? { signal } : {}),
      }),
    ),
})
