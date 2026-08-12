import { subjectScope, type SubjectId } from '@fitnessos/kernel'
import type { AthleteId } from '@fitnessos/kernel'
import type { GoalPorts, GoalSnapshot } from '../ports/index'

/**
 * Goal — query keys, definitions and invalidation rules.
 *
 * Nothing here imports React. A query definition is a plain object, passed to `useQuery`
 * by presentation and to `prefetchQuery` by the server — one definition, two call sites,
 * no drift.
 */

export const goalKeys = {
  all: (subject: SubjectId) => [...subjectScope(subject), 'goal'] as const,
  mine: (subject: SubjectId) => [...goalKeys.all(subject), 'mine'] as const,
  byAthlete: (athleteId: AthleteId) => [...goalKeys.all(athleteId), 'athlete', athleteId] as const,
} as const

export interface QueryDefinition<T> {
  readonly queryKey: readonly unknown[]
  readonly queryFn: (ctx: { signal: AbortSignal }) => Promise<T>
  readonly staleTime?: number
}

export const myGoalsQuery = (
  ports: GoalPorts,
  subject: SubjectId,
): QueryDefinition<readonly GoalSnapshot[]> => ({
  queryKey: goalKeys.mine(subject),
  queryFn: ({ signal }) => ports.goal.listMine(signal),
  // A goal changes on the order of weeks. Note this is about the GOAL, not about whether
  // it is overdue — overdue-ness is derived from a date at render time (ADR-0006), so a
  // long staleTime cannot make it stale.
  staleTime: 5 * 60_000,
})

export interface Invalidator {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => Promise<void> | void
}

/**
 * Named by the DOMAIN EVENT, never by the mutation that caused it — so a second cause of
 * the same event reuses the rule instead of duplicating it.
 */
export const goalInvalidations = {
  onGoalDeclared: (qc: Invalidator, subject: SubjectId) => qc.invalidateQueries({ queryKey: goalKeys.mine(subject) }),
  onGoalRetired: (qc: Invalidator, subject: SubjectId) => qc.invalidateQueries({ queryKey: goalKeys.mine(subject) }),
} as const
