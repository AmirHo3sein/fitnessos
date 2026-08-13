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
  /**
   * The artefact as the server holds it, WITH its revision.
   *
   * `Loaded`, not the bare snapshot: the revision is what a resolution needs. Without it the query
   * cache still holds the base the server just refused, so every subsequent save quotes the same dead
   * precondition and conflicts again — the author is stuck until a refetch replaces their document,
   * which is the work they were trying not to lose.
   */
  readonly conflict: Loaded<WorkflowSnapshot> | null
  /**
   * Resolve a collision by re-saving the author's OWN document onto the revision the server reported.
   *
   * This is the half of the resolution that cannot be done from outside the hook. The ordinary `save`
   * reads its base revision from the cache, and the cache still holds the base the server just
   * refused — so a plain retry quotes the same dead precondition and conflicts again, for ever. The
   * author would be left pressing Save against a wall.
   *
   * FALSE if it collided a second time (someone saved again in between) or if there is no collision
   * to resolve, on the same reasoning as `save`.
   */
  readonly keepMine: () => Promise<boolean>
  /**
   * Resolve a collision the other way: adopt the server's copy and abandon the local document.
   *
   * Writes the whole envelope into the cache, revision included — adopting a copy without the
   * revision it was read at would leave the very staleness this resolves.
   */
  readonly takeTheirs: () => void
  /**
   * Clear the conflict (and any error) without choosing either side.
   *
   * Needed because `conflict` is DERIVED from the mutation's error, so nothing but the mutation can
   * clear it: without this the panel would stay on screen until the next save, and an author who
   * wants to look at their work before deciding would have no way to put it away. Dismissing loses
   * nothing — the local document is untouched in the editor, and the server's copy is one refetch
   * away.
   */
  readonly reset: () => void
}

/**
 * One save attempt: the document, and — only when the caller already knows it — the revision to save
 * it ONTO.
 *
 * Absent is the ordinary path and means "read the cache at save time" (see below). Present is the
 * resolution path, which must quote the revision the server reported in its 409, precisely because
 * that is the one revision the cache does not hold. A bare `number | null` could not express the
 * difference: `null` already means "I believe nothing is here".
 */
interface SaveAttempt {
  readonly workflow: WorkflowSnapshot
  readonly onto?: { readonly revision: number | null }
}

export const useWorkflow = (): UseWorkflow => {
  const ports = useWorkflowPorts()
  const subject = useSubject()
  const queryClient = useQueryClient()
  const query = useQuery(currentWorkflowQuery(ports, subject))

  const mutation = useMutation({
    mutationFn: ({ workflow, onto }: SaveAttempt) =>
      /*
        The base revision is read from the CACHE at save time, not closed over from this render.
        Two saves in quick succession do not necessarily re-render between them, and the second one
        must quote the revision the FIRST one returned — quoting the one it rendered with would be
        stale on arrival and answer 409 for a change nobody else made.

        Null on a first save, where there is nothing to collide with, and null against an older
        server that sends no revision at all; both leave the decision where it belongs.

        `onto` overrides all of that, and only a conflict resolution supplies it: the cache is by
        definition behind at that moment, so the one revision worth quoting is the one the 409
        carried.
      */
      ports.workflow.save(
        workflow,
        onto === undefined
          ? (queryClient.getQueryData<Loaded<WorkflowSnapshot> | null>(
              workflowKeys.current(subject),
            )?.revision ?? null)
          : onto.revision,
      ),
    // Set, not invalidate: the response IS the new state — including its new revision.
    onSuccess: (saved) => {
      queryClient.setQueryData(workflowKeys.current(subject), saved)
    },
  })

  /*
    Read once, because three of the fields below are the same question asked three ways. The
    envelope is kept whole: `takeTheirs` needs the document and `keepMine` needs the revision.
  */
  const conflict =
    mutation.error instanceof WorkflowConflictError ? mutation.error.current : null

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
        await mutation.mutateAsync({ workflow })
        return true
      } catch {
        return false
      }
    },
    isSaving: mutation.isPending,
    // A conflict is reported through `conflict`, so it must not also arrive as an error — a
    // component rendering both would show "something went wrong" beside the resolution UI.
    error: conflict === null ? mutation.error : null,
    /*
      Kept in its envelope, unlike `workflow` above. The editor is shown a document and never learns
      a revision exists, but whoever RESOLVES a collision needs both halves: the document to adopt,
      and the revision to save onto.

      Deliberately NOT written into the query cache when it arrives. The cache is what the editor
      hydrates from, so seeding it with the other author's copy would replace the local draft with
      the very thing it collided with — the collision resolved by discarding one side, silently,
      without asking. `takeTheirs` is that write, made deliberately and on the author's word.
    */
    conflict,
    keepMine: async () => {
      /*
        The document to re-save is the one the failed attempt carried, which react-query still holds
        as the mutation's variables. Taking it from there rather than from a copy of our own: the
        editor's draft may have moved on since the collision (the author can keep typing while the
        panel is up), and re-saving something they never pressed Save on would put unreviewed work
        on the server under the guise of "keep mine".
      */
      const attempted = mutation.variables
      if (conflict === null || attempted === undefined) return false
      try {
        await mutation.mutateAsync({
          workflow: attempted.workflow,
          onto: { revision: conflict.revision },
        })
        return true
      } catch {
        return false
      }
    },
    takeTheirs: () => {
      if (conflict === null) return
      queryClient.setQueryData(workflowKeys.current(subject), conflict)
      // Or the panel would outlive the collision it describes: `conflict` is the mutation's error,
      // and adopting a copy does not by itself make that error go away.
      mutation.reset()
    },
    reset: mutation.reset,
  }
}
