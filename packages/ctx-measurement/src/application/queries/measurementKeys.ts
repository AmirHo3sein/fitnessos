import { subjectScope, type SubjectId } from '@fitnessos/kernel'
import type {
  CheckInFormSnapshot,
  IndicatorSeriesSnapshot,
  MeasurementPorts,
  ObservationSnapshot,
} from '../ports/index'

export const measurementKeys = {
  all: (subject: SubjectId) => [...subjectScope(subject), 'measurement'] as const,
  observations: (subject: SubjectId) => [...measurementKeys.all(subject), 'observations'] as const,
  indicators: (subject: SubjectId) => [...measurementKeys.all(subject), 'indicators'] as const,
  checkInForm: (subject: SubjectId) => [...measurementKeys.all(subject), 'check-in-form'] as const,
} as const

export interface QueryDefinition<T> {
  readonly queryKey: readonly unknown[]
  readonly queryFn: (ctx: { signal: AbortSignal }) => Promise<T>
  readonly staleTime?: number
}

export const observationsQuery = (
  ports: MeasurementPorts,
  subject: SubjectId,
): QueryDefinition<readonly ObservationSnapshot[]> => ({
  queryKey: measurementKeys.observations(subject),
  queryFn: ({ signal }) => ports.measurement.observations(signal),
  staleTime: 5 * 60_000,
})

export const indicatorsQuery = (
  ports: MeasurementPorts,
  subject: SubjectId,
): QueryDefinition<readonly IndicatorSeriesSnapshot[]> => ({
  queryKey: measurementKeys.indicators(subject),
  queryFn: ({ signal }) => ports.measurement.indicators(signal),
  // Shorter than observations. An indicator is DERIVED from performed sessions as well as
  // observations, so it moves when a session is logged — without the athlete recording anything
  // here at all.
  staleTime: 60_000,
})

export const checkInFormQuery = (
  ports: MeasurementPorts,
  subject: SubjectId,
): QueryDefinition<CheckInFormSnapshot | null> => ({
  queryKey: measurementKeys.checkInForm(subject),
  queryFn: ({ signal }) => ports.measurement.checkInForm(signal),
  // Long. A form changes when a coach authors one, which is rare, and the editor sets the cache
  // from the save response rather than waiting for a refetch.
  staleTime: 5 * 60_000,
})

export interface Invalidator {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => Promise<void> | void
}

/**
 * Named by domain event, not by mutation.
 *
 * `onSessionPerformed` lives here as well as in Execution, and that is the point of ADR-0024's
 * cycle: logging a session changes a derived indicator without touching a single observation.
 * A client that only invalidated Measurement when Measurement was written would show an athlete
 * a stale estimated 1RM immediately after the session that moved it.
 */
export const measurementInvalidations = {
  onObservationRecorded: (qc: Invalidator, subject: SubjectId) =>
    qc.invalidateQueries({ queryKey: measurementKeys.all(subject) }),
  onSessionPerformed: (qc: Invalidator, subject: SubjectId) =>
    qc.invalidateQueries({ queryKey: measurementKeys.indicators(subject) }),
} as const
