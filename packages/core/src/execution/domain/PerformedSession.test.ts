import {
  isErr,
  isOk,
  unwrapOrThrow,
  type PerformedSessionId,
  type PlainDate,
  type PrescribedSessionId,
} from '@fitnessos/kernel'
import { describe, expect, it } from 'vitest'
import {
  performedSession,
  performedVolumeKg,
  setsForItem,
  type PerformedSession,
  type PerformedSessionInput,
  type PerformedSet,
} from './PerformedSession'

const DATE: PlainDate = { year: 2026, month: 8, day: 10 }

const set = (over: Partial<PerformedSet> = {}): PerformedSet => ({
  id: 's1',
  prescribedItemId: 'i1',
  setNumber: 1,
  reps: 8,
  loadKg: 60,
  rpe: null,
  ...over,
})

const base: PerformedSessionInput = {
  id: 'perf-1' as PerformedSessionId,
  prescribedSessionId: 'ps-1' as PrescribedSessionId,
  performedOn: DATE,
  sets: [set()],
  note: null,
}

const make = (over: Partial<PerformedSessionInput> = {}): PerformedSession =>
  unwrapOrThrow(performedSession({ ...base, ...over }), (e) => new Error(JSON.stringify(e)))

describe('what it deliberately permits', () => {
  it('accepts FEWER sets than were prescribed', () => {
    // The most informative log in the product. An athlete who stopped at three of five is telling
    // you something, and refusing the record throws the signal away to protect a symmetry nobody
    // asked for.
    expect(isOk(performedSession({ ...base, sets: [set()] }))).toBe(true)
  })

  it('accepts MORE sets than were prescribed', () => {
    const sets = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => set({ id: `s${String(n)}`, setNumber: n }))
    expect(isOk(performedSession({ ...base, sets }))).toBe(true)
  })

  it('accepts a performedOn different from the prescription', () => {
    // Monday's session done on Tuesday is a completed session, not an error.
    const later = make({ performedOn: { year: 2026, month: 8, day: 14 } })
    expect(later.performedOn.day).toBe(14)
  })

  it('accepts SKIPPED set numbers', () => {
    // An athlete who logged sets 1, 2 and 5 has done three sets. Numbers may skip; they may not
    // collide.
    const sets = [1, 2, 5].map((n) => set({ id: `s${String(n)}`, setNumber: n }))
    expect(isOk(performedSession({ ...base, sets }))).toBe(true)
  })

  it('accepts bodyweight sets', () => {
    expect(isOk(performedSession({ ...base, sets: [set({ loadKg: null })] }))).toBe(true)
  })
})

describe('internal coherence', () => {
  it('rejects a session with no sets', () => {
    // Not "the session went badly" — a form opened and closed.
    const result = performedSession({ ...base, sets: [] })
    expect(isErr(result) && result.error.kind).toBe('no-sets')
  })

  it('rejects duplicate set numbers within one movement', () => {
    // A double-submit, not a real record.
    const result = performedSession({
      ...base,
      sets: [set({ id: 'a', setNumber: 3 }), set({ id: 'b', setNumber: 3 })],
    })
    expect(isErr(result) && result.error.kind).toBe('duplicate-set')
  })

  it('allows the same set number across DIFFERENT movements', () => {
    // Set 1 of squats and set 1 of presses are different sets.
    const result = performedSession({
      ...base,
      sets: [set({ id: 'a', prescribedItemId: 'i1' }), set({ id: 'b', prescribedItemId: 'i2' })],
    })
    expect(isOk(result)).toBe(true)
  })

  it('rejects non-positive or fractional reps', () => {
    expect(isErr(performedSession({ ...base, sets: [set({ reps: 0 })] }))).toBe(true)
    expect(isErr(performedSession({ ...base, sets: [set({ reps: 8.5 })] }))).toBe(true)
  })

  it('rejects a zero load rather than treating it as bodyweight', () => {
    const result = performedSession({ ...base, sets: [set({ loadKg: 0 })] })
    expect(isErr(result) && result.error.kind).toBe('load-not-positive')
  })

  it('accepts RPE in halves and rejects anything finer', () => {
    // RPE is a 1–10 scale recorded in halves. 7.25 is not a value anyone means.
    expect(isOk(performedSession({ ...base, sets: [set({ rpe: 7.5 })] }))).toBe(true)
    expect(isErr(performedSession({ ...base, sets: [set({ rpe: 7.25 })] }))).toBe(true)
    expect(isErr(performedSession({ ...base, sets: [set({ rpe: 11 })] }))).toBe(true)
    expect(isErr(performedSession({ ...base, sets: [set({ rpe: 0 })] }))).toBe(true)
  })

  it('normalises a blank note to null', () => {
    expect(make({ note: '   ' }).note).toBeNull()
    expect(make({ note: '  felt strong  ' }).note).toBe('felt strong')
  })
})

describe('derived values', () => {
  it('computes volume from load and reps', () => {
    const session = make({
      sets: [set({ id: 'a', setNumber: 1, reps: 5, loadKg: 100 }), set({ id: 'b', setNumber: 2, reps: 5, loadKg: 100 })],
    })
    expect(performedVolumeKg(session)).toBe(1000)
  })

  it('counts bodyweight work as zero load without dropping the set', () => {
    const session = make({ sets: [set({ loadKg: null })] })
    expect(performedVolumeKg(session)).toBe(0)
    expect(session.sets).toHaveLength(1)
  })

  it('is not stored', () => {
    expect(Object.keys(make())).not.toContain('performedVolumeKg')
  })

  it('groups sets by prescribed item', () => {
    const session = make({
      sets: [
        set({ id: 'a', prescribedItemId: 'i1', setNumber: 1 }),
        set({ id: 'b', prescribedItemId: 'i2', setNumber: 1 }),
        set({ id: 'c', prescribedItemId: 'i1', setNumber: 2 }),
      ],
    })
    expect(setsForItem(session, 'i1').map((s) => s.id)).toEqual(['a', 'c'])
  })

  it('freezes the set list', () => {
    expect(Object.isFrozen(make().sets)).toBe(true)
  })
})
