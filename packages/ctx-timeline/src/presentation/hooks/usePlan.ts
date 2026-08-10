'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { currentPlanQuery, timelineKeys } from '../../application/index'
import type { PlanSnapshot } from '../../editor/schema'
import { useTimelinePorts } from '../di'

export interface UsePlan {
  readonly plan: PlanSnapshot | null
  readonly isLoading: boolean
  /** TRUE when the save reached the server — what moves the editor's commit boundary. */
  readonly save: (plan: PlanSnapshot) => Promise<boolean>
  readonly isSaving: boolean
  readonly error: Error | null
}

export const usePlan = (): UsePlan => {
  const ports = useTimelinePorts()
  const queryClient = useQueryClient()
  const query = useQuery(currentPlanQuery(ports))

  const mutation = useMutation({
    mutationFn: (plan: PlanSnapshot) => ports.timeline.save(plan),
    // Set, not invalidate: the response IS the new state.
    onSuccess: (saved) => {
      queryClient.setQueryData(timelineKeys.current(), saved)
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
