'use client'

import { Card, CardDescription, CardTitle, Skeleton } from '@fitnessos/ui'
import { plainDateKey, type Locale } from '@fitnessos/kernel'
import { useUpcomingSessions } from '../hooks/useUpcomingSessions'

export interface SessionLabels {
  readonly title: string
  readonly none: string
  readonly noneHint: string
  readonly setsReps: string
  readonly bodyweight: string
  readonly screening: Readonly<Record<string, string>>
  readonly basisWithheld: string
  readonly loading: string
  readonly failed: string
}

export interface UpcomingSessionsProps {
  locale: Locale
  labels: SessionLabels
}

export const UpcomingSessions = ({ locale, labels }: UpcomingSessionsProps) => {
  const { data, isPending, isError } = useUpcomingSessions()

  if (isPending) {
    return (
      <Card>
        <Skeleton className="h-6 w-40" label={labels.loading} />
        <Skeleton className="mt-3 h-20 w-full" label={labels.loading} />
      </Card>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>{labels.failed}</CardDescription>
      </Card>
    )
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>{labels.none}</CardDescription>
        <p className="text-faint mt-2 text-sm">{labels.noneHint}</p>
      </Card>
    )
  }

  const nf = new Intl.NumberFormat(locale)
  /*
   * A Persian user sees Persian dates. `Intl.DateTimeFormat('fa')` selects the Persian
   * (Jalali) calendar by default, which is not a cosmetic difference — 1405/05/19 and
   * 2026-08-10 are the same day, and showing a Gregorian date to an Iranian athlete is showing
   * them a date they have to convert in their head.
   *
   * Constructed from the PlainDate's components in UTC, deliberately. The value is a calendar
   * fact with no time and no zone; letting the runtime interpret it in local time is how the
   * 10th becomes the 9th for anyone west of Greenwich.
   */
  const df = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    timeZone: 'UTC',
  })

  return (
    <div className="space-y-4">
      {data.map((session) => (
        <Card key={session.id}>
          <CardTitle>
            {df.format(Date.UTC(session.scheduledFor.year, session.scheduledFor.month - 1, session.scheduledFor.day))}
          </CardTitle>

          {/*
            A `modified` verdict is shown, never hidden. The athlete is about to attempt this,
            and "your coach reduced the range" is information they need before they start, not
            after.
          */}
          {session.screening.level === 'modified' && (
            <CardDescription>
              {labels.screening['modified']}
              {session.screening.basis !== null && ` — ${session.screening.basis}`}
              {/*
                `basisWithheld` is a DIFFERENT statement from "no reason given" (ADR-0002 /
                ADR-0014). Saying nothing here would imply the modification is unexplained,
                when in fact it is explained and the viewer is not entitled to the explanation.
              */}
              {session.screening.basis === null && session.screening.basisWithheld && (
                <span className="text-faint"> — {labels.basisWithheld}</span>
              )}
            </CardDescription>
          )}

          <ol className="mt-4 space-y-2">
            {session.items.map((item) => (
              <li
                key={item.id}
                className="border-line flex items-baseline justify-between gap-3 border-b pb-2 last:border-0"
              >
                <span className="text-fg text-sm">{item.movementName}</span>
                <span className="text-muted shrink-0 text-xs">
                  <span className="nums">
                    {nf.format(item.sets)}×{nf.format(item.reps)}
                  </span>
                  {item.loadKg === null ? (
                    <span> · {labels.bodyweight}</span>
                  ) : (
                    <span>
                      {' · '}
                      <span className="nums">{nf.format(item.loadKg)}</span> kg
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      ))}
    </div>
  )
}

/** Stable key for a scheduled date, for grouping. Re-exported so callers need not import kernel. */
export const sessionDateKey = plainDateKey
