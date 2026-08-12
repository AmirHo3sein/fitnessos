import { subjectScope, type SubjectId } from '@fitnessos/kernel'
import type { NutritionSnapshot } from '../../editor/schema'
import type { Loaded, NutritionPorts } from '../ports/index'

export const nutritionKeys = {
  all: (subject: SubjectId) => [...subjectScope(subject), 'nutrition-plan'] as const,
  current: (subject: SubjectId) => [...nutritionKeys.all(subject), 'current'] as const,
} as const

export interface QueryDefinition<T> {
  readonly queryKey: readonly unknown[]
  readonly queryFn: (ctx: { signal: AbortSignal }) => Promise<T>
  readonly staleTime?: number
}

export const currentNutritionPlanQuery = (
  ports: NutritionPorts,
  subject: SubjectId,
  // The cache holds the ENVELOPE, not the plan: the revision a save must echo is only ever the
  // one that came back with the document it was edited from.
): QueryDefinition<Loaded<NutritionSnapshot> | null> => ({
  queryKey: nutritionKeys.current(subject),
  queryFn: ({ signal }) => ports.nutrition.current(signal),
  staleTime: 5 * 60_000,
})
