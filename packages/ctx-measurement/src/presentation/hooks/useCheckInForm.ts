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
  readonly conflict: CheckInFormSnapshot | null
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
    mutationFn: (form: CheckInFormSnapshot) => {
      /*
       * Read from the cache at call time rather than closing over `query.data`, so two saves in
       * succession send the revision the FIRST one returned. A closure captured at render would
       * still hold the pre-save revision if the second save fires before React re-renders, and
       * the second write would 409 against a revision this very client replaced.
       *
       * Null when nothing has been read: a first save, which carries no precondition because
       * there is nothing yet to collide with (BACKEND-CONTRACT §2.1a).
       */
      const loaded = queryClient.getQueryData<Loaded<CheckInFormSnapshot> | null>(
        measurementKeys.checkInForm(subject),
      )
      return ports.measurement.saveCheckInForm(form, loaded?.revision ?? null)
    },
    onSuccess: (saved) => {
      // The ENVELOPE, not the form. The response is the new state including its new revision, and
      // storing the form alone would leave the next save sending the revision it just superseded.
      queryClient.setQueryData(measurementKeys.checkInForm(subject), saved)
    },
  })

  return {
    form: query.data?.artefact ?? null,
    isLoading: query.isPending,
    loadFailed: query.isError,
    retry: () => {
      void query.refetch()
    },
    save: async (form) => {
      try {
        await mutation.mutateAsync(form)
        return true
      } catch {
        return false
      }
    },
    isSaving: mutation.isPending,
    // A conflict is reported through `conflict`, so it must not also arrive as an error.
    error: mutation.error instanceof CheckInFormConflictError ? null : mutation.error,
    /*
     * The colliding form is NOT written into the cache, deliberately. The cache is what the
     * workspace reads and hydrates from, so storing the server's version would replace the
     * author's open document with the one that beat it — the unsaved work this refusal exists to
     * protect. It stays here, beside the editor's own copy, until something is built to resolve
     * the two.
     */
    conflict:
      mutation.error instanceof CheckInFormConflictError ? mutation.error.current.artefact : null,
  }
}
