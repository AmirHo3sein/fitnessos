import type { PlainDate } from '@fitnessos/kernel'
import { describe, expect, it } from 'vitest'
import type { IndicatorSeriesSnapshot } from '../ports/index'
import {
  STALE_AFTER_DAYS,
  indicatorSeriesView,
  indicatorSeriesViews,
} from './IndicatorSeriesView'

const on = (day: number): PlainDate => ({ year: 2026, month: 8, day })
const TODAY = on(20)

const series = (over: Partial<IndicatorSeriesSnapshot> = {}): IndicatorSeriesSnapshot => ({
  kind: 'bodyweight',
  unit: 'kg',
  movementName: null,
  points: [
    { on: on(10), value: 84 },
    { on: on(18), value: 82 },
  ],
  ...over,
})

describe('ordering', () => {
  it('sorts points ascending whatever order the wire used', () => {
    // The contract promises no order, and a chart rendered in arrival order is a chart of
    // nothing — it will look like weight going up and down at random.
    const view = indicatorSeriesView(
      series({ points: [{ on: on(18), value: 82 }, { on: on(10), value: 84 }] }),
      TODAY,
    )
    expect(view.points.map((p) => p.on.day)).toEqual([10, 18])
  })

  it('lists the most recently measured series first', () => {
    // What an athlete measured this morning is what they opened the app to see. Alphabetical
    // would bury it under whatever begins with 'b'.
    const views = indicatorSeriesViews(
      [
        series({ kind: 'old', points: [{ on: on(2), value: 1 }] }),
        series({ kind: 'fresh', points: [{ on: on(19), value: 1 }] }),
      ],
      TODAY,
    )
    expect(views.map((v) => v.kind)).toEqual(['fresh', 'old'])
  })

  it('sorts a series with no points last', () => {
    const views = indicatorSeriesViews(
      [series({ kind: 'empty', points: [] }), series({ kind: 'has-data' })],
      TODAY,
    )
    expect(views.map((v) => v.kind)).toEqual(['has-data', 'empty'])
  })
})

describe('what is derived, not stored', () => {
  it('reports the latest point and the change across the series', () => {
    const view = indicatorSeriesView(series(), TODAY)
    expect(view.latest).toEqual({ on: on(18), value: 82 })
    expect(view.change).toBe(-2)
  })

  it('gives no change for a single point', () => {
    /**
     * A single point compared with itself is a change of zero, which renders as "no progress" —
     * the opposite of the truth, which is "not enough data yet". The two must not look the same
     * to someone deciding whether their training is working.
     */
    const view = indicatorSeriesView(series({ points: [{ on: on(18), value: 82 }] }), TODAY)
    expect(view.change).toBeNull()
    expect(view.latest).not.toBeNull()
  })

  it('recomputes staleness against the date it is given', () => {
    // ADR-0006 as a test: the same snapshot is fresh or stale depending only on when it is
    // asked. A `status` on the wire would be wrong by the time the athlete opened the app.
    const snapshot = series({ points: [{ on: on(10), value: 84 }] })

    expect(indicatorSeriesView(snapshot, on(10 + STALE_AFTER_DAYS)).isStale).toBe(false)
    expect(indicatorSeriesView(snapshot, on(10 + STALE_AFTER_DAYS + 1)).isStale).toBe(true)
  })

  it('says nothing about staleness for a series with no points', () => {
    // "No measurements yet" is not "overdue". Showing a new athlete a staleness warning on their
    // first day teaches them they are already behind.
    expect(indicatorSeriesView(series({ points: [] }), TODAY).isStale).toBeNull()
  })
})

describe('the unit', () => {
  it('belongs to the series, not the point', () => {
    // A series whose unit changed partway through is not a series, it is two. Putting the unit
    // on each point makes that representable, and then a chart silently plots kg beside lb.
    const view = indicatorSeriesView(series(), TODAY)
    expect(view.unit).toBe('kg')
    expect(view.points[0]).not.toHaveProperty('unit')
  })
})
