'use client'

import { Button, Card, CardDescription, CardTitle, Skeleton } from '@fitnessos/ui'
import { newEntityId, type Locale } from '@fitnessos/kernel'
import { useRef, useState } from 'react'
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
   * The four conflict strings, named as the Program Builder names them.
   *
   * Same names because it is the same event, and a coach who has met it once on a programme should
   * not have to work out that "someone else saved first" is being described to them again in a
   * different vocabulary. The wording differs where the affordance differs: here "keep" WRITES,
   * because a form has no versions to come back to.
   */
  readonly conflictTitle: string
  readonly conflictBody: string
  readonly conflictKeep: string
  readonly conflictDiscard: string
  /** The close control's accessible name. It has only a glyph, so it needs one. */
  readonly conflictDismiss: string
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
  const {
    form,
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
  } = useCheckInForm()

  /*
   * The document the last save ATTEMPTED, which is the one "keep mine" has to send again.
   *
   * A ref rather than state: it is never rendered, and setting state inside the save path would
   * re-render the builder mid-save for no visible reason. The builder owns the document — the
   * workspace only ever sees it in passing, as the argument it forwards to the hook.
   */
  const attempted = useRef<CheckInFormSnapshot | null>(null)

  /*
   * Bumped when the server's document is adopted, and part of the builder's key.
   *
   * The builder hydrates ONCE per form id, deliberately — a store rebuilt on every render loses the
   * undo history. Taking theirs does not change the id, so without a key that changes the coach
   * would press "discard mine" and go on looking at their own document. The remount is the point
   * here: the local draft and its history are precisely what they chose to give up.
   */
  const [adopted, setAdopted] = useState(0)

  const attemptSave = async (next: CheckInFormSnapshot) => {
    attempted.current = next
    return save(next)
  }

  /*
   * Shown INSTEAD of the save-failed banner, never beside it — the hook keeps `error` and
   * `conflict` mutually exclusive, because "something went wrong" next to a resolution the coach is
   * being asked to make reads as if the resolution itself had failed.
   *
   * Both choices are explicit and neither happens by default (ADR-0033), but they are not equally
   * safe: "keep mine" writes over the other author's version, which is recoverable — their document
   * is still on the server's side of the last save — whereas "take theirs" drops a draft that
   * exists nowhere else. So it is the quieter of the two, and dismissing decides nothing at all.
   */
  const conflictCard =
    conflict === null ? null : (
      <Card role="alert">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <CardTitle>{labels.conflictTitle}</CardTitle>
            <CardDescription>{labels.conflictBody}</CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={labels.conflictDismiss}
            onPress={reset}
          >
            ✕
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            isDisabled={isSaving}
            onPress={() => {
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
              setAdopted((count) => count + 1)
            }}
          >
            {labels.conflictDiscard}
          </Button>
        </div>
      </Card>
    )

  if (isLoading) {
    return (
      <Card>
        <Skeleton className="h-6 w-48" label={labels.loading} />
        <Skeleton className="mt-3 h-32 w-full" label={labels.loading} />
      </Card>
    )
  }

  // `null` is a real answer, not a loading state: no coach has authored one yet.
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

  if (form === null) {
    return (
      /*
        The conflict card belongs here too. A first save carries no precondition, so it collides
        when a coach on another device authored a form in the meantime — and without the card on
        this branch that 409 would look like a Create button that did nothing at all.
      */
      <div className="space-y-4">
        {conflictCard}
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
              void attemptSave(startingForm(labels))
            }}
          >
            {labels.create}
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {conflictCard}
      {error !== null && (
        <Card role="alert">
          <CardDescription>{labels.saveFailed}</CardDescription>
        </Card>
      )}
      <FormBuilder
        key={`${form.id}:${String(adopted)}`}
        form={form}
        locale={locale}
        labels={labels.builder}
        onSave={attemptSave}
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
