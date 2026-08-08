import type { ExecutionPorts, PrescribedSessionSnapshot } from '../ports/index'

export const sessionKeys = {
  all: ['session'] as const,
  upcoming: () => [...sessionKeys.all, 'upcoming'] as const,
} as const

export interface QueryDefinition<T> {
  readonly queryKey: readonly unknown[]
  readonly queryFn: (ctx: { signal: AbortSignal }) => Promise<T>
  readonly staleTime?: number
}

export const upcomingSessionsQuery = (
  ports: ExecutionPorts,
): QueryDefinition<readonly PrescribedSessionSnapshot[]> => ({
  queryKey: sessionKeys.upcoming(),
  queryFn: ({ signal }) => ports.execution.upcomingSessions(signal),
  // Shorter than the programme's. What is upcoming changes as sessions are performed, and a
  // list that still shows a session the athlete finished an hour ago reads as broken.
  staleTime: 60_000,
})

export interface Invalidator {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => Promise<void> | void
}

export const sessionInvalidations = {
  onSessionPerformed: (qc: Invalidator) => qc.invalidateQueries({ queryKey: sessionKeys.all }),
  /**
   * A revised programme regenerates upcoming sessions, so this list is stale even though
   * nothing in Execution changed. Naming the rule after the event rather than the mutation is
   * what makes that reachable from the Prescription side without a cross-context write.
   */
  onProgramRevised: (qc: Invalidator) => qc.invalidateQueries({ queryKey: sessionKeys.all }),
} as const
