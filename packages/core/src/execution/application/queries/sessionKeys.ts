import type {
  ExecutionPorts,
  PrescribedSessionSnapshot,
  SyncIssueSnapshot,
} from '../ports/index'

export const sessionKeys = {
  all: ['session'] as const,
  upcoming: () => [...sessionKeys.all, 'upcoming'] as const,
  /** Outside `all`, so invalidating the session list does not refetch the local issue log. */
  syncIssues: () => ['sync-issues'] as const,
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

export const syncIssuesQuery = (
  ports: ExecutionPorts,
): QueryDefinition<readonly SyncIssueSnapshot[]> => ({
  queryKey: sessionKeys.syncIssues(),
  queryFn: () => ports.execution.syncIssues(),
  // Zero, because this reads IndexedDB rather than the network: it is cheap, and the alternative
  // is an athlete who dismisses an issue and watches it reappear from a stale cache.
  staleTime: 0,
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
