'use client'

import { useSubject } from '@fitnessos/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { currentReportQuery, reportKeys, type Loaded } from '../../application/index'
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
  /** Resolves TRUE when the save reached the server — what moves the editor's commit boundary. */
  readonly save: (report: ReportSnapshot) => Promise<boolean>
  readonly isSaving: boolean
  readonly error: Error | null
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

  return {
    // `.artefact`, so components keep receiving the document. The revision stays in the cache,
    // where the save path reads it and nothing else can.
    report: query.data?.artefact ?? null,
    isLoading: query.isPending,
    loadFailed: query.isError,
    retry: () => {
      void query.refetch()
    },
    save: async (report) => {
      try {
        await mutation.mutateAsync(report)
        return true
      } catch {
        return false
      }
    },
    isSaving: mutation.isPending,
    error: mutation.error,
  }
}
