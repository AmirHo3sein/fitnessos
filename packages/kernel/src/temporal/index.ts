import { type Result, err, ok } from '../result/index'

/**
 * ZonedInstant — an instant plus the zone it should be interpreted in.
 *
 * The zone is part of the type because "did you train today" is a core domain
 * question, and answering it in UTC produces wrong streaks for every user not
 * on UTC. V1 computed streaks in UTC while carrying an unused timezone column;
 * this type makes that mistake unrepresentable.
 */

export type TimeZone = string // IANA identifier, e.g. 'Asia/Tehran'

export interface ZonedInstant {
  readonly epochMs: number
  readonly zone: TimeZone
}

/** A calendar date with no time component, in some zone. */
export interface PlainDate {
  readonly year: number
  readonly month: number // 1–12
  readonly day: number // 1–31
}

export type TemporalError =
  | { kind: 'invalid-instant'; epochMs: number }
  | { kind: 'invalid-zone'; zone: string }
  | { kind: 'range-inverted'; startMs: number; endMs: number }

const zoneIsValid = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

export const zonedInstant = (
  epochMs: number,
  zone: TimeZone,
): Result<ZonedInstant, TemporalError> => {
  if (!Number.isFinite(epochMs)) return err({ kind: 'invalid-instant', epochMs })
  if (!zoneIsValid(zone)) return err({ kind: 'invalid-zone', zone })
  return ok({ epochMs, zone })
}

const dateParts = (epochMs: number, zone: TimeZone): PlainDate => {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  // en-CA yields YYYY-MM-DD, which is stable to parse.
  const [year, month, day] = fmt.format(new Date(epochMs)).split('-').map(Number)
  return { year: year as number, month: month as number, day: day as number }
}

/**
 * The calendar date this instant falls on, in its own zone.
 * This is the operation streak calculation must use.
 */
export const localDate = (i: ZonedInstant): PlainDate => dateParts(i.epochMs, i.zone)

export const plainDateKey = (d: PlainDate): string =>
  `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`

export const plainDateEquals = (a: PlainDate, b: PlainDate): boolean =>
  a.year === b.year && a.month === b.month && a.day === b.day

/** Calendar-day arithmetic, zone-safe. Uses UTC internally purely as a counter. */
export const addDays = (d: PlainDate, days: number): PlainDate => {
  const t = Date.UTC(d.year, d.month - 1, d.day) + days * 86_400_000
  const shifted = new Date(t)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

export const daysBetween = (from: PlainDate, to: PlainDate): number =>
  Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) -
      Date.UTC(from.year, from.month - 1, from.day)) /
      86_400_000,
  )

// --- DateRange ---------------------------------------------------------------

/** Half-open interval [start, end). `end` absent means open-ended. */
export interface DateRange {
  readonly startMs: number
  readonly endMs: number | null
  readonly zone: TimeZone
}

export const dateRange = (
  startMs: number,
  endMs: number | null,
  zone: TimeZone,
): Result<DateRange, TemporalError> => {
  if (!zoneIsValid(zone)) return err({ kind: 'invalid-zone', zone })
  if (endMs !== null && endMs < startMs) return err({ kind: 'range-inverted', startMs, endMs })
  return ok({ startMs, endMs, zone })
}

export const contains = (r: DateRange, epochMs: number): boolean =>
  epochMs >= r.startMs && (r.endMs === null || epochMs < r.endMs)

export const isEffectiveAt = contains

export const overlaps = (a: DateRange, b: DateRange): boolean => {
  const aEnd = a.endMs ?? Number.POSITIVE_INFINITY
  const bEnd = b.endMs ?? Number.POSITIVE_INFINITY
  return a.startMs < bEnd && b.startMs < aEnd
}

/**
 * Clock port. Never call Date.now() directly in domain or application code —
 * every time-dependent rule must be testable at a fixed instant.
 */
export interface Clock {
  now(): number
}

export const systemClock: Clock = { now: () => Date.now() }
export const fixedClock = (epochMs: number): Clock => ({ now: () => epochMs })
