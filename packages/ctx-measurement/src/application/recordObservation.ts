import { isErr, type AthleteId, type ObservationId, type PlainDate } from '@fitnessos/kernel'
import { deviceReading, practitionerReading, selfReported } from '../domain/Acquisition'
import { observation, type ObservationError } from '../domain/Observation'
import type { AcquisitionSnapshot, MeasurementPorts, ObservationSnapshot } from './ports/index'

/**
 * Record a measurement.
 *
 * D-05: the hook composes, the use case decides. The rules live here so they can be tested
 * without a renderer, and so a second caller — an import from a device integration, say — gets
 * the same checks rather than a second implementation of them.
 *
 * `today` is a parameter. Never `Date.now()` in a use case: "is this measurement in the future"
 * has to be reproducible in a test, and a clock read inside the rule makes the test depend on
 * the day it runs.
 */

export class ObservationValidationError extends Error {
  override readonly name = 'ObservationValidationError'
  constructor(readonly problem: ObservationError | { readonly kind: string }) {
    super(problem.kind)
  }
}

/**
 * Rebuild the `Acquisition` value object from the flat wire shape.
 *
 * The flattening is a boundary concern, so the boundary is where it is undone. A use case that
 * accepted the flat shape and passed it through would let a device reading with no source reach
 * the aggregate, which is precisely the case `deviceReading` exists to refuse.
 */
const acquisitionFrom = (snapshot: AcquisitionSnapshot) => {
  if (snapshot.kind === 'device') return deviceReading(snapshot.source ?? '')
  if (snapshot.kind === 'practitioner') return practitionerReading(snapshot.recordedBy ?? '')
  return { ok: true as const, value: selfReported() }
}

export interface RecordObservationDraft {
  readonly id: ObservationId
  readonly athleteId: AthleteId
  readonly kind: string
  readonly value: number
  readonly unit: string
  readonly observedOn: PlainDate
  readonly acquisition: AcquisitionSnapshot
}

export const recordObservation = async (
  ports: MeasurementPorts,
  draft: RecordObservationDraft,
  today: PlainDate,
  signal?: AbortSignal,
): Promise<ObservationSnapshot> => {
  const acquisition = acquisitionFrom(draft.acquisition)
  if (isErr(acquisition)) throw new ObservationValidationError(acquisition.error)

  const constructed = observation({
    id: draft.id,
    athleteId: draft.athleteId,
    kind: draft.kind,
    value: draft.value,
    unit: draft.unit,
    observedOn: draft.observedOn,
    acquisition: acquisition.value,
    today,
  })
  if (isErr(constructed)) throw new ObservationValidationError(constructed.error)

  // The aggregate's own output is sent, not the draft — trimmed kind, trimmed unit, validated
  // provenance. Sending the draft would mean two athletes recording " kg " and "kg" write
  // different rows for the same measurement.
  return ports.measurement.record(
    {
      id: constructed.value.id,
      kind: constructed.value.kind,
      value: constructed.value.value,
      unit: constructed.value.unit,
      observedOn: constructed.value.observedOn,
      acquisition: draft.acquisition,
    },
    signal,
  )
}
