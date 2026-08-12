'use client'

import { useSubject } from '@fitnessos/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { currentDashboardQuery, dashboardKeys } from '../../application/index'
import type { DashboardSnapshot } from '../../editor/schema'
import { useDashboardPorts } from '../di'

export interface UseDashboard {
  readonly dashboard: DashboardSnapshot | null
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
  readonly save: (dashboard: DashboardSnapshot) => Promise<boolean>
  readonly isSaving: boolean
  readonly error: Error | null
}

export const useDashboard = (): UseDashboard => {
  const ports = useDashboardPorts()
  const subject = useSubject()
  const queryClient = useQueryClient()
  const query = useQuery(currentDashboardQuery(ports, subject))

  const mutation = useMutation({
    // The base revision comes from the query cache, never from the editor: the document is
    // undoable and the precondition must not be (ADR-0035). `null` is a first save — there is
    // nothing on the server to collide with.
    mutationFn: (dashboard: DashboardSnapshot) =>
      ports.dashboard.save(dashboard, query.data?.revision ?? null),
    // Set, not invalidate: the response IS the new state — including the revision the NEXT save
    // must send — and refetching would leave a window where the grid and the cache disagree about
    // where a widget is.
    onSuccess: (saved) => {
      queryClient.setQueryData(dashboardKeys.current(subject), saved)
    },
  })

  return {
    dashboard: query.data?.artefact ?? null,
    isLoading: query.isPending,
    loadFailed: query.isError,
    retry: () => {
      void query.refetch()
    },
    save: async (dashboard) => {
      try {
        await mutation.mutateAsync(dashboard)
        return true
      } catch {
        return false
      }
    },
    isSaving: mutation.isPending,
    error: mutation.error,
  }
}
