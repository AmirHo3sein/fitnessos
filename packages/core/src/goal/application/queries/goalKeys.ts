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
  all: ['goal'] as const,
  mine: () => [...goalKeys.all, 'mine'] as const,
  byAthlete: (athleteId: AthleteId) => [...goalKeys.all, 'athlete', athleteId] as const,
} as const

export interface QueryDefinition<T> {
  readonly queryKey: readonly unknown[]
  readonly queryFn: (ctx: { signal: AbortSignal }) => Promise<T>
  readonly staleTime?: number
}

export const myGoalsQuery = (
  ports: GoalPorts,
): QueryDefinition<readonly GoalSnapshot[]> => ({
  queryKey: goalKeys.mine(),
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
  onGoalDeclared: (qc: Invalidator) => qc.invalidateQueries({ queryKey: goalKeys.mine() }),
  onGoalRetired: (qc: Invalidator) => qc.invalidateQueries({ queryKey: goalKeys.mine() }),
} as const
