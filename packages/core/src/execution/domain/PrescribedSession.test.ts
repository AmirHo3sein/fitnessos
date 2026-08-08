import {
  isErr,
  isOk,
  unwrapOrThrow,
  type PlainDate,
  type PrescribedSessionId,
  type ProgramVersionId,
} from '@fitnessos/kernel'
import { describe, expect, it } from 'vitest'
import { isAttemptable, type ScreeningVerdict } from './ScreeningVerdict'
import {
  prescribedSession,
  totalVolumeKg,
  type PrescribedItem,
  type PrescribedSession,
  type PrescribedSessionInput,
} from './PrescribedSession'

const CLEAR: ScreeningVerdict = { level: 'clear', basis: null, basisWithheld: false }
const DATE: PlainDate = { year: 2026, month: 8, day: 10 }

const item = (id: string, order: number, over: Partial<PrescribedItem> = {}): PrescribedItem => ({
  id,
  movementName: `Movement ${id}`,
  order,
  sets: 3,
  reps: 8,
  loadKg: 60,
  ...over,
})

const base: PrescribedSessionInput = {
  id: 'ps-1' as PrescribedSessionId,
  programVersionId: 'pv-1' as ProgramVersionId,
  scheduledFor: DATE,
  items: [item('i1', 0), item('i2', 1)],
  screening: CLEAR,
}

const make = (over: Partial<PrescribedSessionInput> = {}): PrescribedSession =>
  unwrapOrThrow(prescribedSession({ ...base, ...over }), (e) => new Error(JSON.stringify(e)))

describe('ADR-0021 — cannot exist without a screening verdict', () => {
  it('requires screening as a constructor argument, not an optional field', () => {
    // Not "should have one" — cannot be constructed. Typed as required, so omitting it does
    // not compile; this asserts the runtime half.
    expect(isOk(prescribedSession(base))).toBe(true)
    expect(Object.keys(make())).toContain('screening')
  })

  it('refuses a blocked verdict outright', () => {
    const result = prescribedSession({
      ...base,
      screening: { level: 'blocked', basis: 'shoulder impingement', basisWithheld: false },
    })
    expect(isErr(result) && result.error.kind).toBe('blocked-by-screening')
  })

  it('reports the block BEFORE any structural problem', () => {
    // A blocked session with malformed items must report the block. Reporting "sets must be
    // positive" for a session the athlete must not attempt at all buries the only fact worth
    // acting on.
    const result = prescribedSession({
      ...base,
      items: [item('i1', 0, { sets: 0 })],
      screening: { level: 'blocked', basis: null, basisWithheld: true },
    })
    expect(isErr(result) && result.error.kind).toBe('blocked-by-screening')
  })

  it('carries basisWithheld through the error', () => {
    // So the UI can distinguish "blocked, and here is why" from "blocked, and you are not
    // entitled to the reason" (ADR-0002/0014). Both are `basis: null` and they are completely
    // different statements to an athlete.
    const result = prescribedSession({
      ...base,
      screening: { level: 'blocked', basis: null, basisWithheld: true },
    })
    expect(isErr(result) && result.error.kind === 'blocked-by-screening' && result.error.basisWithheld)
      .toBe(true)
  })

  it('allows a modified verdict — modified is attemptable', () => {
    const modified: ScreeningVerdict = { level: 'modified', basis: 'reduce range', basisWithheld: false }
    expect(isOk(prescribedSession({ ...base, screening: modified }))).toBe(true)
    expect(isAttemptable(modified)).toBe(true)
  })
})

describe('resolved dose (ADR-0013)', () => {
  it('carries concrete numbers, not a progression rule', () => {
    // By the time a session exists, "how much?" has been answered and recorded. That is what
    // makes a PerformedSession comparable to it later.
    const session = make()
    expect(session.items[0]!.sets).toBe(3)
    expect(session.items[0]!.reps).toBe(8)
    expect(Object.keys(session.items[0]!)).not.toContain('progressionIntent')
  })

  it('accepts a null load for bodyweight work', () => {
    expect(isOk(prescribedSession({ ...base, items: [item('i1', 0, { loadKg: null })] }))).toBe(true)
  })

  it('rejects a zero load, which is what an unresolved progression writes', () => {
    // Zero is not "bodyweight". It reads as a mistake to the athlete and as a valid number to
    // anything computing volume.
    const result = prescribedSession({ ...base, items: [item('i1', 0, { loadKg: 0 })] })
    expect(isErr(result) && result.error.kind).toBe('load-not-positive')
  })

  it('rejects non-positive or fractional sets and reps', () => {
    expect(isErr(prescribedSession({ ...base, items: [item('i1', 0, { sets: 0 })] }))).toBe(true)
    expect(isErr(prescribedSession({ ...base, items: [item('i1', 0, { reps: 2.5 })] }))).toBe(true)
  })
})

describe('items', () => {
  it('rejects an empty session', () => {
    expect(isErr(prescribedSession({ ...base, items: [] }))).toBe(true)
  })

  it('rejects a gap or duplicate in item order', () => {
    expect(isErr(prescribedSession({ ...base, items: [item('a', 0), item('b', 2)] }))).toBe(true)
    expect(isErr(prescribedSession({ ...base, items: [item('a', 0), item('b', 0)] }))).toBe(true)
  })

  it('sorts and freezes', () => {
    const session = make({ items: [item('b', 1), item('a', 0)] })
    expect(session.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(Object.isFrozen(session.items)).toBe(true)
  })
})

describe('totalVolumeKg — derived', () => {
  it('multiplies load by sets and reps', () => {
    expect(totalVolumeKg(make({ items: [item('a', 0, { sets: 3, reps: 10, loadKg: 50 })] })))
      .toBe(1500)
  })

  it('counts bodyweight work as zero load rather than skipping the item', () => {
    // Zero contribution to a LOAD total is correct; the item still happened. Filtering it out
    // would be indistinguishable here and wrong the moment a count of items is added.
    expect(totalVolumeKg(make({ items: [item('a', 0, { loadKg: null })] }))).toBe(0)
  })

  it('is not a stored field', () => {
    expect(Object.keys(make())).not.toContain('totalVolumeKg')
  })
})
