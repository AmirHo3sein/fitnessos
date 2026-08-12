import { subjectScope, type SubjectId } from '@fitnessos/kernel'
import type { AthleteId } from '@fitnessos/kernel'
import type { AthletePorts, AthleteSnapshot } from '../ports/index'

/**
 * Athlete — query keys, definitions and invalidation rules.
 *
 * Handbook §3.2: the highest-value-per-line file in a TanStack Query codebase.
 * Invalidation bugs are the most common and least diagnosable class of bug in
 * this kind of application, so the rules live here as testable data rather than
 * scattered across the components that happen to trigger them.
 *
 * Nothing here imports React. A query *definition* is a plain object; the
 * presentation layer passes it to `useQuery`, and the server passes the same
 * object to `prefetchQuery`. One definition, two call sites, no drift — which is
 * the whole reason the RSC prefetch in apps/web can be trusted to warm the exact
 * cache entry the client will read.
 */

export const athleteKeys = {
  all: (subject: SubjectId) => [...subjectScope(subject), 'athlete'] as const,
  /**
   * The authenticated person's own athlete.
   *
   * Deliberately NOT keyed by athlete id, and therefore **the one query that cannot be
   * subject-scoped**: the id is unknown until the response arrives, and keying by it would mean the
   * cache entry could not be warmed before the first fetch — which is exactly what the RSC prefetch
   * needs to do.
   *
   * It is also not a subject question. "Who am I" is asked of the PERSON (ADR-0005), before any
   * subject exists — the athlete surface resolves this first and then provides its own id as the
   * subject for everything else. Hence the `me` root rather than a subject prefix.
   */
  mine: () => ['me', 'athlete'] as const,
  byId: (id: AthleteId) => [...athleteKeys.all(id), 'byId', id] as const,
} as const

export interface QueryDefinition<T> {
  readonly queryKey: readonly unknown[]
  readonly queryFn: (ctx: { signal: AbortSignal }) => Promise<T>
  readonly staleTime?: number
}

export const myAthleteQuery = (ports: AthletePorts): QueryDefinition<AthleteSnapshot> => ({
  queryKey: athleteKeys.mine(),
  queryFn: ({ signal }) => ports.athlete.getMine(signal),
  // An athlete's identity and availability change on the order of weeks. A short
  // staleTime here would refetch on every navigation for data that has not moved.
  staleTime: 5 * 60_000,
})

/**
 * Invalidation rules.
 *
 * Named by the DOMAIN EVENT that triggers them, never by the mutation that
 * happened to cause it — so a second cause of the same event reuses the rule
 * instead of duplicating it. Typed against a minimal structural interface rather
 * than importing QueryClient, which would pull a React-bound package into the
 * application layer and trip `no-react-in-logic`.
 */
export interface Invalidator {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => Promise<void> | void
}

export const athleteInvalidations = {
  onAvailabilityChanged: (qc: Invalidator) =>
    qc.invalidateQueries({ queryKey: athleteKeys.mine() }),

  onTrainingIdentityRevised: (qc: Invalidator) =>
    qc.invalidateQueries({ queryKey: athleteKeys.mine() }),
} as const
