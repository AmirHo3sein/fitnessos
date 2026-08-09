import type {
  AcquisitionSnapshot,
  IndicatorSeriesSnapshot,
  ObservationSnapshot,
  RecordObservationInput,
} from '@fitnessos/core/measurement'
import {
  IndicatorSeriesSchema,
  ObservationSchema,
  RecordObservationBodySchema,
  type components,
} from '@fitnessos/contracts'
import { idFrom, type PlainDate } from '@fitnessos/kernel'
import type { z } from 'zod'
import { parseContract, type FieldsAgree } from './parse'

/**
 * Measurement mappers.
 *
 * The recurring shape here is `absent → null`. The contract marks `source`, `recordedBy` and
 * `movementName` optional, and the application types declare them `| null`, so an absent key
 * would leave `undefined` — which renders differently, compares differently and serialises
 * differently from `null`. Normalising at the boundary means nothing downstream has to know
 * which the wire used.
 */

type ContractObservation = components['schemas']['Observation']
type ValidatedObservation = z.infer<typeof ObservationSchema>
type ContractSeries = components['schemas']['IndicatorSeries']
type ValidatedSeries = z.infer<typeof IndicatorSeriesSchema>
type ContractRecordBody = components['schemas']['RecordObservationBody']
type ValidatedRecordBody = z.infer<typeof RecordObservationBodySchema>

/**
 * ISO date → PlainDate, WITHOUT going through `Date`.
 *
 * `new Date("2026-08-10")` parses as UTC midnight, so in a negative-offset zone it renders as
 * the 9th — a measurement taken on Monday shown as Sunday, for some athletes and not others.
 */
const plainDateFrom = (iso: string): PlainDate => {
  const [year, month, day] = iso.split('-').map(Number)
  return { year: year ?? 0, month: month ?? 1, day: day ?? 1 }
}

const isoFrom = (d: PlainDate): string =>
  `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`

const acquisitionFrom = (raw: ValidatedObservation['acquisition']): AcquisitionSnapshot => ({
  kind: raw.kind,
  source: raw.source ?? null,
  recordedBy: raw.recordedBy ?? null,
})

export const observationFrom = (raw: unknown): ObservationSnapshot => {
  const c = parseContract(ObservationSchema, raw, 'Observation')
  return {
    id: idFrom<'ObservationId'>(c.id),
    athleteId: idFrom<'AthleteId'>(c.athleteId),
    kind: c.kind,
    value: c.value,
    unit: c.unit,
    observedOn: plainDateFrom(c.observedOn),
    acquisition: acquisitionFrom(c.acquisition),
  }
}

export const observationsFrom = (raw: unknown): readonly ObservationSnapshot[] =>
  (Array.isArray(raw) ? raw : []).map(observationFrom)

export const indicatorSeriesFrom = (raw: unknown): IndicatorSeriesSnapshot => {
  const c = parseContract(IndicatorSeriesSchema, raw, 'IndicatorSeries')
  return {
    kind: c.kind,
    unit: c.unit,
    movementName: c.movementName ?? null,
    points: c.points.map((point) => ({ on: plainDateFrom(point.on), value: point.value })),
  }
}

export const indicatorsFrom = (raw: unknown): readonly IndicatorSeriesSnapshot[] =>
  (Array.isArray(raw) ? raw : []).map(indicatorSeriesFrom)

/**
 * Outbound, validated on the way out (ADR-0031).
 *
 * The `null → absent` direction, which is the one that fails loudly if got wrong: `source` is
 * constrained to a non-empty string, so sending `source: null` for a self-report is refused by
 * the server for a field the athlete never filled in.
 */
export const recordObservationBodyFrom = (
  input: RecordObservationInput,
): ValidatedRecordBody => {
  const body = {
    id: input.id,
    kind: input.kind,
    value: input.value,
    unit: input.unit,
    observedOn: isoFrom(input.observedOn),
    acquisition: {
      kind: input.acquisition.kind,
      ...(input.acquisition.source === null ? {} : { source: input.acquisition.source }),
      ...(input.acquisition.recordedBy === null
        ? {}
        : { recordedBy: input.acquisition.recordedBy }),
    },
  }
  return parseContract(RecordObservationBodySchema, body, 'RecordObservationBody (request)')
}

export const OBSERVATION_COVERAGE: Record<keyof ContractObservation, true> = {
  id: true,
  athleteId: true,
  kind: true,
  value: true,
  unit: true,
  observedOn: true,
  acquisition: true,
}

export const INDICATOR_SERIES_COVERAGE: Record<keyof ContractSeries, true> = {
  kind: true,
  unit: true,
  movementName: true,
  points: true,
}

export const RECORD_BODY_COVERAGE: Record<keyof ContractRecordBody, true> = {
  id: true,
  kind: true,
  value: true,
  unit: true,
  observedOn: true,
  acquisition: true,
}

const _observationAgrees: FieldsAgree<ContractObservation, ValidatedObservation> = true
const _seriesAgrees: FieldsAgree<ContractSeries, ValidatedSeries> = true
const _recordAgrees: FieldsAgree<ContractRecordBody, ValidatedRecordBody> = true
void _observationAgrees
void _seriesAgrees
void _recordAgrees
