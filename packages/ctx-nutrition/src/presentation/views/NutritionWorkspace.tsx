'use client'

import { Button, Card, CardDescription, CardTitle, Skeleton } from '@fitnessos/ui'
import { newEntityId, type Locale } from '@fitnessos/kernel'
import { useRef, useState } from 'react'
import type { NutritionSnapshot } from '../../editor/schema'
import { useNutritionPlan } from '../hooks/useNutritionPlan'
import { NutritionBuilder, type NutritionBuilderLabels } from './NutritionBuilder'

export interface NutritionWorkspaceLabels {
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
    The Program Builder's four names, unchanged (ADR-0033). A conflict is one idea, so it is one
    vocabulary: an author who has met this dialog on their programme should not have to work out
    whether the nutrition one means something else.
  */
  readonly conflictTitle: string
  readonly conflictBody: string
  readonly conflictKeep: string
  readonly conflictDiscard: string
  /** Leave the question open. See the dialog for why this affordance is not optional here. */
  readonly conflictDismiss: string
  readonly newTitle: string
  readonly firstMeal: string
  readonly firstMealWhen: string
  readonly builder: NutritionBuilderLabels
}

export interface NutritionWorkspaceProps {
  locale: Locale
  labels: NutritionWorkspaceLabels
}

/** Authoring the nutrition plan. */
export const NutritionWorkspace = ({ locale, labels }: NutritionWorkspaceProps) => {
  const {
    plan,
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
  } = useNutritionPlan()

  /*
    The document the builder last tried to store.

    The editor owns the live document and hands it over only when Save is pressed, so this is the
    one place the author's version still exists once the save has come back refused. Without it
    "keep mine" would have nothing to send.

    A ref rather than state: nothing renders it, and re-rendering the workspace on every save would
    remount nothing but cost a pass over the whole builder.
  */
  const attempted = useRef<NutritionSnapshot | null>(null)

  /*
    Bumped when the author takes the other version, to REMOUNT the builder.

    The builder memoises its editor store on `plan.id`, and the server's plan is the same artefact
    with the same id — so adopting it would change the cache and leave the editor showing the
    discarded document, with the next save quietly restoring it. Nothing else remounts the builder,
    and nothing else may: an ordinary save must not throw away the undo history.
  */
  const [adopted, setAdopted] = useState(0)

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
            void save(startingPlan(labels))
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
        The resolution, not a banner. A conflict is not a failure — nothing broke, someone else got
        there first, and both plans exist — so "we could not save" was the wrong sentence twice
        over: it described the wrong event, and it offered the author no way out of it. The only
        move it left was to press Save again, which quotes the same stale revision and collides
        again.

        Both choices are the author's, and neither is taken for them (ADR-0033).
      */}
      {conflict !== null && (
        <Card role="alert">
          <CardTitle>{labels.conflictTitle}</CardTitle>
          <CardDescription>{labels.conflictBody}</CardDescription>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              isDisabled={isSaving}
              onPress={() => {
                // The plan the builder handed over, sent again onto the revision the collision
                // revealed. `null` cannot happen while a conflict is on screen — a conflict is a
                // save's answer — but a press that sent nothing would be worse than one that does
                // nothing at all.
                const mine = attempted.current
                if (mine !== null) void keepMine(mine)
              }}
            >
              {labels.conflictKeep}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onPress={() => {
                takeTheirs()
                setAdopted((n) => n + 1)
              }}
            >
              {labels.conflictDiscard}
            </Button>
            {/*
              Dismissal, and it is not politeness. Both other buttons decide the plan's contents,
              and an author who is not ready to decide — who wants to re-read what they wrote first
              — must be able to put the question down. A dialog whose only exits are two
              irreversible choices is one that gets answered at random to make it go away.
            */}
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

      <NutritionBuilder
        key={adopted}
        plan={plan}
        locale={locale}
        labels={labels.builder}
        onSave={(next) => {
          // Remembered on the way past, because a refused save is the moment this document stops
          // being reachable from anywhere else.
          attempted.current = next
          return save(next)
        }}
        isSaving={isSaving}
      />
    </div>
  )
}

/**
 * One empty meal.
 *
 * The contract requires at least one meal (`minItems: 1`), so unlike the training plan this seed
 * is not only a courtesy — a plan with none could not be saved. Its items are left empty: naming
 * a meal is the coach's first decision and guessing at food would be putting words in their mouth.
 */
const startingPlan = (labels: NutritionWorkspaceLabels): NutritionSnapshot => ({
  id: newEntityId(),
  title: labels.newTitle,
  meals: [
    { id: newEntityId(), name: labels.firstMeal, when: labels.firstMealWhen, order: 0, items: [] },
  ],
})
