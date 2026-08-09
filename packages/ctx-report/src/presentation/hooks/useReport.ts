'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { currentReportQuery, reportKeys } from '../../application/index'
import type { ReportSnapshot } from '../../editor/schema'
import { useReportPorts } from '../di'

export interface UseReport {
  readonly report: ReportSnapshot | null
  readonly isLoading: boolean
  /** Resolves TRUE when the save reached the server — what moves the editor's commit boundary. */
  readonly save: (report: ReportSnapshot) => Promise<boolean>
  readonly isSaving: boolean
  readonly error: Error | null
}

export const useReport = (): UseReport => {
  const ports = useReportPorts()
  const queryClient = useQueryClient()

  const query = useQuery(currentReportQuery(ports))

  const mutation = useMutation({
    mutationFn: (report: ReportSnapshot) => ports.report.save(report),
    // Set rather than invalidate: the response IS the new state, so refetching would spend a
    // round trip on data already in hand and leave a window where the canvas and the cache
    // disagree about where a tile is.
    onSuccess: (saved) => {
      queryClient.setQueryData(reportKeys.current(), saved)
    },
  })

  return {
    report: query.data ?? null,
    isLoading: query.isPending,
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
