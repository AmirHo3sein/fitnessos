'use client'

import { Button, Card, CardDescription, CardTitle, Skeleton } from '@fitnessos/ui'
import { newEntityId, type Locale } from '@fitnessos/kernel'
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
  const { plan, isLoading, save, isSaving, error, loadFailed, retry } = useNutritionPlan()

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
      {error !== null && (
        <Card>
          <CardDescription>{labels.saveFailed}</CardDescription>
        </Card>
      )}
      <NutritionBuilder
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
