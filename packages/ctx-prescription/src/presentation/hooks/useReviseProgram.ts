'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ProgramConflictError,
  programKeys,
  reviseProgram,
  type ProgramSnapshot,
  type ProgramVersionSnapshot,
} from '../../application/index'
import { usePrescriptionPorts } from '../di'

export interface UseReviseProgram {
  /**
   * Resolves TRUE when the revision reached the server.
   *
   * A boolean rather than a rejection: the failure is already reported through `error` and
   * `conflict`, and the caller's remaining question is only whether to move its commit boundary.
   * Rejecting as well would make every call site write a `catch` that discards what it caught.
   */
  readonly save: (next: ProgramVersionSnapshot) => Promise<boolean>
  readonly isSaving: boolean
  readonly error: Error | null
  /**
   * The programme as the server holds it, when a save collided with another author.
   *
   * Surfaced separately from `error` because it is not a failure the user should see as one —
   * nothing broke, someone else got there first, and the two versions both exist.
   */
  readonly conflict: ProgramSnapshot | null
  readonly reset: () => void
}

/**
 * Save a revision.
 *
 * The cache is SET from the response rather than invalidated: the mutation already returns the
 * server's own view of the programme, so refetching would spend a round trip to obtain data
 * already in hand — and leave a window in which the builder shows one version and the cache
 * another.
 *
 * `networkMode` is left at the default, unlike session logging. A revision asserts something
 * about the present (`baseVersionId` is still current), so it must fail while the author is
 * looking at it rather than be paused and replayed against a programme that has since moved.
 */
export const useReviseProgram = (base: ProgramVersionSnapshot): UseReviseProgram => {
  const ports = usePrescriptionPorts()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: (next: ProgramVersionSnapshot) => reviseProgram(ports, base, next),
    onSuccess: (program) => {
      queryClient.setQueryData(programKeys.current(), program)
    },
  })

  return {
    save: async (next) => {
      try {
        await mutation.mutateAsync(next)
        return true
      } catch {
        return false
      }
    },
    isSaving: mutation.isPending,
    // A conflict is reported through `conflict`, so it must not also arrive as an error — a
    // component rendering both would show "something went wrong" beside the resolution UI.
    error: mutation.error instanceof ProgramConflictError ? null : mutation.error,
    conflict: mutation.error instanceof ProgramConflictError ? mutation.error.current : null,
    reset: mutation.reset,
  }
}
