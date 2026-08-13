import { isErr, localDate, zonedInstant, type PlainDate } from '@fitnessos/kernel'

/**
 * The product's calendar zone, for dates resolved on the SERVER.
 *
 * ## What this replaces, and why it was wrong
 *
 * Two server components computed today as `new Date().getFullYear()` and friends. Those read the
 * NODE PROCESS's local zone — the container's, never the athlete's — so the same instant produced
 * two different dates depending on how the image happened to be configured:
 *
 *   TZ=UTC          → 2026-08-12
 *   TZ=Asia/Dubai   → 2026-08-13
 *
 * measured at `2026-08-12T21:30Z`, which is 01:00 in Tehran, where the date is the 13th. That date
 * decides whether an indicator is flagged stale and where a new plan's phases begin, so for the
 * three and a half hours after local midnight both were a day out — silently, and for everyone.
 *
 * The kernel already ships `localDate(zonedInstant(...))` for exactly this, and calls the
 * `new Date()` form out as a V1 bug it exists to make unrepresentable. It was reachable anyway,
 * because these two call sites never went near the kernel.
 *
 * ## Why a configured zone rather than the athlete's own
 *
 * Nothing stores an athlete's zone. The client resolves its own from
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` when it logs a session, and a server render
 * cannot see that — the request carries no zone, and inventing a cookie for one is a product
 * decision, not a bug fix.
 *
 * So this is deployment configuration with a declared default, which is both correct for a product
 * shipped in one country and honest about what it is. Per-athlete zones remain an open decision;
 * when they are decided, this is the one place a server render reads a zone from.
 */
const DEFAULT_ZONE = 'Asia/Tehran'

/**
 * Today, in the product's zone.
 *
 * Falls back to the default rather than throwing on a mis-set variable: a typo in an environment
 * variable must not take a page down, and a date one zone out is the failure this function already
 * bounds.
 */
export const todayHere = (now: number = Date.now()): PlainDate => {
  const configured = process.env['APP_TIME_ZONE']
  const instant = zonedInstant(now, configured ?? DEFAULT_ZONE)
  if (isErr(instant)) {
    const fallback = zonedInstant(now, DEFAULT_ZONE)
    // The default is a literal this file owns, so the second call cannot fail — but `isErr` is
    // still checked rather than asserted away, because a throw here would be a blank page.
    if (isErr(fallback)) return { year: 1970, month: 1, day: 1 }
    return localDate(fallback.value)
  }
  return localDate(instant.value)
}
