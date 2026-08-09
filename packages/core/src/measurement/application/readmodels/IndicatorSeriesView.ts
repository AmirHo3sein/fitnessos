import { daysBetween, plainDateKey, type PlainDate } from '@fitnessos/kernel'
import type { IndicatorSeriesSnapshot } from '../ports/index'

/**
 * `IndicatorSeriesView` — a series prepared for display (D-06).
 *
 * The `View` suffix is mandatory and load-bearing: it says this is a projection, computed for a
 * screen, with no invariants and no identity. It is not a domain object and must never be passed
 * to one.
 *
 * ## Everything here is computed on read
 *
 * ADR-0006. `latest`, `change` and `isStale` look like fields and are not — they are recomputed
 * every time this function runs, from the points and the date it is given. There is nowhere for
 * them to go stale, and nothing has to write them.
 *
 * The alternative, a `status` on the wire, is wrong the moment a day passes: an indicator that
 * was fresh when the response was serialised is stale by the time an athlete opens the app on
 * the train.
 */

export interface IndicatorSeriesView {
  readonly kind: string
  readonly unit: string
  readonly movementName: string | null
  /** Ascending by date, whatever order the wire used. */
  readonly points: readonly { readonly on: PlainDate; readonly value: number }[]
  /** The most recent point, or null for a series with none. */
  readonly latest: { readonly on: PlainDate; readonly value: number } | null
  /**
   * Change from the first point to the last, in the series' own unit.
   *
   * Absolute rather than a percentage: a percentage of a bodyweight and a percentage of a 1RM
   * are different claims dressed identically, and the athlete's own unit is the one they think
   * in. Null when there is nothing to compare against.
   */
  readonly change: number | null
  /**
   * Nothing recorded within the cadence. A QUERY, per ADR-0006 — hence `asOf`.
   *
   * Null when the series is empty: "no measurements yet" is not the same as "overdue", and
   * showing a new athlete a staleness warning on their first day is how a product teaches
   * someone they are already behind.
   */
  readonly isStale: boolean | null
}

/**
 * Days without a measurement before a series counts as stale.
 *
 * Matches Goal's `MIN_CADENCE_DAYS`, and for the same reason stated there: physiological
 * adaptation does not resolve faster than a week, so a shorter window produces warnings about
 * noise and teaches the athlete to ignore them.
 */
export const STALE_AFTER_DAYS = 7

export const indicatorSeriesView = (
  snapshot: IndicatorSeriesSnapshot,
  asOf: PlainDate,
): IndicatorSeriesView => {
  // Sorted HERE so the view's own order is the source of truth. The contract promises no order,
  // and a chart rendered in arrival order is a chart of nothing.
  const points = [...snapshot.points].sort((a, b) =>
    plainDateKey(a.on) < plainDateKey(b.on) ? -1 : 1,
  )

  const first = points[0] ?? null
  const latest = points[points.length - 1] ?? null

  return {
    kind: snapshot.kind,
    unit: snapshot.unit,
    movementName: snapshot.movementName,
    points,
    latest,
    // Needs two DISTINCT points. A single point compared with itself is a change of zero, which
    // reads as "no progress" rather than "not enough data" — the opposite of the truth.
    change: first !== null && latest !== null && points.length > 1 ? latest.value - first.value : null,
    isStale: latest === null ? null : daysBetween(latest.on, asOf) > STALE_AFTER_DAYS,
  }
}

/**
 * Every series, most recently measured first.
 *
 * Recency rather than alphabetical: what an athlete measured this morning is what they opened
 * the app to see, and an alphabetical list buries it under whatever begins with 'b'. Series with
 * no points sort last — they have nothing to say yet.
 */
export const indicatorSeriesViews = (
  snapshots: readonly IndicatorSeriesSnapshot[],
  asOf: PlainDate,
): readonly IndicatorSeriesView[] =>
  snapshots
    .map((snapshot) => indicatorSeriesView(snapshot, asOf))
    .sort((a, b) => {
      if (a.latest === null && b.latest === null) return 0
      if (a.latest === null) return 1
      if (b.latest === null) return -1
      return plainDateKey(a.latest.on) < plainDateKey(b.latest.on) ? 1 : -1
    })
