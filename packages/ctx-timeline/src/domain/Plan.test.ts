import { isErr, isOk, type GoalId, type PlainDate } from '@fitnessos/kernel'
import { describe, expect, it } from 'vitest'
import { MIN_PHASE_DAYS } from '../topology/temporal'
import { phaseOn, plan, type Phase, type PlanInput } from './Plan'

const EPOCH: PlainDate = { year: 2026, month: 1, day: 5 }

const phase = (over: Partial<Phase> = {}): Phase => ({
  id: 'p1',
  label: 'Accumulation',
  start: 0,
  length: 28,
  programId: null,
  servesGoal: null,
  ...over,
})

const input = (phases: Phase[]): PlanInput => ({
  id: 'plan-1',
  title: 'Spring block',
  epoch: EPOCH,
  phases,
})

describe('a valid plan', () => {
  it('is constructed from contiguous phases', () => {
    expect(isOk(plan(input([phase(), phase({ id: 'p2', start: 28 })])))).toBe(true)
  })

  it('sorts phases by start, because time has an order', () => {
    // Unlike a grid, where position carries the arrangement entirely. A plan read out of sequence
    // is not a plan.
    const result = plan(input([phase({ id: 'late', start: 56 }), phase({ id: 'early', start: 0 })]))
    expect(isOk(result) && result.value.phases.map((p) => p.id)).toEqual(['early', 'late'])
  })

  it('holds a programme by id only', () => {
    // ADR-0019's shape of rule: naming another context's aggregate is fine, holding its model is
    // not. A `blocks` field here would break this context every time Prescription changed.
    const result = plan(input([phase({ programId: 'prog-1' })]))
    const value = isOk(result) ? (result.value.phases[0] as unknown as Record<string, unknown>) : {}
    expect(value['programId']).toBe('prog-1')
    for (const forbidden of ['blocks', 'programVersion', 'sessions']) {
      expect(value).not.toHaveProperty(forbidden)
    }
  })
})

describe('what it refuses', () => {
  const rejects = (phases: Phase[], kind: string) => {
    const result = plan(input(phases))
    expect(isErr(result)).toBe(true)
    expect(isErr(result) && result.error.kind).toBe(kind)
  }

  it('refuses overlapping phases', () => {
    /**
     * An athlete is in one phase at a time. Two overlapping phases do not render oddly — they
     * make "what am I doing this week" unanswerable, which is the only question a plan exists to
     * answer. And unlike a grid there is nowhere to push one to: time has no "below".
     */
    rejects([phase({ id: 'a', start: 0, length: 28 }), phase({ id: 'b', start: 14 })], 'phases-overlap')
  })

  it('allows phases that touch exactly', () => {
    // Adjacency is the common case — a plan is normally contiguous — so an off-by-one here would
    // make every tidy plan illegal.
    expect(isOk(plan(input([phase({ id: 'a', length: 28 }), phase({ id: 'b', start: 28 })])))).toBe(
      true,
    )
  })

  it('refuses a phase shorter than a week', () => {
    // Below a week there is no full rotation of whatever the phase prescribes; it is a gap with a
    // name.
    rejects([phase({ length: MIN_PHASE_DAYS - 1 })], 'phase-too-short')
    expect(isOk(plan(input([phase({ length: MIN_PHASE_DAYS })])))).toBe(true)
  })

  it('refuses a fractional length', () => {
    // A fraction here is a conversion that went through `Date` when it should have gone through
    // `addDays`.
    rejects([phase({ length: 28.5 })], 'phase-length-not-whole')
  })

  it('refuses a phase before the epoch', () => {
    rejects([phase({ start: -7 })], 'phase-starts-before-epoch')
  })

  it('refuses a blank label and a duplicate id', () => {
    rejects([phase({ label: '  ' })], 'label-empty')
    rejects([phase({ id: 'x' }), phase({ id: 'x', start: 28 })], 'duplicate-phase-id')
  })
})

describe('which phase covers a day', () => {
  const subject = () => {
    const result = plan(input([phase({ id: 'a', length: 28 }), phase({ id: 'b', start: 28 })]))
    if (!isOk(result)) throw new Error('fixture is invalid')
    return result.value
  }

  it('is a query, not a stored field', () => {
    // ADR-0006. A `currentPhase` on the aggregate would be wrong the day after it was written.
    expect(phaseOn(subject(), 0)?.id).toBe('a')
    expect(phaseOn(subject(), 27)?.id).toBe('a')
    expect(phaseOn(subject(), 28)?.id).toBe('b')
    expect(subject()).not.toHaveProperty('currentPhase')
  })

  it('is null outside every phase', () => {
    // A gap is a real answer — a coach may leave a competition window unplanned — and null says
    // so rather than guessing the nearest.
    expect(phaseOn(subject(), 999)).toBeNull()
  })

  it('carries a goal without evaluating against it', () => {
    const withGoal = plan(input([phase({ servesGoal: 'g1' as GoalId })]))
    expect(isOk(withGoal) && withGoal.value.phases[0]?.servesGoal).toBe('g1')
  })
})
