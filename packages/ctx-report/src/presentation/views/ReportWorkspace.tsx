'use client'

import { Button, Card, CardDescription, CardTitle, Skeleton } from '@fitnessos/ui'
import { newEntityId, type Locale } from '@fitnessos/kernel'
import type { ReportSnapshot } from '../../editor/schema'
import { useReport } from '../hooks/useReport'
import { ReportBuilder, type ReportBuilderLabels } from './ReportBuilder'

export interface ReportWorkspaceLabels {
  readonly title: string
  readonly none: string
  readonly noneHint: string
  readonly create: string
  readonly loading: string
  readonly saveFailed: string
  readonly newReportTitle: string
  readonly builder: ReportBuilderLabels
}

export interface ReportWorkspaceProps {
  locale: Locale
  labels: ReportWorkspaceLabels
}

/**
 * Authoring the report.
 *
 * Always in the editor once one exists, like the check-in form and unlike the programme: the
 * only person who opens this is the coach who came to arrange it. A read/edit toggle would be a
 * click before every use with nobody on the other side of it.
 */
export const ReportWorkspace = ({ locale, labels }: ReportWorkspaceProps) => {
  const { report, isLoading, save, isSaving, error } = useReport()

  if (isLoading) {
    return (
      <Card>
        <Skeleton className="h-6 w-48" label={labels.loading} />
        <Skeleton className="mt-3 h-64 w-full" label={labels.loading} />
      </Card>
    )
  }

  if (report === null) {
    return (
      <Card>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>{labels.none}</CardDescription>
        <p className="text-muted mt-2 text-sm">{labels.noneHint}</p>
        <Button
          type="button"
          className="mt-4"
          onPress={() => {
            void save(startingReport(labels))
          }}
        >
          {labels.create}
        </Button>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {error !== null && (
        <Card>
          <CardDescription>{labels.saveFailed}</CardDescription>
        </Card>
      )}
      <ReportBuilder
        report={report}
        locale={locale}
        labels={labels.builder}
        onSave={save}
        isSaving={isSaving}
      />
    </div>
  )
}

/**
 * A starting report with one tile, not an empty canvas.
 *
 * Unlike a form, an empty report IS valid — the aggregate permits zero tiles, because a coach
 * clearing a canvas is a legitimate state. It is seeded anyway for a different reason: a blank
 * rectangle teaches nothing about what this tool does, and the first tile shows that a report is
 * made of references to published indicators.
 */
const startingReport = (labels: ReportWorkspaceLabels): ReportSnapshot => ({
  id: newEntityId(),
  title: labels.newReportTitle,
  tiles: [
    {
      id: newEntityId(),
      x: 40,
      y: 40,
      width: 240,
      height: 140,
      content: {
        kind: 'indicator',
        indicatorKind: 'estimated-1rm',
        fallbackLabel: labels.builder.newTileLabel,
      },
    },
  ],
})
