'use client'

import { Button, Card, CardDescription, CardTitle, Skeleton } from '@fitnessos/ui'
import { newEntityId, type Locale, type PlainDate } from '@fitnessos/kernel'
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
  const { plan, isLoading, save, isSaving, error, loadFailed, retry } = usePlan()

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
      {error !== null && (
        <Card>
          <CardDescription>{labels.saveFailed}</CardDescription>
        </Card>
      )}
      <TimelineBuilder
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
