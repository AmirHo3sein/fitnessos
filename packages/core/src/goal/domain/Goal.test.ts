import {
  addDays,
  isErr,
  isOk,
  unwrapOrThrow,
  type AthleteId,
  type GoalId,
  type PlainDate,
} from '@fitnessos/kernel'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CADENCE_DAYS, evaluationPolicy } from './EvaluationPolicy'
import { goalIntent } from './GoalIntent'
import {
  MIN_HORIZON_DAYS,
  daysOverdueForEvaluation,
  goal as makeGoal,
  isDueForEvaluation,
  isPastHorizon,
  type Goal,
} from './Goal'

/** A fixed date, so every horizon rule is tested at a known point rather than "today". */
const TODAY: PlainDate = { year: 2026, month: 8, day: 8 }

const intent = unwrapOrThrow(goalIntent('Run 10k without stopping'), () => new Error('fixture'))
const policy = unwrapOrThrow(evaluationPolicy(DEFAULT_CADENCE_DAYS), () => new Error('fixture'))

const declare = (over: { horizon?: PlainDate | null } = {}, today = TODAY) =>
  makeGoal(
    {
      id: 'g-1' as GoalId,
      athleteId: 'a-1' as AthleteId,
      intent,
      horizon: over.horizon === undefined ? addDays(TODAY, 90) : over.horizon,
      evaluationPolicy: policy,
    },
    today,
  )

const goal = (over: { horizon?: PlainDate | null } = {}, today = TODAY): Goal =>
  unwrapOrThrow(declare(over, today), (e) => new Error(JSON.stringify(e)))

describe('declareGoal', () => {
  it('records the declaration date from the supplied date, not a clock read inside', () => {
    // The domain never calls Date.now(). A rule about horizons that read the real clock
    // would pass in March and fail in December.
    expect(goal().declaredOn).toEqual(TODAY)
  })

  it('accepts an open-ended goal', () => {
    // Null horizon is a real answer: "I want to be able to do this" with no deadline.
    expect(goal({ horizon: null }).horizon).toBeNull()
  })

  it('rejects a horizon in the past', () => {
    const result = declare({ horizon: addDays(TODAY, -1) })
    expect(isErr(result) && result.error.kind).toBe('horizon-in-past')
  })

  it('rejects a horizon too near to be evaluated even once', () => {
    // Minimum cadence is 7 days, so a horizon inside a week creates an obligation to
    // judge (ADR-0007) that cannot be discharged before it arrives.
    const result = declare({ horizon: addDays(TODAY, 3) })
    expect(isErr(result) && result.error.kind).toBe('horizon-too-near')
  })

  it('accepts a horizon exactly at the minimum', () => {
    expect(isOk(declare({ horizon: addDays(TODAY, MIN_HORIZON_DAYS) }))).toBe(true)
  })

  it('rejects today as a horizon', () => {
    expect(isErr(declare({ horizon: TODAY }))).toBe(true)
  })
})

describe('no stored state (ADR-0006)', () => {
  /**
   * The guard on the decision most likely to be "fixed" by someone who has not read
   * ADR-0006. A stored `status` or `isOverdue` is wrong the instant time passes, which
   * means something must write it — a scheduled job, or a state machine spanning this
   * context and Learning. Both are rejected.
   *
   * If this test fails, the fix is to delete the field, not the test.
   */
  it('has no status, isExpired, isOverdue or closedAt field', () => {
    const keys = Object.keys(goal())
    expect(keys).not.toContain('status')
    expect(keys).not.toContain('isExpired')
    expect(keys).not.toContain('isOverdue')
    expect(keys).not.toContain('closedAt')
    expect(keys).not.toContain('lastEvaluatedAt')
  })

  it('stores exactly the declared facts and nothing derived', () => {
    expect(Object.keys(goal()).sort()).toEqual([
      'athleteId',
      'declaredOn',
      'evaluationPolicy',
      'horizon',
      'id',
      'intent',
    ])
  })
})

describe('references nothing (ADR-0018)', () => {
  it('holds no programme, session, observation or proposal id', () => {
    // A goal that held a programme id would become a coordination record, and every
    // context touching programmes would have to know about goals. The link runs the
    // other way: ProgramVersion carries ServesGoal (ADR-0008).
    const keys = Object.keys(goal()).join(' ').toLowerCase()
    for (const forbidden of ['program', 'session', 'observation', 'proposal']) {
      expect(keys).not.toContain(forbidden)
    }
  })
})

describe('isPastHorizon — derived', () => {
  it('is false before the horizon', () => {
    expect(isPastHorizon(goal(), addDays(TODAY, 89))).toBe(false)
  })

  it('is false on the horizon itself', () => {
    // The last day counts. A goal is not failed on the morning of its deadline.
    expect(isPastHorizon(goal(), addDays(TODAY, 90))).toBe(false)
  })

  it('is true the day after', () => {
    expect(isPastHorizon(goal(), addDays(TODAY, 91))).toBe(true)
  })

  it('is never true for an open-ended goal, however far in the future', () => {
    expect(isPastHorizon(goal({ horizon: null }), addDays(TODAY, 10_000))).toBe(false)
  })
})

describe('isDueForEvaluation — derived, with last evaluation from outside', () => {
  it('is not due before the cadence has elapsed since declaration', () => {
    expect(isDueForEvaluation(goal(), null, addDays(TODAY, DEFAULT_CADENCE_DAYS - 1))).toBe(false)
  })

  it('is due exactly on the cadence boundary', () => {
    expect(isDueForEvaluation(goal(), null, addDays(TODAY, DEFAULT_CADENCE_DAYS))).toBe(true)
  })

  it('counts from the last evaluation when there is one', () => {
    // `lastEvaluatedOn` is a parameter because the record of having evaluated is a
    // DecisionOutcome in the Learning context, which this context may not read
    // (ADR-0019).
    const lastEvaluated = addDays(TODAY, 20)
    expect(isDueForEvaluation(goal(), lastEvaluated, addDays(TODAY, 30))).toBe(false)
    expect(isDueForEvaluation(goal(), lastEvaluated, addDays(TODAY, 48))).toBe(true)
  })

  it('a recent evaluation resets the obligation even long after declaration', () => {
    const farFuture = addDays(TODAY, 400)
    expect(isDueForEvaluation(goal(), farFuture, addDays(farFuture, 1))).toBe(false)
  })
})

describe('daysOverdueForEvaluation', () => {
  it('is zero when not yet due', () => {
    expect(daysOverdueForEvaluation(goal(), null, addDays(TODAY, 10))).toBe(0)
  })

  it('is zero on the day it becomes due', () => {
    expect(daysOverdueForEvaluation(goal(), null, addDays(TODAY, DEFAULT_CADENCE_DAYS))).toBe(0)
  })

  it('counts days past the due date', () => {
    // "Due" and "three weeks overdue" warrant different treatment in a UI, and doing
    // the arithmetic at the call site would put cadence logic in presentation.
    expect(daysOverdueForEvaluation(goal(), null, addDays(TODAY, DEFAULT_CADENCE_DAYS + 21)))
      .toBe(21)
  })
})
