'use client'

import { Button, Card, CardDescription, CardTitle, Skeleton } from '@fitnessos/ui'
import { newEntityId, type Locale } from '@fitnessos/kernel'
import { useRef, useState } from 'react'
import type { ReportSnapshot } from '../../editor/schema'
import { useReport } from '../hooks/useReport'
import { ReportBuilder, type ReportBuilderLabels } from './ReportBuilder'

export interface ReportWorkspaceLabels {
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
   * The collision, and the choice it forces. The same four names the Program Builder uses, because
   * a coach meets this situation in two places and it should read as one situation.
   */
  readonly conflictTitle: string
  readonly conflictBody: string
  readonly conflictKeep: string
  readonly conflictDiscard: string
  /**
   * Close the panel and decide later — a fifth string the programme does not need.
   *
   * There, "keep" IS the dismissal: it leaves the draft open and stores nothing. Here "keep" stores
   * the draft, so without this there would be no way out of the panel that does not write to the
   * server or throw the local work away.
   */
  readonly conflictDismiss: string
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
  const { report, isLoading, save, isSaving, error, loadFailed, retry, conflict, keepMine, takeTheirs, reset } =
    useReport()

  /*
    The document the last save attempt carried — what "keep mine" sends again.

    The workspace holds no draft of its own: it lives in the builder's editor store and surfaces
    here only as the argument to `onSave`. A ref rather than state, because nothing renders
    differently for it and re-rendering the canvas on every save would be work for no picture.
  */
  const attempted = useRef<ReportSnapshot | null>(null)

  /*
    Bumped when a resolution lands, and used as the builder's key.

    The builder hydrates its store ONCE, keyed on `report.id`, so that a refetch returning an
    equal-but-new object cannot discard edits in progress. Both sides of a conflict are the same
    report, so adopting the other author's document changes that id not at all — the coach would
    press "discard mine" and go on looking at their own canvas, with the choice they just made
    invisible. Remounting is what shows it to them.

    Only on a resolution that LANDED. A "keep mine" that collided again must leave the builder
    alone: the cache now holds the other author's document, and remounting would hydrate from it,
    destroying the very work the button exists to save.
  */
  const [resolutions, setResolutions] = useState(0)

  const attempt = (next: ReportSnapshot) => {
    attempted.current = next
    return save(next)
  }

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
            void attempt(startingReport(labels))
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
        The collision, and the choice it forces — not the generic banner, which said "could not be
        saved" and left the coach with no move except pressing Save into the same refusal.

        Nothing here is destructive by default (ADR-0033): the local document stays in the editor
        until the coach says otherwise, and the other author's version is never overwritten without
        the revision that proves we saw it.
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
                const mine = attempted.current
                if (mine === null) return
                void keepMine(mine).then((stored) => {
                  // Only a stored document is worth re-hydrating from; see `resolutions`.
                  if (stored) setResolutions((count) => count + 1)
                })
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
                setResolutions((count) => count + 1)
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

      {/* Narrowed back to `error`: a conflict has its own panel above, and a coach reading both at
          once would be told their work was lost beside the two versions of it. */}
      {error !== null && (
        <Card role="alert">
          <CardDescription>{labels.saveFailed}</CardDescription>
        </Card>
      )}
      <ReportBuilder
        key={resolutions}
        report={report}
        locale={locale}
        labels={labels.builder}
        onSave={attempt}
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
