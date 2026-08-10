'use client'

import { Button, Card, CardDescription, CardTitle } from '@fitnessos/ui'
import { formatPlainDate, type Locale, type PlainDate } from '@fitnessos/kernel'
import type { SyncIssueSnapshot } from '../../application/index'
import { useSyncIssues } from '../hooks/useSyncIssues'

export interface SyncIssueLabels {
  readonly conflictTitle: string
  readonly conflictBody: string
  readonly rejectedTitle: string
  readonly rejectedBody: string
  readonly mine: string
  readonly theirs: string
  /** "{count} sets on {date}" — the only shape an athlete needs to tell two records apart. */
  readonly summary: string
  readonly unknownRecord: string
  readonly dismiss: string
}

export interface SyncIssuesProps {
  locale: Locale
  labels: SyncIssueLabels
}

/**
 * Logs that never reached the server (ADR-0033).
 *
 * ## Why this screen exists
 *
 * Offline logging promises the athlete their session is safe the moment they tap save. Two things
 * can break that promise afterwards, both while nobody is looking:
 *
 *   another device logged the same session first — two different records, and only the athlete
 *   knows which is true
 *
 *   the server refused the log, or we ran out of retries — it is not recorded anywhere
 *
 * Without this, both end as silence: the product said "saved" and then quietly did not save. That
 * is worse than an error at the time, because the athlete has no reason to look.
 *
 * ## Why nothing here resolves automatically
 *
 * A conflict cannot be resolved by the client. The server's record won by first-write-wins, and
 * the local copy describes sets a person actually performed. Choosing between them is a judgement
 * about what happened in a gym, which is the athlete's to make — so this shows both and waits.
 */
export const SyncIssues = ({ locale, labels }: SyncIssuesProps) => {
  const { issues, dismiss } = useSyncIssues()
  if (issues.length === 0) return null

  return (
    <section className="mb-6 space-y-3">
      {issues.map((issue) => (
        <IssueCard
          key={issue.id}
          issue={issue}
          locale={locale}
          labels={labels}
          onDismiss={() => {
            dismiss(issue.id)
          }}
        />
      ))}
    </section>
  )
}

const IssueCard = ({
  issue,
  locale,
  labels,
  onDismiss,
}: {
  issue: SyncIssueSnapshot
  locale: Locale
  labels: SyncIssueLabels
  onDismiss: () => void
}) => {
  const isConflict = issue.reason === 'conflict'

  return (
    <Card className="border-warning-border bg-warning-surface">
      <CardTitle>{isConflict ? labels.conflictTitle : labels.rejectedTitle}</CardTitle>
      <CardDescription>{isConflict ? labels.conflictBody : labels.rejectedBody}</CardDescription>

      <dl className="mt-4 space-y-1 text-sm">
        <Row term={labels.mine} record={issue.mine} locale={locale} labels={labels} />
        {isConflict && (
          <Row term={labels.theirs} record={issue.theirs} locale={locale} labels={labels} />
        )}
      </dl>

      <Button type="button" variant="secondary" size="sm" className="mt-4" onPress={onDismiss}>
        {labels.dismiss}
      </Button>
    </Card>
  )
}

const Row = ({
  term,
  record,
  locale,
  labels,
}: {
  term: string
  record: SyncIssueSnapshot['mine']
  locale: Locale
  labels: SyncIssueLabels
}) => (
  <div className="flex gap-2">
    <dt className="text-muted">{term}</dt>
    <dd className="text-primary">
      {/*
        An unreadable record still gets a row. Omitting it would make a conflict look one-sided —
        as if there were nothing on the other side — when the truth is that we could not read it.
      */}
      {record === null
        ? labels.unknownRecord
        : labels.summary
            .replace('{count}', new Intl.NumberFormat(locale).format(record.setCount))
            .replace('{date}', formattedDate(record.performedOn, locale, labels))}
    </dd>
  </div>
)

const formattedDate = (date: PlainDate | null, locale: Locale, labels: SyncIssueLabels): string =>
  date === null ? labels.unknownRecord : formatPlainDate(date, locale)
