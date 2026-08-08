'use client'

import { ProgramView, type ProgramLabels } from '@fitnessos/core/prescription/presentation'
import type { Locale } from '@fitnessos/kernel'

export const ProgrammeClient = ({
  locale,
  labels,
}: {
  locale: Locale
  labels: ProgramLabels
}) => <ProgramView locale={locale} labels={labels} />
