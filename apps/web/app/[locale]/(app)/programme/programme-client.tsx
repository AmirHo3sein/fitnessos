'use client'

import { ProgramWorkspace, type WorkspaceLabels } from '@fitnessos/ctx-prescription/presentation'
import type { Locale } from '@fitnessos/kernel'

export const ProgrammeClient = ({
  locale,
  labels,
}: {
  locale: Locale
  labels: WorkspaceLabels
}) => <ProgramWorkspace locale={locale} labels={labels} />
