'use client'

import { Button, Card, CardDescription, CardTitle, Skeleton } from '@fitnessos/ui'
import { newEntityId, type Locale, type PlainDate } from '@fitnessos/kernel'
import { useState } from 'react'
import { DAYS_PER_WEEK } from '../../topology/temporal'
import type { PlanSnapshot } from '../../editor/schema'
import { usePlan } from '../hooks/usePlan'
import { TimelineBuilder, type TimelineBuilderLabels } from './TimelineBuilder'

export interface PlanWorkspaceLabels {
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
  /*
    The collision's four words, named as the Program Builder names them.

    Same keys, same order, same two choices — one vocabulary for one situation, so a coach who has
    met this on a programme recognises it on a plan. What differs is only what "keep" DOES here:
    the programme leaves the editor open, this one writes.
  */
  readonly conflictTitle: string
  readonly conflictBody: string
  readonly conflictKeep: string
  readonly conflictDiscard: string
  /** Dismiss without choosing. A fifth string, because neither choice here is a "not now". */
  readonly conflictDismiss: string
  readonly newTitle: string
  readonly firstPhase: string
  readonly builder: TimelineBuilderLabels
}

export interface PlanWorkspaceProps {
  locale: Locale
  labels: PlanWorkspaceLabels
  /**
   * The epoch a NEW plan starts from, resolved on the server.
   *
   * Passed in rather than read from a clock here: a `new Date()` in a client component differs
   * between the server render and hydration, and for an epoch that means the whole plan shifts by
   * a day depending on which ran second.
   */
  today: PlainDate
}

/** Authoring the plan. Always in the editor once one exists — only its author opens this. */
export const PlanWorkspace = ({ locale, labels, today }: PlanWorkspaceProps) => {
  const { plan, isLoading, save, isSaving, error, loadFailed, retry, conflict, keepMine, takeTheirs, reset } =
    usePlan()

  /*
    How many times the author has taken the other version, used only as the builder's `key`.

    The builder hydrates its editor store once per plan IDENTITY — the id does not change when a
    collision is resolved, so adopting the server's plan would leave the canvas showing the local
    draft while the cache held something else. Remounting is the honest way to say "this is a
    different document now"; a counter rather than the revision, because the revision also moves on
    every ordinary save and remounting there would throw away undo history nobody asked to lose.
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
      <Card>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>{labels.loadFailed}</CardDescription>
        <Button type="button" variant="secondary" className="mt-4" onPress={retry}>
          {labels.retry}
        </Button>
      </Card>
    )
  }

  if (plan === null) {
    return (
      <Card>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>{labels.none}</CardDescription>
        <p className="text-muted mt-2 text-sm">{labels.noneHint}</p>
        <Button
          type="button"
          className="mt-4"
          onPress={() => {
            void save(startingPlan(labels, today))
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
        A collision, and the two versions it left behind.

        It takes the place of the generic banner rather than sitting beside it — which is why the
        condition below is `error` alone again. "We could not store your change" is true of a
        collision and useless: nothing broke, someone else got there first, and the author's next
        move is a decision rather than another press of Save.
      */}
      {conflict !== null && (
        <Card>
          <CardTitle>{labels.conflictTitle}</CardTitle>
          <CardDescription>{labels.conflictBody}</CardDescription>
          {/*
            Neither choice destroys silently (ADR-0033). "Keep mine" writes the author's document
            onto the revision the server named, so their work survives; "take theirs" is the
            explicit decision to let it go. Dismiss decides nothing and keeps the editor as it is.
          */}
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
              isDisabled={isSaving}
              onPress={() => {
                takeTheirs()
                setAdoptions((taken) => taken + 1)
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
        <Card>
          <CardDescription>{labels.saveFailed}</CardDescription>
        </Card>
      )}
      <TimelineBuilder
        key={adoptions}
        plan={plan}
        locale={locale}
        labels={labels.builder}
        onSave={save}
        isSaving={isSaving}
      />
    </div>
  )
}

/**
 * One four-week phase starting today.
 *
 * Four weeks because it is the shortest span a coach would call a block, and because an empty
 * plan is a valid state the aggregate accepts — so seeding is for the coach's benefit rather than
 * to avoid an error, unlike the check-in form where an empty one cannot be saved.
 */
const startingPlan = (labels: PlanWorkspaceLabels, today: PlainDate): PlanSnapshot => ({
  id: newEntityId(),
  title: labels.newTitle,
  epoch: today,
  phases: [
    {
      id: newEntityId(),
      label: labels.firstPhase,
      start: 0,
      length: 4 * DAYS_PER_WEEK,
      programId: null,
      servesGoal: null,
    },
  ],
})
