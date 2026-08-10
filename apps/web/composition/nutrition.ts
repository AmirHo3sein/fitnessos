import type { NutritionPorts } from '@fitnessos/ctx-nutrition'
import { createNutritionAdapter } from '@fitnessos/infra'
import type { AuthContext, HttpClient } from './container'

/** Nutrition ports. Imported by the `(app)` route group only. */
export const createNutritionPorts = (http: HttpClient, auth: AuthContext): NutritionPorts => ({
  nutrition: createNutritionAdapter(http, auth),
})
