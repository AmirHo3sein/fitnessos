import type { PlanSnapshot } from '../../editor/schema'
import type { TimelinePorts } from '../ports/index'

export const timelineKeys = {
  all: ['plan'] as const,
  current: () => [...timelineKeys.all, 'current'] as const,
} as const

export interface QueryDefinition<T> {
  readonly queryKey: readonly unknown[]
  readonly queryFn: (ctx: { signal: AbortSignal }) => Promise<T>
  readonly staleTime?: number
}

export const currentPlanQuery = (ports: TimelinePorts): QueryDefinition<PlanSnapshot | null> => ({
  queryKey: timelineKeys.current(),
  queryFn: ({ signal }) => ports.timeline.current(signal),
  staleTime: 5 * 60_000,
})
