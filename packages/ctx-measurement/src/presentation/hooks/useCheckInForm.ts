'use client'

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
  const queryClient = useQueryClient()

  const query = useQuery(checkInFormQuery(ports))

  const mutation = useMutation({
    mutationFn: (form: CheckInFormSnapshot) => ports.measurement.saveCheckInForm(form),
    onSuccess: (saved) => {
      queryClient.setQueryData(measurementKeys.checkInForm(), saved)
    },
  })

  return {
    form: query.data ?? null,
    isLoading: query.isPending,
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
