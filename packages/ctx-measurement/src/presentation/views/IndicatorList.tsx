'use client'

import { Card, CardDescription, CardTitle } from '@fitnessos/ui'
import { formatPlainDate, type Locale, type PlainDate } from '@fitnessos/kernel'
import type { IndicatorSeriesView } from '../../application/index'
import { useIndicators } from '../hooks/useIndicators'

export interface IndicatorLabels {
  readonly title: string
  readonly none: string
  readonly noneHint: string
  readonly measuredOn: string
  readonly stale: string
  readonly notEnoughData: string
  /** Localised names for the kinds this build knows. Unknown kinds render their own key. */
  readonly kinds: Readonly<Record<string, string>>
}

export interface IndicatorListProps {
  locale: Locale
  labels: IndicatorLabels
  /** Today, passed down from the server render. See the note in `useIndicators`. */
  asOf: PlainDate
}

/**
 * What the athlete's training has actually produced.
 *
 * This is the read side of ADR-0024's cycle, and the first screen where it is visible: logging a
 * session moves an estimated 1RM here, without the athlete recording a measurement at all.
 */
export const IndicatorList = ({ locale, labels, asOf }: IndicatorListProps) => {
  const series = useIndicators(asOf)

  if (series.length === 0) {
    return (
      <Card>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>{labels.none}</CardDescription>
        <p className="text-muted mt-2 text-sm">{labels.noneHint}</p>
      </Card>
    )
  }

  return (
    <section className="space-y-3">
      <h2 className="text-display text-lg">{labels.title}</h2>
      {series.map((view) => (
        <SeriesCard key={`${view.kind}:${view.movementName ?? ''}`} view={view} locale={locale} labels={labels} />
      ))}
    </section>
  )
}

const SeriesCard = ({
  view,
  locale,
  labels,
}: {
  view: IndicatorSeriesView
  locale: Locale
  labels: IndicatorLabels
}) => {
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-primary font-medium">
          {labels.kinds[view.kind] ?? view.kind}
          {/*
            The movement name distinguishes two series of the same kind. Without it a squat and a
            deadlift estimate render as two identical cards.
          */}
          {view.movementName !== null && (
            <span className="text-muted"> · {view.movementName}</span>
          )}
        </span>

        {view.latest !== null && (
          <span className="text-primary nums shrink-0 text-lg">
            {nf.format(view.latest.value)} <span className="text-muted text-sm">{view.unit}</span>
          </span>
        )}
      </div>

      {view.latest !== null && (
        <p className="text-muted mt-1 text-xs">
          {labels.measuredOn} {formatPlainDate(view.latest.on, locale)}
          {/* Derived at render time from the date passed in, never read from the wire. */}
          {view.isStale === true && <span className="text-warning-fg"> · {labels.stale}</span>}
        </p>
      )}

      {/*
        `notEnoughData` rather than a change of zero. One point compared with itself reads as "no
        progress", which is the opposite of "we cannot tell yet" — and an athlete deciding whether
        their training works must not be told the first of those when the second is true.
      */}
      <p className="text-muted mt-2 text-sm">
        {view.change === null ? (
          labels.notEnoughData
        ) : (
          <span className="nums">
            {view.change > 0 ? '+' : ''}
            {nf.format(view.change)} {view.unit}
          </span>
        )}
      </p>
    </Card>
  )
}
