'use client'

import { Button, Card, CardDescription, CardTitle, Skeleton } from '@fitnessos/ui'
import { newEntityId, type Locale } from '@fitnessos/kernel'
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
  const { workflow, isLoading, save, isSaving, error, loadFailed, retry } = useWorkflow()

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
      {error !== null && (
        <Card>
          <CardDescription>{labels.saveFailed}</CardDescription>
        </Card>
      )}
      <WorkflowBuilder
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
