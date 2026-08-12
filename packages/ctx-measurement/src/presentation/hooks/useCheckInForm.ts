'use client'

import { useSubject } from '@fitnessos/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  checkInFormQuery,
  measurementKeys,
  type CheckInFormSnapshot,
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
  /** Resolves TRUE when the save reached the server — what moves the editor's commit boundary. */
  readonly save: (form: CheckInFormSnapshot) => Promise<boolean>
  readonly isSaving: boolean
  readonly error: Error | null
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
 */
export const useCheckInForm = (): UseCheckInForm => {
  const ports = useMeasurementPorts()
  const subject = useSubject()
  const queryClient = useQueryClient()

  const query = useQuery(checkInFormQuery(ports, subject))

  const mutation = useMutation({
    mutationFn: (form: CheckInFormSnapshot) => ports.measurement.saveCheckInForm(form),
    onSuccess: (saved) => {
      queryClient.setQueryData(measurementKeys.checkInForm(subject), saved)
    },
  })

  return {
    form: query.data ?? null,
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
    error: mutation.error,
  }
}
