'use client'

import {
  SessionLogger,
  SyncIssues,
  UpcomingSessions,
  useUpcomingSessions,
  type LoggerLabels,
  type SessionLabels,
  type SyncIssueLabels,
} from '@fitnessos/core/execution/presentation'
import { Button } from '@fitnessos/ui'
import type { Locale } from '@fitnessos/kernel'
import { useState } from 'react'

/**
 * The sessions screen: a list, and an inline logger for one session at a time.
 *
 * Inline rather than a route, because logging happens *during* a session — an athlete with a phone
 * on a bench needs the list and the form in the same place, and a navigation between sets is a
 * navigation they will get wrong with chalky hands.
 */
export const SessionsClient = ({
  locale,
  labels,
  loggerLabels,
  logCta,
  cancel,
  savedOffline,
  syncIssueLabels,
}: {
  locale: Locale
  labels: SessionLabels
  loggerLabels: LoggerLabels
  logCta: string
  cancel: string
  savedOffline: string
  syncIssueLabels: SyncIssueLabels
}) => {
  const [loggingId, setLoggingId] = useState<string | null>(null)
  const [justLogged, setJustLogged] = useState(false)
  const { data } = useUpcomingSessions()

  const active = data?.find((session) => session.id === loggingId) ?? null

  if (active !== null) {
    return (
      <div className="space-y-4">
        <SessionLogger
          session={active}
          locale={locale}
          labels={loggerLabels}
          onLogged={() => {
            setLoggingId(null)
            setJustLogged(true)
          }}
        />
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onPress={() => {
            setLoggingId(null)
          }}
        >
          {cancel}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/*
        FIRST, above the list. A log that never saved is more urgent than what is coming next, and
        an athlete who has to scroll to find out their session was lost will not find out.
      */}
      <SyncIssues locale={locale} labels={syncIssueLabels} />

      {/*
        Worded carefully: the log is DURABLE, not necessarily sent (ADR-0033). Telling an athlete
        in a basement gym that their session is on the server would be a lie, and one they would
        discover at the worst possible moment.

        `role="status"`, not `alert`: this is a confirmation, and an assertive live region would
        interrupt a screen-reader user mid-sentence for good news.
      */}
      {justLogged && (
        <p role="status" className="text-success-fg text-center text-sm">
          {savedOffline}
        </p>
      )}
      <UpcomingSessions locale={locale} labels={labels} />
      {data?.map((session) => (
        <Button
          key={session.id}
          type="button"
          size="lg"
          className="w-full"
          onPress={() => {
            setLoggingId(session.id)
          }}
        >
          {logCta}
        </Button>
      ))}
    </div>
  )
}
