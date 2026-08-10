'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { currentWorkflowQuery, workflowKeys } from '../../application/index'
import type { WorkflowSnapshot } from '../../editor/schema'
import { useWorkflowPorts } from '../di'

export interface UseWorkflow {
  readonly workflow: WorkflowSnapshot | null
  readonly isLoading: boolean
  /**
   * The LOAD failed — distinct from "nothing authored yet", and that distinction is load-bearing.
   *
   * Both used to arrive at the workspace as `null`, so a transient network failure rendered the
   * empty state: "nothing has been written yet", beside a Create button. Pressing it PUT a NEW id,
   * and because the server keys "current" per athlete, the artefact that merely failed to load was
   * overwritten by an empty one. Silent data loss from a dropped request.
   */
  readonly loadFailed: boolean
  /** Refetch, so the answer to a failed load is one press rather than a full reload. */
  readonly retry: () => void
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
    loadFailed: query.isError,
    retry: () => {
      void query.refetch()
    },
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
