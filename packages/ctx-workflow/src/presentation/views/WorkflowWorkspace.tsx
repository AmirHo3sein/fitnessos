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
  const { workflow, isLoading, save, isSaving, error } = useWorkflow()

  if (isLoading) {
    return (
      <Card>
        <Skeleton className="h-6 w-48" label={labels.loading} />
        <Skeleton className="mt-3 h-32 w-full" label={labels.loading} />
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
