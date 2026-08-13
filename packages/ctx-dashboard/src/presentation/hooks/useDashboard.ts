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
  /**
   * Resolve the conflict in the author's favour: send the REFUSED document again, this time quoting
   * the revision the server reported.
   *
   * The re-send lives here rather than in the workspace because the workspace does not hold the
   * document — the editor store does, and the only copy the workspace can reach is the one the
   * refused save carried. That copy is exactly what "keep mine" means.
   *
   * Quoting the server's revision is the whole mechanism. Retrying with the cached base would repeat
   * the dead precondition and conflict forever, which is the state the author was stuck in before
   * this existed.
   *
   * TRUE when it landed; FALSE when it did not, including when someone saved AGAIN in between — in
   * which case a fresh `conflict` appears with the newer revision and the same choice is offered.
   */
  readonly keepMine: () => Promise<boolean>
  /**
   * Resolve it the other way: adopt the server's arrangement and abandon the local one.
   *
   * Nothing is sent. The conflict already carried the artefact AND the revision it belongs to, so
   * seeding the cache with that envelope is a complete, correct read — the next save quotes a live
   * precondition without a round trip.
   */
  readonly takeTheirs: () => void
  /**
   * Dismiss the conflict without resolving it.
   *
   * There is otherwise NO way to clear `conflict`: it is derived from `mutation.error`, which
   * survives until the next save or a reset. So an author who wants to look at the grid before
   * choosing would be arguing with an undismissable dialog, and the two resolutions above would have
   * no way to put it away once they had done their work.
   */
  readonly reset: () => void
}

/** What a save sends: the document, and the revision it claims to be replacing (ADR-0035). */
interface SaveAttempt {
  readonly dashboard: DashboardSnapshot
  readonly baseRevision: number | null
}

export const useDashboard = (): UseDashboard => {
  const ports = useDashboardPorts()
  const subject = useSubject()
  const queryClient = useQueryClient()
  const query = useQuery(currentDashboardQuery(ports, subject))

  const mutation = useMutation({
    // The precondition travels WITH the document as a mutation variable rather than being read from
    // the cache inside `mutationFn`. Two reasons: a resolving save needs a base the cache does not
    // hold (the server's, from the conflict), and the variables of the refused attempt are then the
    // record of what to re-send.
    mutationFn: ({ dashboard, baseRevision }: SaveAttempt) =>
      ports.dashboard.save(dashboard, baseRevision),
    // Set, not invalidate: the response IS the new state — including the revision the NEXT save
    // must send — and refetching would leave a window where the grid and the cache disagree about
    // where a widget is.
    onSuccess: (saved) => {
      queryClient.setQueryData(dashboardKeys.current(subject), saved)
    },
  })

  const conflict =
    mutation.error instanceof DashboardConflictError ? mutation.error.current : null

  const attempt = async (next: SaveAttempt): Promise<boolean> => {
    try {
      await mutation.mutateAsync(next)
      return true
    } catch {
      return false
    }
  }

  return {
    dashboard: query.data?.artefact ?? null,
    isLoading: query.isPending,
    loadFailed: query.isError,
    retry: () => {
      void query.refetch()
    },
    // The base comes from the query cache, never from the editor: the document is undoable and the
    // precondition must not be (ADR-0035). `null` is a first save — nothing to collide with.
    save: (dashboard) => attempt({ dashboard, baseRevision: query.data?.revision ?? null }),
    isSaving: mutation.isPending,
    // A conflict is reported through `conflict`, so it must not also arrive as an error — a
    // workspace rendering both would show "we could not store your change" beside the two
    // arrangements it is asking the author to choose between.
    error: mutation.error instanceof DashboardConflictError ? null : mutation.error,
    conflict,
    keepMine: async () => {
      const refused = mutation.variables?.dashboard
      // Guarded rather than assumed: a press that arrives after the conflict has already been
      // resolved elsewhere must not re-send a document nobody is looking at any more.
      if (conflict === null || refused === undefined) return false
      /*
       * `conflict.revision` may be `null` — a server older than BACKEND-CONTRACT §2.1a, which is the
       * only way a 409 arrives without one. Passing it through is right even so: the alternative is
       * inventing a base, and a server that quotes no revision has no precondition to satisfy.
       */
      return attempt({ dashboard: refused, baseRevision: conflict.revision })
    },
    takeTheirs: () => {
      if (conflict === null) return
      queryClient.setQueryData(dashboardKeys.current(subject), conflict)
      // After the cache, not before: `reset` clears the conflict and re-renders the workspace, which
      // must find the adopted arrangement already in place rather than the one it just discarded.
      mutation.reset()
    },
    reset: mutation.reset,
  }
}
