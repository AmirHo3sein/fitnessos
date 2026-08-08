'use client'

import { UpcomingSessions, type SessionLabels } from '@fitnessos/core/execution/presentation'
import type { Locale } from '@fitnessos/kernel'

export const SessionsClient = ({
  locale,
  labels,
}: {
  locale: Locale
  labels: SessionLabels
}) => <UpcomingSessions locale={locale} labels={labels} />
