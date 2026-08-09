'use client'

import { useQuery } from '@tanstack/react-query'
import type { PlainDate } from '@fitnessos/kernel'
import {
  indicatorsQuery,
  indicatorSeriesViews,
  type IndicatorSeriesView,
} from '../../application/index'
import { useMeasurementPorts } from '../di'

/**
 * The athlete's derived indicators, prepared for display.
 *
 * `asOf` is a parameter rather than `new Date()` inside the hook. Staleness is derived (ADR-0006)
 * and derived means computed from inputs — a clock read in here would make the result untestable
 * and would differ between the server render and the client hydration, which is a hydration
 * mismatch that resolves in favour of whichever ran second.
 */
export const useIndicators = (asOf: PlainDate): readonly IndicatorSeriesView[] => {
  const { data } = useQuery(indicatorsQuery(useMeasurementPorts()))
  return indicatorSeriesViews(data ?? [], asOf)
}
