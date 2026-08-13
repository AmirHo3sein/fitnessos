import { afterEach, describe, expect, it } from 'vitest'
import { todayHere } from './today'

/**
 * The instant that exposed it: `2026-08-12T21:30Z` is 01:00 on the 13th in Tehran.
 *
 * `new Date().getFullYear()` in a server component reads the NODE PROCESS's zone, so the same
 * instant produced the 12th under `TZ=UTC` and the 13th under `TZ=Asia/Dubai` — neither of them a
 * fact about the athlete. That date decides whether an indicator is flagged stale and where a new
 * plan's phases begin, so for the three and a half hours after local midnight both were a day out.
 */
const AFTER_LOCAL_MIDNIGHT = Date.parse('2026-08-12T21:30:00Z')

const withZone = (zone: string | undefined, run: () => void) => {
  const before = process.env['APP_TIME_ZONE']
  if (zone === undefined) delete process.env['APP_TIME_ZONE']
  else process.env['APP_TIME_ZONE'] = zone
  try {
    run()
  } finally {
    if (before === undefined) delete process.env['APP_TIME_ZONE']
    else process.env['APP_TIME_ZONE'] = before
  }
}

afterEach(() => {
  delete process.env['APP_TIME_ZONE']
})

describe('today, on the server', () => {
  it('is the date in the product’s zone, not the container’s', () => {
    // The assertion the old code could not make: whatever TZ this test process runs under, the
    // answer is the 13th, because Tehran is where the athlete is.
    withZone(undefined, () => {
      expect(todayHere(AFTER_LOCAL_MIDNIGHT)).toEqual({ year: 2026, month: 8, day: 13 })
    })
  })

  it('follows the configured zone when there is one', () => {
    withZone('UTC', () => {
      expect(todayHere(AFTER_LOCAL_MIDNIGHT)).toEqual({ year: 2026, month: 8, day: 12 })
    })
  })

  it('falls back rather than throwing on a mis-set variable', () => {
    // A typo in an environment variable must not render a blank page, and a date one zone out is
    // the failure this function already bounds.
    withZone('Not/AZone', () => {
      expect(todayHere(AFTER_LOCAL_MIDNIGHT)).toEqual({ year: 2026, month: 8, day: 13 })
    })
  })
})
