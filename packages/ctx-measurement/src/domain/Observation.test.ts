import { isErr, isOk, type AthleteId, type ObservationId, type PlainDate } from '@fitnessos/kernel'
import { describe, expect, it } from 'vitest'
import { deviceReading, practitionerReading, selfReported } from './Acquisition'
import { observation, type ObservationInput } from './Observation'

const TODAY: PlainDate = { year: 2026, month: 8, day: 10 }

const input = (over: Partial<ObservationInput> = {}): ObservationInput => ({
  id: 'o1' as ObservationId,
  athleteId: 'a1' as AthleteId,
  kind: 'bodyweight',
  value: 82.4,
  unit: 'kg',
  observedOn: TODAY,
  acquisition: selfReported(),
  today: TODAY,
  ...over,
})

describe('a valid observation', () => {
  it('is constructed from a measurement taken today', () => {
    const result = observation(input())
    expect(isOk(result)).toBe(true)
  })

  it('trims the kind and unit', () => {
    const result = observation(input({ kind: ' bodyweight ', unit: ' kg ' }))
    expect(isOk(result) && result.value.kind).toBe('bodyweight')
    expect(isOk(result) && result.value.unit).toBe('kg')
  })

  it('accepts an indicator kind this build has never heard of', () => {
    // ADR-0020: the vocabulary is OPEN because every variant has identical structure. A kind
    // added by the backend must be data, not an error — refusing it would make the client the
    // thing that has to ship before a practitioner can record a new measurement.
    expect(isOk(observation(input({ kind: 'grip-strength', unit: 'kg' })))).toBe(true)
  })
})

describe('what it refuses', () => {
  const rejects = (over: Partial<ObservationInput>, kind: string) => {
    const result = observation(input(over))
    expect(isErr(result)).toBe(true)
    expect(isErr(result) && result.error.kind).toBe(kind)
  }

  it('refuses a measurement of the future', () => {
    /**
     * A data-entry mistake, and an expensive one: it sorts to the end of every series forever,
     * so it stays "the latest value" for as long as it exists and every trend is computed
     * against it.
     */
    rejects({ observedOn: { year: 2026, month: 8, day: 11 } }, 'observed-in-the-future')
  })

  it('accepts today itself', () => {
    // The boundary matters: refusing today would mean an athlete cannot record this morning.
    expect(isOk(observation(input({ observedOn: TODAY })))).toBe(true)
  })

  it('compares dates as calendar keys, not through Date', () => {
    // `new Date("2026-08-10")` parses as UTC midnight, so in a negative-offset zone today
    // compares as yesterday and an athlete on the west coast cannot record this morning's
    // weight. Asserted with a date late in the month, where the off-by-one is visible.
    const late: PlainDate = { year: 2026, month: 8, day: 31 }
    expect(isOk(observation(input({ observedOn: late, today: late })))).toBe(true)
  })

  it('refuses a negative value', () => {
    // Nothing this product measures is negative. A minus sign is a typo or a bad conversion,
    // and it would drag every average through zero.
    rejects({ value: -1 }, 'value-negative')
  })

  it('refuses a non-finite value', () => {
    rejects({ value: Number.NaN }, 'value-not-finite')
    rejects({ value: Number.POSITIVE_INFINITY }, 'value-not-finite')
  })

  it('refuses a value with no unit — invariant N11', () => {
    // A measurement without its unit is a number, and a number is not a measurement. 82 of what.
    rejects({ unit: '   ' }, 'unit-missing')
  })

  it('refuses an empty kind', () => {
    rejects({ kind: '  ' }, 'indicator-kind-empty')
  })
})

describe('provenance', () => {
  it('carries who or what produced the value', () => {
    const device = deviceReading('withings-scale')
    expect(isOk(device)).toBe(true)
    const result = observation(input({ acquisition: isOk(device) ? device.value : selfReported() }))
    expect(isOk(result) && result.value.acquisition.kind).toBe('device')
  })

  it('refuses a device reading that names no device', () => {
    // Worse than no source: it claims instrument provenance while naming nothing, so the value
    // reads as more trustworthy than a self-report and is less traceable than one.
    expect(isErr(deviceReading('  '))).toBe(true)
    expect(isErr(practitionerReading(''))).toBe(true)
  })
})

describe('what is deliberately absent', () => {
  it('has no derived fields', () => {
    /**
     * ADR-0006, asserted as a shape rather than trusted. A stored trend, average or staleness
     * flag is wrong the instant the next observation arrives, and something then has to write
     * it — a job, or a state machine spanning contexts, both of which ADR-0006 rejects.
     */
    const result = observation(input())
    const value = isOk(result) ? (result.value as unknown as Record<string, unknown>) : {}

    for (const forbidden of ['trend', 'average', 'isStale', 'status', 'estimatedOneRepMax']) {
      expect(value).not.toHaveProperty(forbidden)
    }
  })
})
