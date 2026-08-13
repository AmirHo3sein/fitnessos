'use client'

import { useSubject } from '@fitnessos/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckInFormConflictError,
  checkInFormQuery,
  measurementKeys,
  type CheckInFormSnapshot,
  type Loaded,
} from '../../application/index'
import { useMeasurementPorts } from '../di'

export interface UseCheckInForm {
  readonly form: CheckInFormSnapshot | null
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
   * Resolves TRUE when the save reached the server — what moves the editor's commit boundary.
   *
   * FALSE now also means "someone else wrote in between": a stale precondition is refused with 409
   * (§2.1a), and the editor must keep its unsaved work rather than believe it was stored. The
   * signature is unchanged because the caller's question is unchanged; the revision is supplied
   * here, from what was last read.
   *
   * `false` on a conflict too, because a conflict did not save. WHY it was false is read from
   * `conflict`.
   */
  readonly save: (form: CheckInFormSnapshot) => Promise<boolean>
  readonly isSaving: boolean
  readonly error: Error | null
  /**
   * The form as the server holds it, when a save collided with another author.
   *
   * Surfaced separately from `error` because it is not a failure the user should see as one —
   * nothing broke, someone else got there first, and both versions exist. The two are mutually
   * exclusive for the same reason: a conflict reported twice is a screen showing "something went
   * wrong" beside the resolution UI.
   *
   * The form, not the envelope. The editor hydrates snapshots, so handing it one carrying a
   * revision would put a precondition into the undo stack (ADR-0035).
   */
  /**
   * The artefact as the server holds it, WITH its revision.
   *
   * `Loaded`, not the bare snapshot: the revision is what a resolution needs. Without it the query
   * cache still holds the base the server just refused, so every subsequent save quotes the same dead
   * precondition and conflicts again — the author is stuck until a refetch replaces their document,
   * which is the work they were trying not to lose.
   */
  readonly conflict: Loaded<CheckInFormSnapshot> | null
  /**
   * Save the author's document again, ONTO the revision the conflict reported.
   *
   * This is what makes the refusal recoverable. `save` quotes the cached revision, which is the one
   * the server has just rejected, so retrying through it conflicts for ever; only the revision that
   * came back with the 409 describes the state being written over. The caller supplies the document
   * because the editor owns it — the hook never sees it except as an argument.
   *
   * Deliberately an overwrite, and named as one. It says "mine wins", which is a decision only the
   * author can take, and the copy in front of it says so (ADR-0033).
   *
   * `false` when there is no conflict to resolve: without a revision from the server this would be
   * an unconditional write, which is exactly the silent overwrite §2.1a exists to prevent.
   */
  readonly keepMine: (form: CheckInFormSnapshot) => Promise<boolean>
  /**
   * Adopt the server's document, discarding the local one.
   *
   * Writes the whole ENVELOPE into the cache, not just the artefact: adopting a document without
   * its revision would leave the next save quoting the dead one, so "take theirs" would resolve the
   * conflict on screen and recreate it on the next press.
   */
  readonly takeTheirs: () => void
  /**
   * Clear the conflict without resolving it.
   *
   * `conflict` is derived from the mutation's error, and nothing else ever clears that until the
   * next save — so without this the card could only be closed by choosing, and a coach who wants to
   * look at their form before deciding would have no way to get it out of the way. Dismissing
   * changes nothing on either side: the local document is still open and the cached revision is
   * still stale, so the next save conflicts again, which is the honest outcome of not deciding.
   */
  readonly reset: () => void
}

/**
 * One attempt at a save: the document, and the revision it claims as its base.
 *
 * The revision is passed in rather than read inside the mutation, because resolution has to send a
 * different one from the ordinary path — the revision that came back with the refusal, which is
 * nowhere in the cache and never will be.
 */
interface SaveAttempt {
  readonly form: CheckInFormSnapshot
  readonly onto: number | null
}

/**
 * The athlete's check-in form, and the way to change it.
 *
 * The cache is SET from the response rather than invalidated: the mutation already returns the
 * server's own view, so refetching would spend a round trip on data already in hand and leave a
 * window where the editor and the cache disagree.
 *
 * `save` returns a boolean rather than rejecting, because the caller's remaining question is only
 * whether to move its commit boundary — the failure is already reported through `error`, and
 * rejecting as well would make every call site write a `catch` that discards what it caught.
 *
 * The revision travels here and no further. The cache holds the envelope; the editor is handed
 * `.artefact` and never learns a revision exists, which is what keeps it out of the undo stack
 * (ADR-0035).
 */
export const useCheckInForm = (): UseCheckInForm => {
  const ports = useMeasurementPorts()
  const subject = useSubject()
  const queryClient = useQueryClient()

  const query = useQuery(checkInFormQuery(ports, subject))

  const mutation = useMutation({
    mutationFn: ({ form, onto }: SaveAttempt) => ports.measurement.saveCheckInForm(form, onto),
    onSuccess: (saved) => {
      // The ENVELOPE, not the form. The response is the new state including its new revision, and
      // storing the form alone would leave the next save sending the revision it just superseded.
      queryClient.setQueryData(measurementKeys.checkInForm(subject), saved)
    },
  })

  const attempt = async (input: SaveAttempt) => {
    try {
      await mutation.mutateAsync(input)
      return true
    } catch {
      return false
    }
  }

  // A conflict is reported through `conflict`, so it must not also arrive as an error.
  const conflict =
    mutation.error instanceof CheckInFormConflictError ? mutation.error.current : null

  return {
    form: query.data?.artefact ?? null,
    isLoading: query.isPending,
    loadFailed: query.isError,
    retry: () => {
      void query.refetch()
    },
    save: (form) =>
      attempt({
        form,
        /*
         * Read from the cache at call time rather than closing over `query.data`, so two saves in
         * succession send the revision the FIRST one returned. A value captured at render would
         * still be the pre-save revision if the second save fires before React re-renders, and
         * the second write would 409 against a revision this very client replaced.
         *
         * Null when nothing has been read: a first save, which carries no precondition because
         * there is nothing yet to collide with (BACKEND-CONTRACT §2.1a).
         */
        onto:
          queryClient.getQueryData<Loaded<CheckInFormSnapshot> | null>(
            measurementKeys.checkInForm(subject),
          )?.revision ?? null,
      }),
    isSaving: mutation.isPending,
    error: mutation.error instanceof CheckInFormConflictError ? null : mutation.error,
    /*
     * The colliding form is NOT written into the cache unless the author asks for it. The cache is
     * what the workspace reads and hydrates from, so storing the server's version on arrival would
     * replace the author's open document with the one that beat it — the unsaved work this refusal
     * exists to protect. It sits here beside the editor's own copy, and only `takeTheirs` moves it.
     */
    conflict,
    keepMine: async (form) =>
      conflict === null ? false : attempt({ form, onto: conflict.revision }),
    takeTheirs: () => {
      if (conflict === null) return
      queryClient.setQueryData(measurementKeys.checkInForm(subject), conflict)
      // Clears the card as well as the error. The choice has been made; leaving the conflict
      // standing would ask the author to answer a question they have just answered.
      mutation.reset()
    },
    reset: mutation.reset,
  }
}
