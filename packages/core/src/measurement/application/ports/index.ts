import type { AthleteId, ObservationId, PlainDate } from '@fitnessos/kernel'
import type { IndicatorKind } from '../../domain/IndicatorKind'

/**
 * Measurement — ports.
 *
 * Read models (D-06): no invariants, tolerant reader. The aggregate in `domain/` enforces the
 * rules when an observation is recorded; these accept whatever the backend holds, including
 * measurements taken before a rule existed and indicator kinds this build has never seen.
 *
 * Never call `Date.now()` in a use case. `recordObservation` takes today as an argument, because
 * "is this measurement in the future" is a decision that must be reproducible in a test.
 */

/** How a value came to be known, flattened for the wire. See `domain/Acquisition.ts`. */
export interface AcquisitionSnapshot {
  readonly kind: 'self-reported' | 'device' | 'practitioner'
  /** Present for `device`. */
  readonly source: string | null
  /** Present for `practitioner`. */
  readonly recordedBy: string | null
}

export interface ObservationSnapshot {
  readonly id: ObservationId
  readonly athleteId: AthleteId
  readonly kind: IndicatorKind
  readonly value: number
  readonly unit: string
  readonly observedOn: PlainDate
  readonly acquisition: AcquisitionSnapshot
}

/**
 * A point in a published derived indicator (ADR-0013).
 *
 * Derived by the server from observations and performed sessions, never stored (ADR-0006) —
 * which is why there is no `id` here. A point is a computed answer, not a record, and giving it
 * an identity would invite something to reference it and then expect it to still exist.
 */
export interface IndicatorPoint {
  readonly on: PlainDate
  readonly value: number
}

/**
 * One indicator's series — the published language Prescription consumes to resolve progression.
 *
 * `unit` sits on the series rather than the point: a series whose unit changed partway through
 * is not a series, it is two, and putting the unit on each point makes that representable.
 */
export interface IndicatorSeriesSnapshot {
  readonly kind: IndicatorKind
  readonly unit: string
  /** Ascending by date. The client sorts anyway — the contract promises no order. */
  readonly points: readonly IndicatorPoint[]
  /**
   * The movement this series is about, for per-movement indicators like an estimated 1RM.
   *
   * Null for whole-body indicators. Not an id: ADR-0012 makes display-name snapshots time-boxed
   * debt, and until catalogue versioning exists a name is what the backend can honestly give.
   */
  readonly movementName: string | null
}

export interface RecordObservationInput {
  readonly id: ObservationId
  readonly kind: IndicatorKind
  readonly value: number
  readonly unit: string
  readonly observedOn: PlainDate
  readonly acquisition: AcquisitionSnapshot
}

export interface MeasurementReadPort {
  /** The athlete's recorded observations. Filtering and windowing are the server's business. */
  readonly observations: (signal?: AbortSignal) => Promise<readonly ObservationSnapshot[]>
  /**
   * Published derived indicators.
   *
   * A separate endpoint from `observations` rather than a field on it, because they are
   * different KINDS of thing: one is what was recorded, the other is what follows from it. A
   * client that could not tell them apart would eventually let an athlete edit a derivation.
   */
  readonly indicators: (signal?: AbortSignal) => Promise<readonly IndicatorSeriesSnapshot[]>
}

export interface MeasurementWritePort {
  /**
   * Record a measurement.
   *
   * Client-generated id (ADR-0010), so a retry after a lost response is safe — the same
   * requirement as session logging, for the same reason, and recorded in
   * `packages/contracts/BACKEND-CONTRACT.md`.
   */
  readonly record: (
    input: RecordObservationInput,
    signal?: AbortSignal,
  ) => Promise<ObservationSnapshot>
}

export interface MeasurementPorts {
  readonly measurement: MeasurementReadPort & MeasurementWritePort
}
