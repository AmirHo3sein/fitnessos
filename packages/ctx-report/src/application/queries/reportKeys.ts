import { subjectScope, type SubjectId } from '@fitnessos/kernel'
import type { ReportSnapshot } from '../../editor/schema'
import type { ReportPorts } from '../ports/index'

export const reportKeys = {
  all: (subject: SubjectId) => [...subjectScope(subject), 'report'] as const,
  current: (subject: SubjectId) => [...reportKeys.all(subject), 'current'] as const,
} as const

export interface QueryDefinition<T> {
  readonly queryKey: readonly unknown[]
  readonly queryFn: (ctx: { signal: AbortSignal }) => Promise<T>
  readonly staleTime?: number
}

export const currentReportQuery = (
  ports: ReportPorts,
  subject: SubjectId,
): QueryDefinition<ReportSnapshot | null> => ({
  queryKey: reportKeys.current(subject),
  queryFn: ({ signal }) => ports.report.current(signal),
  // Long: a report changes when a coach edits one, and the editor sets the cache from the save
  // response rather than waiting for a refetch.
  staleTime: 5 * 60_000,
})
