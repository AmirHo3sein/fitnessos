import { subjectScope, type SubjectId } from '@fitnessos/kernel'
import type { DashboardSnapshot } from '../../editor/schema'
import type { DashboardPorts } from '../ports/index'

export const dashboardKeys = {
  all: (subject: SubjectId) => [...subjectScope(subject), 'dashboard-layout'] as const,
  current: (subject: SubjectId) => [...dashboardKeys.all(subject), 'current'] as const,
} as const

export interface QueryDefinition<T> {
  readonly queryKey: readonly unknown[]
  readonly queryFn: (ctx: { signal: AbortSignal }) => Promise<T>
  readonly staleTime?: number
}

export const currentDashboardQuery = (
  ports: DashboardPorts,
  subject: SubjectId,
): QueryDefinition<DashboardSnapshot | null> => ({
  queryKey: dashboardKeys.current(subject),
  queryFn: ({ signal }) => ports.dashboard.current(signal),
  staleTime: 5 * 60_000,
})
