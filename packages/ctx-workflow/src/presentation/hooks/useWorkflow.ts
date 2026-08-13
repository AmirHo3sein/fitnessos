'use client'

import { useSubject } from '@fitnessos/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  currentWorkflowQuery,
  WorkflowConflictError,
  workflowKeys,
  type Loaded,
} from '../../application/index'
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
   *
   * FALSE on a collision too, because a collision did not save. The caller reads `conflict` to learn
   * that is why.
   */
  readonly save: (workflow: WorkflowSnapshot) => Promise<boolean>
  readonly isSaving: boolean
  readonly error: Error | null
  /**
   * The workflow as the server holds it, when a save collided with another author.
   *
   * Surfaced separately from `error` because it is not a failure the user should see as one —
   * nothing broke, someone else got there first, and the two versions both exist. The local document
   * is untouched in the editor; this is what it collided with.
   */
  readonly conflict: WorkflowSnapshot | null
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
    // A conflict is reported through `conflict`, so it must not also arrive as an error — a
    // component rendering both would show "something went wrong" beside the resolution UI.
    error: mutation.error instanceof WorkflowConflictError ? null : mutation.error,
    /*
      Unwrapped here, like `workflow` above: the editor is shown a document and never learns a
      revision exists. The envelope is not lost — it stays on the error the mutation still holds,
      which is where a resolution flow will find the revision its retry has to quote.

      Deliberately NOT written into the query cache. The cache is what the editor hydrates from, so
      seeding it with the other author's copy would replace the local draft with the very thing it
      collided with — the collision resolved by discarding one side, silently, without asking.
    */
    conflict:
      mutation.error instanceof WorkflowConflictError ? mutation.error.current.artefact : null,
  }
}
