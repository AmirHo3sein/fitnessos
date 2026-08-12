'use client'

import { useSubject } from '@fitnessos/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { currentNutritionPlanQuery, nutritionKeys } from '../../application/index'
import type { NutritionSnapshot } from '../../editor/schema'
import { useNutritionPorts } from '../di'

export interface UseNutritionPlan {
  readonly plan: NutritionSnapshot | null
  readonly isLoading: boolean
  /**
   * The LOAD failed — distinct from "nothing authored yet", and that distinction is load-bearing.
   *
   * Both used to arrive at the workspace as `null`, so a transient network failure rendered the
   * empty state: "nothing has been written yet", beside a Create button. Pressing it PUT a NEW id,
   * and because the server keys "current" per athlete, the artefact that merely failed to load was
   * overwritten by an empty one. Silent data loss from a dropped request.
   */
  readonly loadFailed: boolean
  /** Refetch, so the answer to a failed load is one press rather than a full reload. */
  readonly retry: () => void
  /** TRUE when the save reached the server — what moves the editor's commit boundary. */
  readonly save: (plan: NutritionSnapshot) => Promise<boolean>
  readonly isSaving: boolean
  readonly error: Error | null
}

export const useNutritionPlan = (): UseNutritionPlan => {
  const ports = useNutritionPorts()
  const subject = useSubject()
  const queryClient = useQueryClient()
  const query = useQuery(currentNutritionPlanQuery(ports, subject))

  const mutation = useMutation({
    /*
      The base revision comes from the envelope this render was drawn from — the plan the author
      actually edited — and never from the editor, which is not told a revision exists (ADR-0035).
      `null` only where nothing was read, which is the first save and the one case with nothing to
      collide with; sent against a plan that exists it answers 409 rather than overwriting it.
    */
    mutationFn: (plan: NutritionSnapshot) =>
      ports.nutrition.save(plan, query.data?.revision ?? null),
    // Set, not invalidate: the response IS the new state — the ENVELOPE, so the next save carries
    // the revision this one produced instead of the stale one it replaced.
    onSuccess: (saved) => {
      queryClient.setQueryData(nutritionKeys.current(subject), saved)
    },
  })

  return {
    plan: query.data?.artefact ?? null,
    isLoading: query.isPending,
    loadFailed: query.isError,
    retry: () => {
      void query.refetch()
    },
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
