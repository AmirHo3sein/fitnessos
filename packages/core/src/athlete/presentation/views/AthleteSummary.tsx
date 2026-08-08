'use client'

import { Card, CardDescription, CardTitle, Skeleton } from '@fitnessos/ui'
import { toBase, type Locale } from '@fitnessos/kernel'
import { useMyAthlete } from '../hooks/useMyAthlete'

/**
 * Every field is a plain string. Not a stylistic choice — props crossing the
 * server→client boundary must be serialisable, and a function is not. A
 * `(n: string) => string` label here would compile and then fail at runtime with
 * "Functions cannot be passed directly to Client Components". Interpolation
 * belongs on the server side of the boundary, where the translator lives.
 */
export interface AthleteSummaryLabels {
  readonly title: string
  readonly experience: Readonly<Record<string, string>>
  readonly daysPerWeek: string
  readonly ceiling: string
  readonly noCeiling: string
  readonly loading: string
  readonly failed: string
}

export interface AthleteSummaryProps {
  locale: Locale
  labels: AthleteSummaryLabels
}

/**
 * A context component: calls a hook, renders the result. No business rules, no
 * knowledge of HTTP, no import of another context (handbook §3.2).
 *
 * Labels arrive as a prop rather than being read from next-intl here. That keeps
 * this package free of a routing/i18n dependency — `no-next-outside-app` would
 * block `next-intl`'s server helpers anyway, and a component that reaches for the
 * app's translation runtime cannot be rendered in a component test without
 * standing up that runtime first.
 */
export const AthleteSummary = ({ locale, labels }: AthleteSummaryProps) => {
  const { data, isPending, isError } = useMyAthlete()

  if (isPending) {
    return (
      <Card>
        <Skeleton className="h-6 w-40" label={labels.loading} />
        <Skeleton className="mt-3 h-4 w-64" label={labels.loading} />
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

  const nf = new Intl.NumberFormat(locale)
  const ceiling = data.availability.sessionCeiling

  return (
    <Card>
      <CardTitle>{labels.title}</CardTitle>
      <CardDescription>
        {labels.experience[data.trainingIdentity.experienceLevel] ??
          data.trainingIdentity.experienceLevel}
      </CardDescription>
      <dl className="mt-4 space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">{labels.daysPerWeek}</dt>
          <dd className="nums text-primary">{nf.format(data.availability.daysPerWeek)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">{labels.ceiling}</dt>
          <dd className="nums text-primary">
            {ceiling === null
              ? labels.noCeiling
              : // toBase returns seconds; the label decides the unit it names.
                // Dividing here rather than in the label keeps the arithmetic on
                // the Quantity side of the boundary, where the dimension is known.
                nf.format(Math.round(toBase(ceiling) / 60))}
          </dd>
        </div>
      </dl>
    </Card>
  )
}
