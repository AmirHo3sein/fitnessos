import { addDays, plainDateKey, type PlainDate } from '@fitnessos/kernel'

/**
 * `topology/temporal` — owned HERE, not by the engine.
 *
 * D-12 says so explicitly, and the reason is worth stating because it is the same reason
 * `topology/graph` was deleted from the engine for the Workflow Builder: this is not generic
 * geometry, it is domain knowledge wearing coordinates.
 *
 * Grid collision resolution belongs in the engine because "two things cannot occupy one cell" is
 * true of any grid anywhere. Nothing below is like that. Snapping to Monday, refusing a phase
 * shorter than a week, and treating overlap as impossible rather than merely ugly are all facts
 * about how training is organised. An engine that knew them would be an engine that had opinions
 * about periodisation.
 *
 * ## Document units are days, not milliseconds
 *
 * D-04 says milliseconds for Timeline, and this deviates. Milliseconds are the right unit for a
 * timeline of EVENTS — a video editor, a trace viewer, anything where two things can happen
 * within a second of each other. A training plan is not that: its smallest meaningful unit is a
 * day, and its natural unit is a week.
 *
 * Using milliseconds would mean every coordinate carried nine digits of precision the domain
 * cannot use, every comparison risked a phase that started at 00:00:00.001, and the arithmetic
 * would run through `Date` — which parses a plain date as UTC midnight and shifts it a day west
 * of Greenwich, a bug this codebase has already fixed four times.
 *
 * So: **days since an epoch date**, integers, with `PlainDate` at the boundary. Recorded as a
 * deviation rather than done quietly, because the handbook is the contract.
 */

/** Days are integers; a fractional day is not a thing a plan can express. */
export type DayOffset = number

/** Training is organised in weeks. Every snap and every minimum below is a multiple of this. */
export const DAYS_PER_WEEK = 7

/**
 * The shortest span that is a phase.
 *
 * Below a week there is no training week in it — no full rotation of whatever pattern the phase
 * prescribes — so it is a gap with a name rather than a phase. The builder refuses to create one
 * rather than accepting it and letting the aggregate reject the save.
 */
export const MIN_PHASE_DAYS = DAYS_PER_WEEK

/** A span on the timeline, in day offsets from the document's epoch. */
export interface Span {
  readonly start: DayOffset
  /** In days, always at least `MIN_PHASE_DAYS`. Exclusive of the end day. */
  readonly length: number
}

export const spanEnd = (span: Span): DayOffset => span.start + span.length

export const spansOverlap = (a: Span, b: Span): boolean =>
  a.start < spanEnd(b) && b.start < spanEnd(a)

/**
 * Convert a calendar date to a day offset, and back.
 *
 * Through `addDays` and `plainDateKey` from the kernel rather than through `Date`: a plain date
 * parsed by `Date` becomes UTC midnight, which renders and compares as the previous day for
 * anyone west of Greenwich. That has been the cause of four separate fixes in this codebase, and
 * the timeline is where it would do the most damage — every phase boundary shifted by one day,
 * for some athletes and not others.
 */
export const toDayOffset = (epoch: PlainDate, date: PlainDate): DayOffset => {
  let offset = 0
  let cursor = epoch
  const target = plainDateKey(date)

  if (plainDateKey(cursor) > target) {
    while (plainDateKey(cursor) > target) {
      cursor = addDays(cursor, -1)
      offset -= 1
    }
    return offset
  }
  while (plainDateKey(cursor) < target) {
    cursor = addDays(cursor, 1)
    offset += 1
  }
  return offset
}

export const toPlainDate = (epoch: PlainDate, offset: DayOffset): PlainDate =>
  addDays(epoch, Math.round(offset))

/**
 * Snap a day offset to the nearest week boundary.
 *
 * To a WEEK, not a day, and that is the whole reason this function exists. A coach dragging a
 * phase boundary is choosing which week a block starts in, not which Tuesday — a plan that began
 * mid-week would put every session in it on a different weekday than the one it was written for.
 *
 * Snapping is unconditional rather than within a tolerance, unlike the report canvas. There is no
 * "close enough" here: a day offset either is a week boundary or is a mistake, and offering the
 * in-between positions would mean offering six wrong answers for every right one.
 */
export const snapToWeek = (offset: DayOffset): DayOffset =>
  // `+ 0` normalises negative zero. `Math.round(-1 / 7) * 7` is `-0`, which compares unequal to
  // `0` under `Object.is` and would make two identical day offsets distinguishable.
  Math.round(offset / DAYS_PER_WEEK) * DAYS_PER_WEEK + 0

/**
 * The next week boundary at or after an offset.
 *
 * Distinct from `snapToWeek`, which rounds to the NEAREST — and the difference is a bug that
 * already happened: `firstFreeStart` jumped past a blocking span by nudging its end and snapping,
 * which rounded back down onto the span it was escaping, so the search skipped the legal slot
 * immediately after and returned the one after that.
 */
export const ceilToWeek = (offset: DayOffset): DayOffset =>
  Math.ceil(offset / DAYS_PER_WEEK) * DAYS_PER_WEEK + 0

/**
 * Where a span can be moved to, given everything else on the timeline.
 *
 * Returns the snapped span if it fits, or `null` if it would overlap. **Refusal, not
 * displacement** — the opposite of the grid, and deliberately.
 *
 * A grid pushes the occupant down because vertical space is free and infinite. Time is not: there
 * is no "below" to push a phase into, and moving one to make room would silently reschedule
 * training an athlete may already have done. So a drop that would overlap is refused, and the
 * builder puts the phase back where it was.
 */
export const placeSpan = (
  span: Span,
  others: readonly Span[],
  proposedStart: DayOffset,
): Span | null => {
  const snapped: Span = { start: snapToWeek(proposedStart), length: span.length }
  if (snapped.start < 0) return null
  if (others.some((other) => spansOverlap(snapped, other))) return null
  return snapped
}

/**
 * Resize by moving the END, keeping the start fixed.
 *
 * Refuses rather than clamps when the result would be too short or would collide. Clamping a
 * resize to the nearest legal length looks helpful and is not: the coach dragged to a specific
 * week, and landing somewhere else without saying so is how a plan acquires a phase nobody chose.
 */
export const resizeSpan = (
  span: Span,
  others: readonly Span[],
  proposedEnd: DayOffset,
): Span | null => {
  const length = snapToWeek(proposedEnd) - span.start
  if (length < MIN_PHASE_DAYS) return null

  const resized: Span = { start: span.start, length }
  if (others.some((other) => spansOverlap(resized, other))) return null
  return resized
}

/**
 * The first week boundary at or after `after` where a span of `length` days fits.
 *
 * Used when adding a phase: appending at the end is what a coach means by "add a phase", and
 * searching forward from there is how it finds the first gap if the timeline is not contiguous.
 */
export const firstFreeStart = (
  others: readonly Span[],
  length: number,
  after: DayOffset = 0,
): DayOffset => {
  let start = ceilToWeek(Math.max(0, after))
  // Bounded by the number of spans: each iteration clears at least one, because it jumps to that
  // span's end. So this terminates without a guard on the loop count.
  let blocking = others.find((other) => spansOverlap({ start, length }, other))
  while (blocking !== undefined) {
    start = ceilToWeek(spanEnd(blocking))
    blocking = others.find((other) => spansOverlap({ start, length }, other))
  }
  return start
}
