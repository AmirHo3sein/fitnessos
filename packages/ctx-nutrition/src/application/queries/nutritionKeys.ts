import type { NutritionSnapshot } from '../../editor/schema'
import type { NutritionPorts } from '../ports/index'

export const nutritionKeys = {
  all: ['nutrition-plan'] as const,
  current: () => [...nutritionKeys.all, 'current'] as const,
} as const

export interface QueryDefinition<T> {
  readonly queryKey: readonly unknown[]
  readonly queryFn: (ctx: { signal: AbortSignal }) => Promise<T>
  readonly staleTime?: number
}

export const currentNutritionPlanQuery = (
  ports: NutritionPorts,
): QueryDefinition<NutritionSnapshot | null> => ({
  queryKey: nutritionKeys.current(),
  queryFn: ({ signal }) => ports.nutrition.current(signal),
  staleTime: 5 * 60_000,
})
