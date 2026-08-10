import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { PlainDate } from '@fitnessos/kernel'
import {
  DAYS_PER_WEEK,
  MIN_PHASE_DAYS,
  firstFreeStart,
  placeSpan,
  resizeSpan,
  snapToWeek,
  spanEnd,
  spansOverlap,
  toDayOffset,
  toPlainDate,
  type Span,
} from './temporal'

const span = (start: number, length = 28): Span => ({ start, length })
const EPOCH: PlainDate = { year: 2026, month: 1, day: 5 }

describe('dates and day offsets', () => {
  it('round-trips a date through an offset', () => {
    fc.assert(
      fc.property(fc.integer({ min: -400, max: 400 }), (offset) => {
        expect(toDayOffset(EPOCH, toPlainDate(EPOCH, offset))).toBe(offset)
      }),
      { numRuns: 200 },
    )
  })

  it('counts across a month and a year boundary correctly', () => {
    // Arithmetic through `addDays` rather than `Date`, so no zone can shift a boundary. Four
    // separate fixes in this codebase have come from `new Date('2026-01-05')` being UTC midnight.
    expect(toDayOffset(EPOCH, { year: 2026, month: 2, day: 5 })).toBe(31)
    expect(toDayOffset(EPOCH, { year: 2027, month: 1, day: 5 })).toBe(365)
  })

  it('handles a date before the epoch', () => {
    expect(toDayOffset(EPOCH, { year: 2025, month: 12, day: 29 })).toBe(-7)
  })
})

describe('snapping to the week', () => {
  it('is unconditional, not within a tolerance', () => {
    /**
     * Unlike the report canvas, where snapping applies within eight screen pixels. There is no
     * "close enough" here: a coach dragging a boundary is choosing which WEEK a block starts in,
     * not which Tuesday, and a plan beginning mid-week would put every session in it on a
     * different weekday than the one it was written for.
     */
    expect(snapToWeek(1)).toBe(0)
    expect(snapToWeek(3)).toBe(0)
    expect(snapToWeek(4)).toBe(DAYS_PER_WEEK)
    expect(snapToWeek(10)).toBe(DAYS_PER_WEEK)
  })

  it('always lands on a multiple of a week', () => {
    fc.assert(
      fc.property(fc.integer({ min: -200, max: 400 }), (offset) => {
        // Compared with `===` rather than `toBe`: the MODULO yields `-0` for a negative multiple,
        // and `Object.is(-0, 0)` is false. The function's own output is normalised; its remainder
        // under `%` is not something it can control.
        expect(snapToWeek(offset) % DAYS_PER_WEEK === 0).toBe(true)
      }),
      { numRuns: 300 },
    )
  })
})

describe('placing a span', () => {
  it('snaps the drop to a week boundary', () => {
    expect(placeSpan(span(0), [], 30)).toEqual({ start: 28, length: 28 })
  })

  it('REFUSES an overlap rather than displacing the occupant', () => {
    /**
     * The opposite of the grid, and deliberately. A grid pushes the occupant down because
     * vertical space is free and infinite. Time is not: there is no "below" to push a phase into,
     * and moving one to make room would silently reschedule training the athlete may already have
     * done.
     */
    expect(placeSpan(span(56), [span(0), span(28)], 28)).toBeNull()
  })

  it('allows a span that ends exactly where the next begins', () => {
    // Adjacent, not overlapping. A plan is normally contiguous, so the boundary case is the
    // common case — an off-by-one here would make every tidy plan illegal.
    expect(placeSpan(span(100, 28), [span(28, 28)], 0)).toEqual({ start: 0, length: 28 })
  })

  it('refuses a start before the epoch', () => {
    // Negative time is not a plan. The document's epoch is its beginning by construction.
    expect(placeSpan(span(28), [], -14)).toBeNull()
  })
})

describe('resizing a span', () => {
  it('moves the end and keeps the start', () => {
    expect(resizeSpan(span(0, 28), [], 56)).toEqual({ start: 0, length: 56 })
  })

  it('refuses a phase shorter than a week rather than clamping it', () => {
    /**
     * Below a week there is no full rotation of whatever pattern the phase prescribes, so it is a
     * gap with a name. Clamping to the nearest legal length looks helpful and is not: the coach
     * dragged to a specific week, and landing somewhere else without saying so is how a plan
     * acquires a phase nobody chose.
     */
    expect(resizeSpan(span(0, 28), [], 3)).toBeNull()
    expect(MIN_PHASE_DAYS).toBe(DAYS_PER_WEEK)
  })

  it('accepts exactly the minimum', () => {
    expect(resizeSpan(span(0, 28), [], DAYS_PER_WEEK)).toEqual({ start: 0, length: DAYS_PER_WEEK })
  })

  it('refuses a resize that would swallow the next phase', () => {
    expect(resizeSpan(span(0, 28), [span(28, 28)], 84)).toBeNull()
  })
})

describe('finding a free start', () => {
  it('appends after the last phase', () => {
    expect(firstFreeStart([span(0, 28), span(28, 28)], 28)).toBe(56)
  })

  it('finds a gap rather than always appending', () => {
    // A plan is not always contiguous — a coach may leave a competition window open.
    expect(firstFreeStart([span(0, 28), span(84, 28)], 28)).toBe(28)
  })

  it('starts at zero on an empty timeline', () => {
    expect(firstFreeStart([], 28)).toBe(0)
  })

  it('never returns a start that overlaps, for any arrangement', () => {
    // The property the function exists for, and the one a hand-written search gets wrong on the
    // third case.
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 40 }), { maxLength: 6 }),
        fc.integer({ min: 1, max: 8 }),
        (weeks, lengthWeeks) => {
          const others = weeks.map((w) => span(w * DAYS_PER_WEEK, DAYS_PER_WEEK))
          // Deduplicate: two phases at the same start is not a state the timeline can be in.
          const unique = others.filter(
            (s, i) => others.findIndex((o) => o.start === s.start) === i,
          )
          const length = lengthWeeks * DAYS_PER_WEEK
          const start = firstFreeStart(unique, length)

          expect(unique.some((o) => spansOverlap({ start, length }, o))).toBe(false)
          expect(start % DAYS_PER_WEEK === 0).toBe(true)
        },
      ),
      { numRuns: 300 },
    )
  })
})

describe('span arithmetic', () => {
  it('end is exclusive, so adjacent spans do not overlap', () => {
    expect(spanEnd(span(0, 28))).toBe(28)
    expect(spansOverlap(span(0, 28), span(28, 28))).toBe(false)
    expect(spansOverlap(span(0, 29), span(28, 28))).toBe(true)
  })
})
