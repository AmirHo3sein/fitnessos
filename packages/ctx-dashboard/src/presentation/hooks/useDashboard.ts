'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { currentDashboardQuery, dashboardKeys } from '../../application/index'
import type { DashboardSnapshot } from '../../editor/schema'
import { useDashboardPorts } from '../di'

export interface UseDashboard {
  readonly dashboard: DashboardSnapshot | null
  readonly isLoading: boolean
  /** TRUE when the save reached the server — what moves the editor's commit boundary. */
  readonly save: (dashboard: DashboardSnapshot) => Promise<boolean>
  readonly isSaving: boolean
  readonly error: Error | null
}

export const useDashboard = (): UseDashboard => {
  const ports = useDashboardPorts()
  const queryClient = useQueryClient()
  const query = useQuery(currentDashboardQuery(ports))

  const mutation = useMutation({
    mutationFn: (dashboard: DashboardSnapshot) => ports.dashboard.save(dashboard),
    // Set, not invalidate: the response IS the new state, and refetching would leave a window
    // where the grid and the cache disagree about where a widget is.
    onSuccess: (saved) => {
      queryClient.setQueryData(dashboardKeys.current(), saved)
    },
  })

  return {
    dashboard: query.data ?? null,
    isLoading: query.isPending,
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
