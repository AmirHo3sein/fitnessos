import { subjectScope, type SubjectId } from '@fitnessos/kernel'
import type { AthleteId } from '@fitnessos/kernel'

/**
 * Development — query keys, definitions and invalidation rules.
 *
 * Handbook §3.2: this file is the highest-value-per-line artefact in the repo.
 * Invalidation bugs are the most common and least diagnosable class of bug in a
 * TanStack Query application, so the rules live here as testable data rather
 * than scattered across components.
 *
 * Nothing here imports React. Presentation calls `useQuery(definition)`.
 */

export const developmentKeys = {
  all: (subject: SubjectId) => [...subjectScope(subject), 'development'] as const,
  byAthlete: (athleteId: AthleteId) => [...developmentKeys.all(athleteId), 'athlete', athleteId] as const,
} as const

/**
 * Invalidation rules, expressed against the key factory above.
 *
 * Named by the DOMAIN EVENT that triggers them, not by the mutation that caused
 * it — so a second cause of the same event reuses the rule instead of duplicating
 * it. Cross-context reaction is always: event arrives → invalidate a key.
 */
export const developmentInvalidations = {
  // onSomethingHappened: (qc: QueryClient, athleteId: AthleteId) =>
  //   qc.invalidateQueries({ queryKey: developmentKeys.byAthlete(athleteId) }),
} as const
