import { subjectScope, type SubjectId } from '@fitnessos/kernel'
import type { PlanSnapshot } from '../../editor/schema'
import type { Loaded, TimelinePorts } from '../ports/index'

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
  // The cache holds the ENVELOPE, not the plan: the revision a save must assert is only knowable
  // from the read that produced it, so it has to survive in the same place (ADR-0035).
): QueryDefinition<Loaded<PlanSnapshot> | null> => ({
  queryKey: timelineKeys.current(subject),
  queryFn: ({ signal }) => ports.timeline.current(signal),
  staleTime: 5 * 60_000,
})
