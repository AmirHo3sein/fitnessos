'use client'

import { Button, Card, CardDescription, CardTitle, Skeleton } from '@fitnessos/ui'
import { newEntityId, type Locale } from '@fitnessos/kernel'
import { useState } from 'react'
import type { WorkflowSnapshot } from '../../editor/schema'
import { useWorkflow } from '../hooks/useWorkflow'
import { WorkflowBuilder, type WorkflowBuilderLabels } from './WorkflowBuilder'

export interface WorkflowWorkspaceLabels {
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
   * The collision panel — the Program Builder's four words, for the same four things.
   *
   * One vocabulary on purpose: a coach who has met "this was changed elsewhere" in the programme
   * should not have to learn a second name for it here. What differs is only what the two choices
   * DO, which is a property of this artefact rather than of the words (see below).
   */
  readonly conflictTitle: string
  readonly conflictBody: string
  readonly conflictKeep: string
  readonly conflictDiscard: string
  /**
   * A fifth, which the programme does not need.
   *
   * There, "keep mine" only closes the panel — the local document stays in the editor and nothing is
   * sent — so keeping and dismissing are the same press. Here "keep mine" SAVES, so an author who
   * wants to look before committing to either side has no non-committal exit without this one.
   */
  readonly conflictDismiss: string
  readonly newTitle: string
  readonly firstTrigger: string
  readonly builder: WorkflowBuilderLabels
}

export interface WorkflowWorkspaceProps {
  locale: Locale
  labels: WorkflowWorkspaceLabels
}

/** Authoring the automation. */
export const WorkflowWorkspace = ({ locale, labels }: WorkflowWorkspaceProps) => {
  const {
    workflow,
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
  } = useWorkflow()

  /*
    Bumped only when the author adopts the other version, and used as the builder's `key`.

    The builder hydrates its editor store ONCE per workflow id (see `WorkflowBuilder`), which is
    right for every other reason a new snapshot arrives — a save response must not throw away the
    history. Taking theirs is the one case where the incoming document is meant to REPLACE what is
    open, and without a remount the store would keep the local draft while the cache held theirs:
    the author would press "use theirs", see no change, and save their own work back over it.
  */
  const [adoptions, setAdoptions] = useState(0)

  if (isLoading) {
    return (
      <Card>
        <Skeleton className="h-6 w-48" label={labels.loading} />
        <Skeleton className="mt-3 h-32 w-full" label={labels.loading} />
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

  if (workflow === null) {
    return (
      <Card>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>{labels.none}</CardDescription>
        <p className="text-muted mt-2 text-sm">{labels.noneHint}</p>
        <Button
          type="button"
          className="mt-4"
          onPress={() => {
            void save(startingWorkflow(labels))
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
        The resolution, not a banner. A collision used to fall through to `saveFailed` beside the
        genuine failures, which told the author their change had not landed and nothing about why or
        what to do — and "try again" was actively wrong advice, because the cache still held the base
        the server had just refused and every retry collided identically.

        Neither choice destroys anything unasked (ADR-0033): "keep mine" re-sends the author's own
        document onto the revision the server reported, and "use theirs" replaces the editor's
        contents only once the author has said so. Dismissing does neither and keeps both.
      */}
      {conflict !== null && (
        <Card role="alert">
          <CardTitle>{labels.conflictTitle}</CardTitle>
          <CardDescription>{labels.conflictBody}</CardDescription>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              // A second collision is possible while this one is being resolved, so the retry is a
              // save like any other and is guarded like any other.
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
                setAdoptions((count) => count + 1)
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

      {error !== null && (
        <Card role="alert">
          <CardDescription>{labels.saveFailed}</CardDescription>
        </Card>
      )}

      <WorkflowBuilder
        key={adoptions}
        workflow={workflow}
        locale={locale}
        labels={labels.builder}
        onSave={save}
        isSaving={isSaving}
      />
    </div>
  )
}

/**
 * One trigger, disabled, and nothing else.
 *
 * A trigger rather than an empty graph because every workflow needs exactly one thing before any
 * other step can be reached, and starting with the piece that has no input is the only ordering
 * that never produces an unreachable step. Disabled, obviously: a one-node workflow does nothing,
 * and `isRunnable` would refuse to enable it anyway.
 */
const startingWorkflow = (labels: WorkflowWorkspaceLabels): WorkflowSnapshot => ({
  id: newEntityId(),
  title: labels.newTitle,
  enabled: false,
  nodes: [{ id: newEntityId(), kind: 'trigger', detail: labels.firstTrigger, x: 40, y: 40 }],
  edges: [],
})
