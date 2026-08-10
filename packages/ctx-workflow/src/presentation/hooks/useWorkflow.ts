'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { currentWorkflowQuery, workflowKeys } from '../../application/index'
import type { WorkflowSnapshot } from '../../editor/schema'
import { useWorkflowPorts } from '../di'

export interface UseWorkflow {
  readonly workflow: WorkflowSnapshot | null
  readonly isLoading: boolean
  /** TRUE when the save reached the server — what moves the editor's commit boundary. */
  readonly save: (workflow: WorkflowSnapshot) => Promise<boolean>
  readonly isSaving: boolean
  readonly error: Error | null
}

export const useWorkflow = (): UseWorkflow => {
  const ports = useWorkflowPorts()
  const queryClient = useQueryClient()
  const query = useQuery(currentWorkflowQuery(ports))

  const mutation = useMutation({
    mutationFn: (workflow: WorkflowSnapshot) => ports.workflow.save(workflow),
    // Set, not invalidate: the response IS the new state.
    onSuccess: (saved) => {
      queryClient.setQueryData(workflowKeys.current(), saved)
    },
  })

  return {
    workflow: query.data ?? null,
    isLoading: query.isPending,
    save: async (workflow) => {
      try {
        await mutation.mutateAsync(workflow)
        return true
      } catch {
        return false
      }
    },
    isSaving: mutation.isPending,
    error: mutation.error,
  }
}
