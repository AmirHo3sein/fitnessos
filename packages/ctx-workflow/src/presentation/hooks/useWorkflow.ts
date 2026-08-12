'use client'

import { useSubject } from '@fitnessos/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { currentWorkflowQuery, workflowKeys, type Loaded } from '../../application/index'
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
  /**
   * TRUE when the save reached the server — what moves the editor's commit boundary.
   *
   * Unchanged signature: the base revision is the hook's business, not the editor's. A caller that
   * had to supply one would be a caller holding a concurrency token inside a document (ADR-0035).
   */
  readonly save: (workflow: WorkflowSnapshot) => Promise<boolean>
  readonly isSaving: boolean
  readonly error: Error | null
}

export const useWorkflow = (): UseWorkflow => {
  const ports = useWorkflowPorts()
  const subject = useSubject()
  const queryClient = useQueryClient()
  const query = useQuery(currentWorkflowQuery(ports, subject))

  const mutation = useMutation({
    mutationFn: (workflow: WorkflowSnapshot) =>
      /*
        The base revision is read from the CACHE at save time, not closed over from this render.
        Two saves in quick succession do not necessarily re-render between them, and the second one
        must quote the revision the FIRST one returned — quoting the one it rendered with would be
        stale on arrival and answer 409 for a change nobody else made.

        Null on a first save, where there is nothing to collide with, and null against an older
        server that sends no revision at all; both leave the decision where it belongs.
      */
      ports.workflow.save(
        workflow,
        queryClient.getQueryData<Loaded<WorkflowSnapshot> | null>(workflowKeys.current(subject))
          ?.revision ?? null,
      ),
    // Set, not invalidate: the response IS the new state — including its new revision.
    onSuccess: (saved) => {
      queryClient.setQueryData(workflowKeys.current(subject), saved)
    },
  })

  return {
    // The envelope is unwrapped here and goes no further: the editor receives the document and
    // never learns a revision exists.
    workflow: query.data?.artefact ?? null,
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
