'use client'

import { useSubject } from '@fitnessos/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  currentDashboardQuery,
  dashboardKeys,
  DashboardConflictError, type Loaded } from '../../application/index'
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
  /**
   * TRUE when the save reached the server — what moves the editor's commit boundary.
   *
   * FALSE on a conflict too, because a refused save did not save. The caller reads `conflict` to
   * learn that the reason was another author rather than a broken request.
   */
  readonly save: (dashboard: DashboardSnapshot) => Promise<boolean>
  readonly isSaving: boolean
  readonly error: Error | null
  /**
   * The dashboard as the server holds it, when a save collided with another author.
   *
   * Surfaced separately from `error` because it is not a failure the reader should see as one —
   * nothing broke, someone else saved first, and both arrangements exist. The local one is still in
   * the grid; this is what it met.
   */
  /**
   * The artefact as the server holds it, WITH its revision.
   *
   * `Loaded`, not the bare snapshot: the revision is what a resolution needs. Without it the query
   * cache still holds the base the server just refused, so every subsequent save quotes the same dead
   * precondition and conflicts again — the author is stuck until a refetch replaces their document,
   * which is the work they were trying not to lose.
   */
  readonly conflict: Loaded<DashboardSnapshot> | null
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
    // A conflict is reported through `conflict`, so it must not also arrive as an error — a
    // workspace rendering both would show "we could not store your change" beside the two
    // arrangements it is asking the author to choose between.
    error: mutation.error instanceof DashboardConflictError ? null : mutation.error,
    conflict:
      mutation.error instanceof DashboardConflictError ? mutation.error.current : null,
  }
}
