import type { DashboardSnapshot } from '../../editor/schema'
import type { DashboardPorts } from '../ports/index'

export const dashboardKeys = {
  all: ['dashboard-layout'] as const,
  current: () => [...dashboardKeys.all, 'current'] as const,
} as const

export interface QueryDefinition<T> {
  readonly queryKey: readonly unknown[]
  readonly queryFn: (ctx: { signal: AbortSignal }) => Promise<T>
  readonly staleTime?: number
}

export const currentDashboardQuery = (
  ports: DashboardPorts,
): QueryDefinition<DashboardSnapshot | null> => ({
  queryKey: dashboardKeys.current(),
  queryFn: ({ signal }) => ports.dashboard.current(signal),
  staleTime: 5 * 60_000,
})
