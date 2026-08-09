'use client'

import { Button, Card, CardDescription, CardTitle, Skeleton } from '@fitnessos/ui'
import { newEntityId, type Locale } from '@fitnessos/kernel'
import type { CheckInFormSnapshot } from '../../application/index'
import { useCheckInForm } from '../hooks/useCheckInForm'
import { FormBuilder, type FormBuilderLabels } from './FormBuilder'

/*
 * The builder is imported directly, NOT lazily — unlike the Program Builder, which is worth
 * splitting.
 *
 * It was split here first, on the assumption that the same reasoning applied, and measured: the
 * route went from 44.3 kB to 44.4. The editor is not what weighs on this page. The weight is the
 * context's own infrastructure — the mappers and the generated validators for CheckInForm,
 * Observation and IndicatorSeries — which the hook pulls in whether or not a form exists.
 *
 * So the split bought a Suspense boundary and an extra chunk for nothing, and is not kept. The
 * programme route is different because an athlete reads it constantly and never edits; here the
 * only visitor is the coach who came to author.
 */

export interface WorkspaceLabels {
  readonly title: string
  readonly none: string
  readonly noneHint: string
  readonly create: string
  readonly loading: string
  readonly saveFailed: string
  readonly newFormTitle: string
  readonly builder: FormBuilderLabels
}

export interface CheckInFormWorkspaceProps {
  locale: Locale
  labels: WorkspaceLabels
}

/**
 * Authoring the check-in form.
 *
 * Always in the editor rather than behind a read/edit toggle, which is the opposite of the
 * Program Builder's choice — and for the reason that made that one a toggle. A programme is read
 * far more often than it is written, by an athlete who never edits. A form is only ever seen by
 * the coach authoring it; the athlete sees the questions, not this. A toggle here would be a
 * click before every use with nobody on the other side of it.
 */
export const CheckInFormWorkspace = ({ locale, labels }: CheckInFormWorkspaceProps) => {
  const { form, isLoading, save, isSaving, error } = useCheckInForm()

  if (isLoading) {
    return (
      <Card>
        <Skeleton className="h-6 w-48" label={labels.loading} />
        <Skeleton className="mt-3 h-32 w-full" label={labels.loading} />
      </Card>
    )
  }

  // `null` is a real answer, not a loading state: no coach has authored one yet.
  if (form === null) {
    return (
      <Card>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>{labels.none}</CardDescription>
        <p className="text-muted mt-2 text-sm">{labels.noneHint}</p>
        <Button
          type="button"
          className="mt-4"
          onPress={() => {
            /*
             * A starting form, not an empty one. The aggregate refuses a form with no fields, so
             * "create" producing an empty document would put the coach straight into a state
             * that cannot be saved — and the first thing they would learn about the builder is
             * an error they did not cause.
             */
            void save(startingForm(labels))
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
      <FormBuilder
        form={form}
        locale={locale}
        labels={labels.builder}
        onSave={save}
        isSaving={isSaving}
      />
    </div>
  )
}

const startingForm = (labels: WorkspaceLabels): CheckInFormSnapshot => ({
  id: newEntityId(),
  title: labels.newFormTitle,
  fields: [
    {
      id: newEntityId(),
      label: labels.builder.newFieldLabel,
      // Seeded with a kind and unit the product already understands, so the first save succeeds.
      // A blank `records` would be refused by the aggregate, which is the correct rule and the
      // wrong first experience.
      records: 'bodyweight',
      unit: 'kg',
      answer: { kind: 'number' },
      order: 0,
    },
  ],
})
