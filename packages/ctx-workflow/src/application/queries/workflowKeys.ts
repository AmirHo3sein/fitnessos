import type { WorkflowSnapshot } from '../../editor/schema'
import type { WorkflowPorts } from '../ports/index'

export const workflowKeys = {
  all: ['workflow'] as const,
  current: () => [...workflowKeys.all, 'current'] as const,
} as const

export interface QueryDefinition<T> {
  readonly queryKey: readonly unknown[]
  readonly queryFn: (ctx: { signal: AbortSignal }) => Promise<T>
  readonly staleTime?: number
}

export const currentWorkflowQuery = (
  ports: WorkflowPorts,
): QueryDefinition<WorkflowSnapshot | null> => ({
  queryKey: workflowKeys.current(),
  queryFn: ({ signal }) => ports.workflow.current(signal),
  staleTime: 5 * 60_000,
})
