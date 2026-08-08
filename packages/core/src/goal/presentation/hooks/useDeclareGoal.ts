'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { systemClock, type AthleteId } from '@fitnessos/kernel'
import {
  declareGoal,
  goalKeys,
  type GoalDraft,
  type GoalSnapshot,
} from '../../application/index'
import { useGoalPorts } from '../di'

export interface UseDeclareGoal {
  readonly submit: (draft: GoalDraft) => void
  readonly isSubmitting: boolean
  readonly error: Error | null
}

/**
 * Declares a goal.
 *
 * `systemClock` and the timezone are supplied HERE, at the presentation boundary, and
 * passed into the use case — which never reads a clock itself. That is what keeps the
 * horizon rules testable at an arbitrary date rather than only on the day a test runs.
 *
 * The zone is the athlete's, not the browser's guess. `Intl` is the only source available
 * client-side, but it is the athlete's device rather than their stated preference — noted
 * because once a profile timezone exists, this is the line that has to change.
 *
 * `invalidateQueries`, not `setQueryData`, unlike onboarding: the response is ONE goal
 * and the cache holds a LIST. Setting would require merging, and a merge that guesses the
 * server's ordering is how a list ends up in a different order than a refetch produces.
 */
export const useDeclareGoal = (
  athleteId: AthleteId,
  onDeclared: (goal: GoalSnapshot) => void,
): UseDeclareGoal => {
  const ports = useGoalPorts()
  const queryClient = useQueryClient()
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone

  const mutation = useMutation({
    mutationFn: (draft: GoalDraft) =>
      declareGoal(ports, athleteId, draft, systemClock, zone),
    onSuccess: (goal) => {
      void queryClient.invalidateQueries({ queryKey: goalKeys.mine() })
      onDeclared(goal)
    },
  })

  return {
    submit: mutation.mutate,
    isSubmitting: mutation.isPending,
    error: mutation.error,
  }
}
