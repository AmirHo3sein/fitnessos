import { describe, expect, it } from 'vitest'
import { isErr } from '../result/index'
import {
  addDays,
  contains,
  dateRange,
  daysBetween,
  formatPlainDate,
  localDate,
  overlaps,
  plainDateKey,
  zonedInstant,
} from './index'

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`)
  return r.value
}

const TEHRAN = 'Asia/Tehran' // UTC+03:30 — the offset that breaks naive date maths

describe('zone validation', () => {
  it('rejects unknown zones', () => {
    expect(isErr(zonedInstant(0, 'Mars/Olympus_Mons'))).toBe(true)
  })
})

describe('localDate — the streak-correctness case', () => {
  it('an evening workout in Tehran lands on the local day, not the UTC day', () => {
    // 2026-03-10T21:30:00Z is 2026-03-11T01:00 in Tehran — the next local day.
    const instant = unwrap(zonedInstant(Date.UTC(2026, 2, 10, 21, 30), TEHRAN))
    expect(plainDateKey(localDate(instant))).toBe('2026-03-11')
  })

  it('the same instant in UTC lands on the previous day', () => {
    const instant = unwrap(zonedInstant(Date.UTC(2026, 2, 10, 21, 30), 'UTC'))
    expect(plainDateKey(localDate(instant))).toBe('2026-03-10')
  })

  it('an early-morning workout in Tehran stays on the local day', () => {
    // 2026-03-10T01:00:00Z is 2026-03-10T04:30 in Tehran — same local day.
    const instant = unwrap(zonedInstant(Date.UTC(2026, 2, 10, 1, 0), TEHRAN))
    expect(plainDateKey(localDate(instant))).toBe('2026-03-10')
  })
})

describe('calendar arithmetic', () => {
  it('crosses month boundaries', () => {
    expect(plainDateKey(addDays({ year: 2026, month: 1, day: 31 }, 1))).toBe('2026-02-01')
  })

  it('handles leap years', () => {
    expect(plainDateKey(addDays({ year: 2028, month: 2, day: 28 }, 1))).toBe('2028-02-29')
    expect(plainDateKey(addDays({ year: 2026, month: 2, day: 28 }, 1))).toBe('2026-03-01')
  })

  it('walks backwards for streak counting', () => {
    expect(plainDateKey(addDays({ year: 2026, month: 3, day: 1 }, -1))).toBe('2026-02-28')
  })

  it('measures day gaps', () => {
    expect(daysBetween({ year: 2026, month: 1, day: 1 }, { year: 2026, month: 1, day: 8 })).toBe(7)
    expect(daysBetween({ year: 2026, month: 1, day: 8 }, { year: 2026, month: 1, day: 1 })).toBe(-7)
  })
})

describe('DateRange — affiliation effectiveness', () => {
  const start = Date.UTC(2026, 0, 1)
  const end = Date.UTC(2026, 6, 1)

  it('rejects inverted ranges', () => {
    expect(isErr(dateRange(end, start, TEHRAN))).toBe(true)
  })

  it('is half-open: start inclusive, end exclusive', () => {
    const r = unwrap(dateRange(start, end, TEHRAN))
    expect(contains(r, start)).toBe(true)
    expect(contains(r, end)).toBe(false)
    expect(contains(r, end - 1)).toBe(true)
  })

  it('treats a null end as open-ended', () => {
    const r = unwrap(dateRange(start, null, TEHRAN))
    expect(contains(r, Date.UTC(2099, 0, 1))).toBe(true)
  })

  it('detects overlap, including against open-ended ranges', () => {
    const a = unwrap(dateRange(start, end, TEHRAN))
    const b = unwrap(dateRange(Date.UTC(2026, 3, 1), null, TEHRAN))
    const c = unwrap(dateRange(Date.UTC(2027, 0, 1), null, TEHRAN))
    expect(overlaps(a, b)).toBe(true)
    expect(overlaps(a, c)).toBe(false)
  })

  it('adjacent ranges do not overlap', () => {
    const a = unwrap(dateRange(start, end, TEHRAN))
    const b = unwrap(dateRange(end, null, TEHRAN))
    expect(overlaps(a, b)).toBe(false)
  })
})

describe('formatPlainDate', () => {
  it('renders the day it was given, not the day before', () => {
    // The bug it exists to prevent. Without `timeZone: 'UTC'` this renders as the 9th for every
    // reader west of Greenwich — invisible to whoever writes it, permanent for whoever reads it.
    expect(formatPlainDate({ year: 2026, month: 8, day: 10 }, 'en-GB')).toContain('10')
  })

  it('uses the Jalali calendar for a Persian locale', () => {
    // Not a transliteration of a Gregorian date into Persian digits — a different calendar. An
    // athlete in Tehran does not think in August.
    const out = formatPlainDate({ year: 2026, month: 8, day: 10 }, 'fa-IR')
    expect(out).toContain('مرداد')
  })

  it('accepts alternative options without losing the zone', () => {
    const out = formatPlainDate({ year: 2026, month: 8, day: 10 }, 'en-GB', { weekday: 'long' })
    expect(out).toBe('Monday')
  })
})
