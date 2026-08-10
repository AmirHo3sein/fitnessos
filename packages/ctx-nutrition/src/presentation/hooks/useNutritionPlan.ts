'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { currentNutritionPlanQuery, nutritionKeys } from '../../application/index'
import type { NutritionSnapshot } from '../../editor/schema'
import { useNutritionPorts } from '../di'

export interface UseNutritionPlan {
  readonly plan: NutritionSnapshot | null
  readonly isLoading: boolean
  /** TRUE when the save reached the server — what moves the editor's commit boundary. */
  readonly save: (plan: NutritionSnapshot) => Promise<boolean>
  readonly isSaving: boolean
  readonly error: Error | null
}

export const useNutritionPlan = (): UseNutritionPlan => {
  const ports = useNutritionPorts()
  const queryClient = useQueryClient()
  const query = useQuery(currentNutritionPlanQuery(ports))

  const mutation = useMutation({
    mutationFn: (plan: NutritionSnapshot) => ports.nutrition.save(plan),
    // Set, not invalidate: the response IS the new state.
    onSuccess: (saved) => {
      queryClient.setQueryData(nutritionKeys.current(), saved)
    },
  })

  return {
    plan: query.data ?? null,
    isLoading: query.isPending,
    save: async (plan) => {
      try {
        await mutation.mutateAsync(plan)
        return true
      } catch {
        return false
      }
    },
    isSaving: mutation.isPending,
    error: mutation.error,
  }
}
