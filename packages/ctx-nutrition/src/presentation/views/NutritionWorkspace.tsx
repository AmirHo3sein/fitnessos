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
  const { plan, isLoading, save, isSaving, error } = useNutritionPlan()

  if (isLoading) {
    return (
      <Card>
        <Skeleton className="h-6 w-48" label={labels.loading} />
        <Skeleton className="mt-3 h-32 w-full" label={labels.loading} />
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
