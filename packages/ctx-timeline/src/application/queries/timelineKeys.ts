import { subjectScope, type SubjectId } from '@fitnessos/kernel'
import type { PlanSnapshot } from '../../editor/schema'
import type { TimelinePorts } from '../ports/index'

export const timelineKeys = {
  all: (subject: SubjectId) => [...subjectScope(subject), 'plan'] as const,
  current: (subject: SubjectId) => [...timelineKeys.all(subject), 'current'] as const,
} as const

export interface QueryDefinition<T> {
  readonly queryKey: readonly unknown[]
  readonly queryFn: (ctx: { signal: AbortSignal }) => Promise<T>
  readonly staleTime?: number
}

export const currentPlanQuery = (
  ports: TimelinePorts,
  subject: SubjectId,
): QueryDefinition<PlanSnapshot | null> => ({
  queryKey: timelineKeys.current(subject),
  queryFn: ({ signal }) => ports.timeline.current(signal),
  staleTime: 5 * 60_000,
})
