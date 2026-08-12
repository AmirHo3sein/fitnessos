import { subjectScope, type SubjectId } from '@fitnessos/kernel'
import type { WorkflowSnapshot } from '../../editor/schema'
import type { Loaded, WorkflowPorts } from '../ports/index'

export const workflowKeys = {
  all: (subject: SubjectId) => [...subjectScope(subject), 'workflow'] as const,
  current: (subject: SubjectId) => [...workflowKeys.all(subject), 'current'] as const,
} as const

export interface QueryDefinition<T> {
  readonly queryKey: readonly unknown[]
  readonly queryFn: (ctx: { signal: AbortSignal }) => Promise<T>
  readonly staleTime?: number
}

export const currentWorkflowQuery = (
  ports: WorkflowPorts,
  subject: SubjectId,
  // The envelope is what is cached, not the document: the revision a save must quote is only
  // correct if it travels with the copy it was read from.
): QueryDefinition<Loaded<WorkflowSnapshot> | null> => ({
  queryKey: workflowKeys.current(subject),
  queryFn: ({ signal }) => ports.workflow.current(signal),
  staleTime: 5 * 60_000,
})
