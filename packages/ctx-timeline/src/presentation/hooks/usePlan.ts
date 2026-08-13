'use client'

import { useSubject } from '@fitnessos/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  currentPlanQuery,
  PlanConflictError,
  timelineKeys,
  type Loaded,
} from '../../application/index'
import type { PlanSnapshot } from '../../editor/schema'
import { useTimelinePorts } from '../di'

export interface UsePlan {
  readonly plan: PlanSnapshot | null
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
   * FALSE also covers a collision, because a refused save did not save. The caller reads `conflict`
   * to learn which of the two it was.
   */
  readonly save: (plan: PlanSnapshot) => Promise<boolean>
  readonly isSaving: boolean
  readonly error: Error | null
  /**
   * The plan as the server holds it, when a save collided with another author (§2.1a).
   *
   * Surfaced separately from `error` because it is not a failure the reader should see as one —
   * nothing broke, someone else got there first, and both versions still exist.
   *
   * The envelope, not the snapshot: resolving a collision ends in a save, and that save must assert
   * the revision it is replacing. Without it the author could see what they collided with and still
   * not keep their own work.
   */
  readonly conflict: Loaded<PlanSnapshot> | null
}

export const usePlan = (): UsePlan => {
  const ports = useTimelinePorts()
  const subject = useSubject()
  const queryClient = useQueryClient()
  const query = useQuery(currentPlanQuery(ports, subject))

  const mutation = useMutation({
    /*
      The revision comes from the CACHE at mutate time, not from `query.data` closed over by this
      render. Two saves in a row would otherwise both assert the revision read before the first,
      and the second would 409 against a plan this client itself had just written.

      The editor never sees it: `save` still takes a snapshot, and the precondition is supplied
      here, beside the document rather than inside it (ADR-0035).
    */
    mutationFn: (plan: PlanSnapshot) =>
      ports.timeline.save(
        plan,
        queryClient.getQueryData<Loaded<PlanSnapshot> | null>(timelineKeys.current(subject))
          ?.revision ?? null,
      ),
    // Set, not invalidate: the response IS the new state — including the revision the next save
    // must assert, which is why the envelope is stored rather than the plan alone.
    onSuccess: (saved) => {
      queryClient.setQueryData(timelineKeys.current(subject), saved)
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
    // A collision is reported through `conflict`, so it must not also arrive as an error — a
    // workspace rendering both would show "we could not store your change" beside the resolution UI.
    error: mutation.error instanceof PlanConflictError ? null : mutation.error,
    /*
      Deliberately NOT written into the cache. The cache is what the builder hydrates from, so
      storing the server's plan here would swap the document out from under an author mid-edit —
      losing exactly the work this exists to protect. It stays beside the editor until the author
      decides, and the revision it carries is what makes deciding "keep mine" possible.
    */
    conflict: mutation.error instanceof PlanConflictError ? mutation.error.current : null,
  }
}
