'use client'

import { Button, Card, CardDescription, CardTitle, Skeleton } from '@fitnessos/ui'
import { newEntityId, type Locale } from '@fitnessos/kernel'
import { useState } from 'react'
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
  /**
   * The conflict dialog — the same four words the Program Builder uses, deliberately.
   *
   * One vocabulary across the editors: an author who has met "this was changed elsewhere" on their
   * programme must not have to learn a second set of words, and a second set is how two mechanisms
   * for one situation start.
   */
  readonly conflictTitle: string
  readonly conflictBody: string
  /** Keep the local arrangement and save it over the other author's. */
  readonly conflictKeep: string
  /** Discard the local arrangement and take the saved one. */
  readonly conflictDiscard: string
  /**
   * Put the dialog away and decide later.
   *
   * A fifth word the programme has no need of: there, "keep" IS the dismissal because it changes
   * nothing. Here "keep" writes to the server, so leaving without choosing needs its own control.
   */
  readonly conflictDismiss: string
  readonly newTitle: string
  readonly builder: DashboardBuilderLabels
}

export interface DashboardWorkspaceProps {
  locale: Locale
  labels: DashboardWorkspaceLabels
}

/** Arranging the dashboard. Always in the editor once one exists — only its author opens this. */
export const DashboardWorkspace = ({ locale, labels }: DashboardWorkspaceProps) => {
  const {
    dashboard,
    isLoading,
    save,
    isSaving,
    error,
    loadFailed,
    retry,
    conflict,
    keepMine,
    takeTheirs,
    reset,
  } = useDashboard()
  /*
   * How many times the author has taken the other version — a remount counter, not a fact about the
   * dashboard.
   *
   * The builder hydrates its editor store ONCE per `dashboard.id`, so that a refetch returning an
   * equal-but-new object cannot discard edits in progress. Adoption is the one case where a new
   * document arrives under the SAME id, so without a changing key the grid would keep showing the
   * arrangement the author just chose to abandon. Bumping this remounts the builder, which is also
   * what correctly throws away the undo history belonging to the discarded document.
   */
  const [adoptions, setAdoptions] = useState(0)

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
      <Card role="alert">
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
      {/*
        The resolution, not a banner. A conflict is the one failure where telling the author what
        happened is not enough: two arrangements exist and only they can say which one the athlete
        should open tomorrow, so the choice has to be offered here.

        Both options preserve something and neither is destructive by default (ADR-0033). "Keep" sends
        the refused layout again on the revision the server just quoted — the author's work survives a
        collision it did nothing to cause. "Discard" takes the other arrangement instead. Leaving
        without choosing is a third, honest answer, and the grid is still there behind this card.
      */}
      {conflict !== null && (
        <Card role="alert">
          <CardTitle>{labels.conflictTitle}</CardTitle>
          <CardDescription>{labels.conflictBody}</CardDescription>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              isDisabled={isSaving}
              onPress={() => {
                void keepMine()
              }}
            >
              {labels.conflictKeep}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onPress={() => {
                takeTheirs()
                setAdoptions((n) => n + 1)
              }}
            >
              {labels.conflictDiscard}
            </Button>
            <Button type="button" variant="ghost" size="sm" onPress={reset}>
              {labels.conflictDismiss}
            </Button>
          </div>
        </Card>
      )}

      {/*
        Narrowed back to `error` alone now that a conflict has somewhere better to go. A collided save
        is not "we could not store your change" — nothing broke, and the sentence would sit beside a
        card that says the opposite.
      */}
      {error !== null && (
        <Card role="alert">
          <CardDescription>{labels.saveFailed}</CardDescription>
        </Card>
      )}
      <DashboardBuilder
        key={`${dashboard.id}:${String(adoptions)}`}
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
