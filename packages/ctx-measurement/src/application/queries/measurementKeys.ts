import type {
  IndicatorSeriesSnapshot,
  MeasurementPorts,
  ObservationSnapshot,
} from '../ports/index'

export const measurementKeys = {
  all: ['measurement'] as const,
  observations: () => [...measurementKeys.all, 'observations'] as const,
  indicators: () => [...measurementKeys.all, 'indicators'] as const,
} as const

export interface QueryDefinition<T> {
  readonly queryKey: readonly unknown[]
  readonly queryFn: (ctx: { signal: AbortSignal }) => Promise<T>
  readonly staleTime?: number
}

export const observationsQuery = (
  ports: MeasurementPorts,
): QueryDefinition<readonly ObservationSnapshot[]> => ({
  queryKey: measurementKeys.observations(),
  queryFn: ({ signal }) => ports.measurement.observations(signal),
  staleTime: 5 * 60_000,
})

export const indicatorsQuery = (
  ports: MeasurementPorts,
): QueryDefinition<readonly IndicatorSeriesSnapshot[]> => ({
  queryKey: measurementKeys.indicators(),
  queryFn: ({ signal }) => ports.measurement.indicators(signal),
  // Shorter than observations. An indicator is DERIVED from performed sessions as well as
  // observations, so it moves when a session is logged — without the athlete recording anything
  // here at all.
  staleTime: 60_000,
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
  onObservationRecorded: (qc: Invalidator) =>
    qc.invalidateQueries({ queryKey: measurementKeys.all }),
  onSessionPerformed: (qc: Invalidator) =>
    qc.invalidateQueries({ queryKey: measurementKeys.indicators() }),
} as const
