import { isErr, isOk, toBase, unwrapOrThrow } from '@fitnessos/kernel'
import { describe, expect, it } from 'vitest'
import {
  MIN_SESSION_CEILING_SECONDS,
  availability,
  availabilityToInput,
  type Availability,
  type AvailabilityInput,
} from './Availability'

const base: AvailabilityInput = {
  daysPerWeek: 4,
  sessionCeilingSeconds: 4200,
  equipmentAccess: ['barbell', 'rack'],
}

const make = (over: Partial<AvailabilityInput> = {}): Availability =>
  unwrapOrThrow(availability({ ...base, ...over }), (e) => new Error(JSON.stringify(e)))

describe('availability — days per week', () => {
  it.each([1, 4, 7])('accepts %i', (daysPerWeek) => {
    expect(isOk(availability({ ...base, daysPerWeek }))).toBe(true)
  })

  it.each([0, 8, -1, 100])('rejects %i as out of range', (daysPerWeek) => {
    const result = availability({ ...base, daysPerWeek })
    expect(isErr(result) && result.error.kind).toBe('days-out-of-range')
  })

  it('rejects a fractional value as a distinct error, not by rounding', () => {
    // 3.5 days a week is a reasonable thing to mean and an impossible thing to
    // schedule. Rounding would resolve the ambiguity by a rule nobody chose.
    const result = availability({ ...base, daysPerWeek: 3.5 })
    expect(isErr(result) && result.error.kind).toBe('days-not-whole')
  })

  it('rejects NaN, which is what an empty numeric input parses to', () => {
    expect(isErr(availability({ ...base, daysPerWeek: Number.NaN }))).toBe(true)
  })
})

describe('availability — session ceiling', () => {
  it('accepts a null ceiling, meaning the athlete stated none', () => {
    expect(make({ sessionCeilingSeconds: null }).sessionCeiling).toBeNull()
  })

  it('distinguishes zero from null', () => {
    // Zero is what a half-finished form submits, and it means "cannot train at all".
    // Treating it as "no ceiling" would silently invert the athlete's statement.
    const result = availability({ ...base, sessionCeilingSeconds: 0 })
    expect(isErr(result) && result.error.kind).toBe('ceiling-not-positive')
  })

  it('rejects a negative ceiling', () => {
    const result = availability({ ...base, sessionCeilingSeconds: -60 })
    expect(isErr(result) && result.error.kind).toBe('ceiling-not-positive')
  })

  it('rejects a ceiling below the ten-minute floor, reporting both numbers', () => {
    // Both, so the message can say what was given AND what is required. An error that
    // states only the rule makes the user guess which of their inputs broke it.
    const result = availability({ ...base, sessionCeilingSeconds: 300 })
    expect(isErr(result) && result.error).toEqual({
      kind: 'ceiling-too-short',
      givenSeconds: 300,
      minSeconds: MIN_SESSION_CEILING_SECONDS,
    })
  })

  it('accepts exactly the floor', () => {
    // Boundary, and the direction that matters: a `<=` here would reject a value the
    // contract explicitly permits.
    expect(isOk(availability({ ...base, sessionCeilingSeconds: MIN_SESSION_CEILING_SECONDS })))
      .toBe(true)
  })

  it('carries the ceiling as a dimensioned Quantity, not a bare number', () => {
    expect(toBase(make().sessionCeiling!)).toBe(4200)
  })
})

describe('availability — equipment', () => {
  it('deduplicates', () => {
    expect(make({ equipmentAccess: ['rack', 'barbell', 'rack'] }).equipmentAccess).toEqual([
      'barbell',
      'rack',
    ])
  })

  it('orders, so click order does not change the value', () => {
    // Two athletes who selected the same equipment in a different order must produce
    // the same value — otherwise equality, and anything keyed on it, depends on the
    // sequence of clicks.
    expect(make({ equipmentAccess: ['rack', 'barbell'] }).equipmentAccess).toEqual(
      make({ equipmentAccess: ['barbell', 'rack'] }).equipmentAccess,
    )
  })

  it('accepts an empty list — no equipment is a real answer', () => {
    // Bodyweight training is training. This is deliberately not an error, unlike an
    // empty discipline list.
    expect(isOk(availability({ ...base, equipmentAccess: [] }))).toBe(true)
  })
})

describe('availabilityToInput', () => {
  it('round-trips', () => {
    // The outbound mapper depends on this: what was constructed must serialise back to
    // something the same constructor accepts, or a read-modify-write cycle corrupts.
    const input = availabilityToInput(make())
    expect(input).toEqual({
      daysPerWeek: 4,
      sessionCeilingSeconds: 4200,
      equipmentAccess: ['barbell', 'rack'],
    })
    expect(isOk(availability(input))).toBe(true)
  })

  it('round-trips a null ceiling as null, not as zero or absent', () => {
    expect(availabilityToInput(make({ sessionCeilingSeconds: null })).sessionCeilingSeconds)
      .toBeNull()
  })
})
