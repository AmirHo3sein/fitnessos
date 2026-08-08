import { isErr, isOk, unwrapOrThrow } from '@fitnessos/kernel'
import { describe, expect, it } from 'vitest'
import {
  MAX_TRAINING_AGE_MONTHS,
  trainingIdentity,
  trainingIdentityToInput,
  type TrainingIdentity,
  type TrainingIdentityInput,
} from './TrainingIdentity'

const base: TrainingIdentityInput = {
  experienceLevel: 'intermediate',
  trainingAgeMonths: 18,
  disciplines: ['strength'],
}

const make = (over: Partial<TrainingIdentityInput> = {}): TrainingIdentity =>
  unwrapOrThrow(trainingIdentity({ ...base, ...over }), (e) => new Error(JSON.stringify(e)))

describe('trainingIdentity — experience level', () => {
  it.each(['beginner', 'intermediate', 'advanced'])('accepts %s', (experienceLevel) => {
    expect(isOk(trainingIdentity({ ...base, experienceLevel }))).toBe(true)
  })

  it('rejects a value outside the vocabulary, echoing what was given', () => {
    // The echo matters when this arrives from a backend that added a level: the error
    // names the unknown value, so the fix is obvious rather than a hunt.
    const result = trainingIdentity({ ...base, experienceLevel: 'elite' })
    expect(isErr(result) && result.error).toEqual({
      kind: 'unknown-experience-level',
      given: 'elite',
    })
  })

  it('rejects an empty string rather than treating it as unset', () => {
    expect(isErr(trainingIdentity({ ...base, experienceLevel: '' }))).toBe(true)
  })
})

describe('trainingIdentity — disciplines', () => {
  it('rejects an empty list', () => {
    // An athlete trains *something*. An empty list is a skipped form, and a programme
    // cannot be prescribed without knowing what for.
    const result = trainingIdentity({ ...base, disciplines: [] })
    expect(isErr(result) && result.error.kind).toBe('no-disciplines')
  })

  it('rejects a list of only blanks, which is an empty list in disguise', () => {
    expect(isErr(trainingIdentity({ ...base, disciplines: ['', '   '] }))).toBe(true)
  })

  it('trims and deduplicates', () => {
    expect(make({ disciplines: [' strength ', 'strength', 'running'] }).disciplines).toEqual([
      'running',
      'strength',
    ])
  })

  it('orders, so selection order does not change the value', () => {
    expect(make({ disciplines: ['running', 'strength'] }).disciplines).toEqual(
      make({ disciplines: ['strength', 'running'] }).disciplines,
    )
  })

  it('is stricter than the contract, deliberately', () => {
    // The contract permits an empty array, so the READ side accepts an athlete
    // recorded before this rule existed. The write side will not create another.
    // Tolerant reader, strict writer — the same principle as the non-strict response
    // schemas. If this ever becomes symmetric, one of the two is wrong.
    expect(isErr(trainingIdentity({ ...base, disciplines: [] }))).toBe(true)
  })
})

describe('trainingIdentity — training age', () => {
  it('accepts null, since the athlete may not know', () => {
    expect(make({ trainingAgeMonths: null }).trainingAgeMonths).toBeNull()
  })

  it('accepts zero — starting today is a valid answer', () => {
    expect(isOk(trainingIdentity({ ...base, trainingAgeMonths: 0 }))).toBe(true)
  })

  it('rejects a negative value', () => {
    const result = trainingIdentity({ ...base, trainingAgeMonths: -1 })
    expect(isErr(result) && result.error.kind).toBe('training-age-negative')
  })

  it('rejects a fractional value', () => {
    const result = trainingIdentity({ ...base, trainingAgeMonths: 6.5 })
    expect(isErr(result) && result.error.kind).toBe('training-age-not-whole')
  })

  it('rejects a year typed into a months field', () => {
    // The failure this exists for. `2024` is 168 years, sails past a `>= 0` check, and
    // then feeds every calculation that treats training age as a progression input.
    const result = trainingIdentity({ ...base, trainingAgeMonths: 2024 })
    expect(isErr(result) && result.error.kind).toBe('training-age-implausible')
  })

  it('accepts the plausibility bound exactly', () => {
    expect(isOk(trainingIdentity({ ...base, trainingAgeMonths: MAX_TRAINING_AGE_MONTHS })))
      .toBe(true)
  })
})

describe('trainingIdentityToInput', () => {
  it('round-trips through the constructor', () => {
    const input = trainingIdentityToInput(make())
    expect(isOk(trainingIdentity(input))).toBe(true)
    expect(input).toEqual({
      experienceLevel: 'intermediate',
      trainingAgeMonths: 18,
      disciplines: ['strength'],
    })
  })
})
