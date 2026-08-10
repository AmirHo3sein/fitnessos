'use client'

import { Button, Card, CardDescription, CardTitle, Skeleton } from '@fitnessos/ui'
import { newEntityId, type Locale } from '@fitnessos/kernel'
import type { DashboardSnapshot } from '../../editor/schema'
import { useDashboard } from '../hooks/useDashboard'
import { DashboardBuilder, type DashboardBuilderLabels } from './DashboardBuilder'

export interface DashboardWorkspaceLabels {
  readonly title: string
  readonly none: string
  readonly noneHint: string
  readonly create: string
  readonly loading: string
  /**
   * Shown when the LOAD failed, and never shown alongside the create button.
   *
   * A separate string from `saveFailed` on purpose: "we could not read your plan" and "we could not
   * store your change" call for different actions, and one message covering both tells the reader
   * neither.
   */
  readonly loadFailed: string
  readonly retry: string
  readonly saveFailed: string
  readonly newTitle: string
  readonly builder: DashboardBuilderLabels
}

export interface DashboardWorkspaceProps {
  locale: Locale
  labels: DashboardWorkspaceLabels
}

/** Arranging the dashboard. Always in the editor once one exists — only its author opens this. */
export const DashboardWorkspace = ({ locale, labels }: DashboardWorkspaceProps) => {
  const { dashboard, isLoading, save, isSaving, error, loadFailed, retry } = useDashboard()

  if (isLoading) {
    return (
      <Card>
        <Skeleton className="h-6 w-48" label={labels.loading} />
        <Skeleton className="mt-3 h-64 w-full" label={labels.loading} />
      </Card>
    )
  }

  /*
    The load failed. Reported BEFORE the empty state, because both used to look identical from here
    and the empty state carries a create button — which, pressed after a failed load, PUT a new id
    over an artefact that was only unreachable. A failed read must never offer to replace what it
    could not read.
  */
  if (loadFailed) {
    return (
      <Card>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>{labels.loadFailed}</CardDescription>
        <Button type="button" variant="secondary" className="mt-4" onPress={retry}>
          {labels.retry}
        </Button>
      </Card>
    )
  }

  if (dashboard === null) {
    return (
      <Card>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>{labels.none}</CardDescription>
        <p className="text-muted mt-2 text-sm">{labels.noneHint}</p>
        <Button
          type="button"
          className="mt-4"
          onPress={() => {
            void save(startingDashboard(labels))
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
      <DashboardBuilder
        dashboard={dashboard}
        locale={locale}
        labels={labels.builder}
        onSave={save}
        isSaving={isSaving}
      />
    </div>
  )
}

/**
 * Twelve columns, and two widgets that show what a dashboard is made of.
 *
 * Twelve because it divides by two, three, four and six, so a layout can be halved or thirded
 * without a remainder — which is the whole reason twelve is the number every grid system picked.
 */
const startingDashboard = (labels: DashboardWorkspaceLabels): DashboardSnapshot => ({
  id: newEntityId(),
  title: labels.newTitle,
  columns: 12,
  widgets: [
    {
      id: newEntityId(),
      x: 0,
      y: 0,
      width: 6,
      height: 2,
      content: {
        kind: 'indicator',
        indicatorKind: 'estimated-1rm',
        fallbackLabel: labels.builder.newWidgetLabel,
      },
    },
    { id: newEntityId(), x: 6, y: 0, width: 6, height: 2, content: { kind: 'upcoming-sessions' } },
  ],
})
