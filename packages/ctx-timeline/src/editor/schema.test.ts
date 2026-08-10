import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { isOk, type GoalId, type PlainDate } from '@fitnessos/kernel'
import type { NodeId } from '@fitnessos/editor-engine'
import { plan, type Phase } from '../domain/Plan'
import { DAYS_PER_WEEK } from '../topology/temporal'
import {
  HYDRATE_COVERAGE,
  commit,
  hydrate,
  normalize,
  otherSpans,
  spanOfNode,
  type PlanSnapshot,
} from './schema'

const EPOCH: PlainDate = { year: 2026, month: 1, day: 5 }
const arbText = fc.string({ minLength: 1 }).filter((s) => s.trim() !== '')

/** Contiguous phases, so the arbitrary never generates the overlap the domain refuses. */
const arbPlan: fc.Arbitrary<PlanSnapshot> = fc
  .array(fc.record({ weeks: fc.integer({ min: 1, max: 8 }), label: arbText }), { maxLength: 5 })
  .chain((specs) =>
    fc.record({
      id: fc.constant('plan-1'),
      title: arbText,
      epoch: fc.constant(EPOCH),
      phases: fc.constant(
        specs.reduce<Phase[]>((acc, spec, i) => {
          const start = acc.reduce((total, p) => total + p.length, 0)
          acc.push({
            id: `p${String(i)}`,
            label: spec.label,
            start,
            length: spec.weeks * DAYS_PER_WEEK,
            programId: null,
            servesGoal: null,
          })
          return acc
        }, []),
      ),
    }),
  )

const phase = (over: Partial<Phase> = {}): Phase => ({
  id: 'p1',
  label: 'Accumulation',
  start: 0,
  length: 28,
  programId: null,
  servesGoal: null,
  ...over,
})

const snapshot = (phases: Phase[]): PlanSnapshot => ({
  id: 'plan-1',
  title: 'Spring',
  epoch: EPOCH,
  phases,
})

describe('the round trip', () => {
  it('commit(hydrate(x)) preserves the plan', () => {
    fc.assert(
      fc.property(arbPlan, (p) => {
        expect(normalize(commit(hydrate(p)))).toEqual(normalize(p))
      }),
      { numRuns: 200 },
    )
  })

  it('produces a plan the domain accepts', () => {
    fc.assert(
      fc.property(arbPlan, (p) => {
        expect(isOk(plan(commit(hydrate(p))))).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  it('sorts by start, so a snapshot that arrived out of sequence commits in order', () => {
    // The one normalisation, and the same shape of thing as a programme's derived block order.
    const committed = commit(
      hydrate(snapshot([phase({ id: 'late', start: 56 }), phase({ id: 'early', start: 0 })])),
    )
    expect(committed.phases.map((p) => p.id)).toEqual(['early', 'late'])
  })

  it('accounts for every field of the snapshot', () => {
    expect(Object.keys(HYDRATE_COVERAGE).sort()).toEqual(['epoch', 'id', 'phases', 'title'])
  })
})

describe('null and the empty string', () => {
  it('round-trips an absent programme and goal as null', () => {
    /**
     * Held as the empty string in props and as null everywhere else. `SetProperty` addresses a
     * key, so a prop that is sometimes absent would make "clear this field" and "never had one"
     * the same edit — and undo could not tell them apart.
     */
    const committed = commit(hydrate(snapshot([phase()])))
    expect(committed.phases[0]?.programId).toBeNull()
    expect(committed.phases[0]?.servesGoal).toBeNull()
  })

  it('round-trips a present programme and goal', () => {
    const committed = commit(
      hydrate(snapshot([phase({ programId: 'prog-1', servesGoal: 'g1' as GoalId })])),
    )
    expect(committed.phases[0]).toMatchObject({ programId: 'prog-1', servesGoal: 'g1' })
  })
})

describe('spans read from the document', () => {
  it('rounds, because half a day is not something a plan can express', () => {
    expect(spanOfNode({ start: 6.7, length: 27.4 })).toEqual({ start: 7, length: 27 })
  })

  it('falls back rather than producing NaN', () => {
    expect(spanOfNode({ start: 'nonsense' })).toEqual({ start: 0, length: 28 })
  })

  it('excludes the phase being moved, which is what a placement check needs', () => {
    // Including it would make every phase collide with itself and no move would ever be legal.
    const draft = hydrate(snapshot([phase({ id: 'a' }), phase({ id: 'b', start: 28 })]))
    expect(otherSpans(draft, 'a' as NodeId)).toEqual([{ start: 28, length: 28 }])
  })
})
