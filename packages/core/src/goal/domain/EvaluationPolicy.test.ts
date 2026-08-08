import { addDays, isErr, isOk, unwrapOrThrow, type PlainDate } from '@fitnessos/kernel'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CADENCE_DAYS,
  MAX_CADENCE_DAYS,
  MIN_CADENCE_DAYS,
  evaluationPolicy,
  nextEvaluationDue,
} from './EvaluationPolicy'

const policy = (days: number) =>
  unwrapOrThrow(evaluationPolicy(days), (e) => new Error(JSON.stringify(e)))

const DECLARED: PlainDate = { year: 2026, month: 8, day: 8 }

describe('evaluationPolicy', () => {
  it('accepts the default of four weeks', () => {
    expect(policy(DEFAULT_CADENCE_DAYS).cadenceDays).toBe(28)
  })

  it('rejects a cadence shorter than weekly', () => {
    // Adaptation does not resolve faster than this, so a shorter cadence judges noise —
    // and a product that asks "making progress?" daily teaches the athlete not to answer.
    const result = evaluationPolicy(3)
    expect(isErr(result) && result.error.kind).toBe('cadence-too-short')
  })

  it('accepts exactly the minimum and maximum', () => {
    expect(isOk(evaluationPolicy(MIN_CADENCE_DAYS))).toBe(true)
    expect(isOk(evaluationPolicy(MAX_CADENCE_DAYS))).toBe(true)
  })

  it('rejects a cadence beyond a year', () => {
    const result = evaluationPolicy(MAX_CADENCE_DAYS + 1)
    expect(isErr(result) && result.error.kind).toBe('cadence-too-long')
  })

  it('rejects a fractional cadence', () => {
    expect(isErr(evaluationPolicy(14.5))).toBe(true)
  })

  it('carries no evaluation history — it declares a rule only (ADR-0006)', () => {
    expect(Object.keys(policy(28))).toEqual(['cadenceDays'])
  })
})

describe('nextEvaluationDue', () => {
  it('counts from declaration when never evaluated', () => {
    expect(nextEvaluationDue(policy(28), DECLARED, null)).toEqual(addDays(DECLARED, 28))
  })

  it('counts from the last evaluation when there is one', () => {
    const last = addDays(DECLARED, 10)
    expect(nextEvaluationDue(policy(28), DECLARED, last)).toEqual(addDays(last, 28))
  })

  it('crosses a month boundary correctly', () => {
    // Date arithmetic on a plain date is where off-by-one bugs live.
    expect(nextEvaluationDue(policy(28), { year: 2026, month: 8, day: 20 }, null)).toEqual({
      year: 2026,
      month: 9,
      day: 17,
    })
  })

  it('crosses a leap day correctly', () => {
    expect(nextEvaluationDue(policy(7), { year: 2028, month: 2, day: 26 }, null)).toEqual({
      year: 2028,
      month: 3,
      day: 4,
    })
  })
})
