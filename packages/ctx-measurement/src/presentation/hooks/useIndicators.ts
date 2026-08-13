'use client'

import { useSubject } from '@fitnessos/ui'
import { useQuery } from '@tanstack/react-query'
import type { PlainDate } from '@fitnessos/kernel'
import {
  indicatorsQuery,
  indicatorSeriesViews,
  type IndicatorSeriesView,
} from '../../application/index'
import { useMeasurementPorts } from '../di'

export interface UseIndicators {
  readonly series: readonly IndicatorSeriesView[]
  readonly isLoading: boolean
  /**
   * The READ failed — distinct from "nothing measured yet", and that distinction is the whole
   * reason this field exists.
   *
   * `data ?? []` collapsed the two. A 401, a dropped request and a genuinely empty account all
   * reached the view as an empty array, and the view answered with "nothing here yet" beside a
   * hint about logging a session. An athlete whose indicators merely failed to load was told their
   * training has produced nothing — §4.9's failure class, on the read side.
   */
  readonly loadFailed: boolean
  /** Refetch, so the answer to a failed read is one press rather than a full reload. */
  readonly retry: () => void
}

/**
 * The athlete's derived indicators, prepared for display.
 *
 * `asOf` is a parameter rather than `new Date()` inside the hook. Staleness is derived (ADR-0006)
 * and derived means computed from inputs — a clock read in here would make the result untestable
 * and would differ between the server render and the client hydration, which is a hydration
 * mismatch that resolves in favour of whichever ran second.
 */
export const useIndicators = (asOf: PlainDate): UseIndicators => {
  const query = useQuery(indicatorsQuery(useMeasurementPorts(), useSubject()))

  return {
    series: indicatorSeriesViews(query.data ?? [], asOf),
    isLoading: query.isPending,
    loadFailed: query.isError,
    retry: () => {
      void query.refetch()
    },
  }
}
