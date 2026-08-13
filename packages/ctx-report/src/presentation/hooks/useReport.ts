'use client'

import { useSubject } from '@fitnessos/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  currentReportQuery,
  ReportConflictError,
  reportKeys,
  type Loaded,
} from '../../application/index'
import type { ReportSnapshot } from '../../editor/schema'
import { useReportPorts } from '../di'

export interface UseReport {
  readonly report: ReportSnapshot | null
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
   * Resolves TRUE when the save reached the server — what moves the editor's commit boundary.
   *
   * A collision resolves FALSE like any other unsuccessful save, because nothing was stored. The
   * caller reads `conflict` to find out that this failure has another document behind it.
   */
  readonly save: (report: ReportSnapshot) => Promise<boolean>
  readonly isSaving: boolean
  readonly error: Error | null
  /**
   * The report as the server holds it, when a save collided with another author — WITH its revision.
   *
   * Surfaced separately from `error` because it is not a failure the user should see as one —
   * nothing broke, someone else got there first, and both documents still exist.
   *
   * `Loaded`, not the bare snapshot: the revision is what a resolution needs. Without it the query
   * cache still holds the base the server just refused, so every subsequent save quotes the same dead
   * precondition and conflicts again — the author is stuck until a refetch replaces their document,
   * which is the work they were trying not to lose.
   */
  readonly conflict: Loaded<ReportSnapshot> | null
  /**
   * Keep the author's document: store it again, onto the revision the server just quoted back.
   *
   * The whole point of showing the collision. The local document is the work; taking the server's
   * revision is only how it gets past the precondition that refused it.
   *
   * Resolves like `save` — FALSE if the second attempt collided as well, which happens when a third
   * save landed in between and simply presents the newer conflict.
   */
  readonly keepMine: (report: ReportSnapshot) => Promise<boolean>
  /** Take the other author's document instead, discarding the local one. */
  readonly takeTheirs: () => void
  /**
   * Dismiss the conflict without resolving it.
   *
   * `conflict` is derived from the mutation's last error, and a mutation holds that error until it is
   * reset or superseded — so nothing else can clear it. Without this the dialog would have no way to
   * close, and an author who wanted to keep looking at their own canvas first would be reading it
   * through a panel they cannot get rid of.
   */
  readonly reset: () => void
}

export const useReport = (): UseReport => {
  const ports = useReportPorts()
  const subject = useSubject()
  const queryClient = useQueryClient()

  const query = useQuery(currentReportQuery(ports, subject))

  const mutation = useMutation({
    /*
      The base revision comes from the CACHE at the moment of the save, not from `query.data` in
      this render's closure. Two saves in quick succession are the case: the first stores a new
      revision below, and a closure captured before it would quote the one it replaced — a 409 the
      coach caused by typing fast. The editor never sees any of this; `save` still takes a snapshot.
    */
    mutationFn: (report: ReportSnapshot) => {
      const loaded = queryClient.getQueryData<Loaded<ReportSnapshot> | null>(
        reportKeys.current(subject),
      )
      return ports.report.save(report, loaded?.revision ?? null)
    },
    // Set rather than invalidate: the response IS the new state — including its new revision — so
    // refetching would spend a round trip on data already in hand and leave a window where the
    // canvas and the cache disagree about where a tile is.
    onSuccess: (saved) => {
      queryClient.setQueryData(reportKeys.current(subject), saved)
    },
  })

  const save = async (report: ReportSnapshot) => {
    try {
      await mutation.mutateAsync(report)
      return true
    } catch {
      return false
    }
  }

  const collided = mutation.error instanceof ReportConflictError ? mutation.error.current : null

  /*
    Adopt the server's envelope into the cache — the one move both resolutions share.

    It is what makes the NEXT save quote a live precondition, because `mutationFn` above reads its
    base from exactly here. Refetching instead would ask for a document we were just handed, and
    leave a window in which the base is the dead one.
  */
  const adopt = (theirs: Loaded<ReportSnapshot>) => {
    queryClient.setQueryData(reportKeys.current(subject), theirs)
  }

  return {
    // `.artefact`, so components keep receiving the document. The revision stays in the cache,
    // where the save path reads it and nothing else can.
    report: query.data?.artefact ?? null,
    isLoading: query.isPending,
    loadFailed: query.isError,
    retry: () => {
      void query.refetch()
    },
    save,
    keepMine: async (report) => {
      if (collided === null) return false
      // The server's revision goes in FIRST, then the author's document is stored against it.
      // Without the first step the retry re-sends the base the server already refused and 409s
      // again — the author would press "keep mine" and watch the same panel reappear for ever.
      adopt(collided)
      return save(report)
    },
    takeTheirs: () => {
      if (collided === null) return
      adopt(collided)
      // Cleared explicitly: adopting changes the cache, which the mutation's error knows nothing
      // about, so the panel would otherwise stay open over a document that is no longer contested.
      mutation.reset()
    },
    reset: mutation.reset,
    isSaving: mutation.isPending,
    // A conflict is reported through `conflict`, so it must not also arrive as an error — a
    // workspace rendering both would show "we could not store your change" beside the two versions
    // it is asking the coach to choose between.
    error: mutation.error instanceof ReportConflictError ? null : mutation.error,
    // The envelope, not the document: a resolution has to quote the server's revision, and reading
    // it back out of the cache afterwards would mean trusting that nothing moved in between.
    conflict: collided,
  }
}
