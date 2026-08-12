'use client'

import { useSubject } from '@fitnessos/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { currentPlanQuery, timelineKeys, type Loaded } from '../../application/index'
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
  /** TRUE when the save reached the server — what moves the editor's commit boundary. */
  readonly save: (plan: PlanSnapshot) => Promise<boolean>
  readonly isSaving: boolean
  readonly error: Error | null
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
    error: mutation.error,
  }
}
