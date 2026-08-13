'use client'

import { useSubject } from '@fitnessos/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  currentNutritionPlanQuery,
  NutritionConflictError,
  nutritionKeys,
  type Loaded,
} from '../../application/index'
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
  /**
   * TRUE when the save reached the server — what moves the editor's commit boundary.
   *
   * FALSE on a conflict as well, because a conflict did not save. Why it failed is in `conflict`
   * rather than in the boolean: the caller's question here is only whether to commit.
   */
  readonly save: (plan: NutritionSnapshot) => Promise<boolean>
  readonly isSaving: boolean
  readonly error: Error | null
  /**
   * The plan as the server holds it, when a save collided with another author.
   *
   * Separate from `error` because nothing broke — someone else got there first, and both documents
   * exist. Reported through both would be a screen showing "we could not store your change" beside
   * the resolution it contradicts.
   *
   * The ENVELOPE, unlike `plan`: resolving a conflict eventually means saving over what is stored,
   * and that save must quote the revision this collision revealed. A bare snapshot would leave the
   * only base revision in reach the stale one that caused the collision.
   */
  readonly conflict: Loaded<NutritionSnapshot> | null
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
    // A conflict is reported through `conflict`, so it must not also arrive as an error — a
    // component rendering both would show "something went wrong" beside what the author collided
    // with, and only one of those two is true.
    error: mutation.error instanceof NutritionConflictError ? null : mutation.error,
    conflict: mutation.error instanceof NutritionConflictError ? mutation.error.current : null,
  }
}
