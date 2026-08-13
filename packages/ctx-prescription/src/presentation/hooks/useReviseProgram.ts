'use client'

import { useSubject } from '@fitnessos/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
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
  /**
   * Keep the author's work: send it again, based on the version the server just quoted back.
   *
   * The whole point of showing the collision, and it was missing. `reset()` alone only cleared the
   * error — the base stayed the one the server had already refused, so pressing Save again produced
   * the identical 409, for ever. The only way out was "discard", and because versions are immutable
   * (ADR-0008) the work discarded that way cannot be recovered.
   *
   * Resolves like `save` — FALSE if this attempt collided too, which happens when a third revision
   * landed in between and simply presents the newer conflict.
   */
  readonly keepMine: (next: ProgramVersionSnapshot) => Promise<boolean>
  /** Take the other author's version instead, discarding the local edit. */
  readonly takeTheirs: () => void
  /**
   * Dismiss the conflict without resolving it.
   *
   * `conflict` is derived from the mutation's last error, and a mutation holds that error until it
   * is reset or superseded — so nothing else can clear it. Without this the panel would have no way
   * to close, and an author who wanted to read their own blocks first would be doing it through a
   * card they cannot get rid of.
   */
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
export const useReviseProgram = (opened: ProgramVersionSnapshot): UseReviseProgram => {
  const ports = usePrescriptionPorts()
  const subject = useSubject()
  const queryClient = useQueryClient()

  /*
    What this revision is based on.

    A ref seeded ONCE, and it moves in exactly one circumstance: the author saw a conflict panel and
    chose to keep their own work. That is an informed act — they were shown what they collided with
    — which is what separates it from re-binding to whatever the query currently holds. The latter
    is the silent overwrite `EditingSession` is split out to prevent: a save begun against version 3
    would arrive claiming version 4 as its base and quietly replace the revision it was supposed to
    conflict with.
  */
  const base = useRef(opened)

  const mutation = useMutation({
    // The base travels WITH the call rather than being read from this render's closure, because
    // `keepMine` advances it and then saves in the same tick.
    mutationFn: ({ from, next }: { from: ProgramVersionSnapshot; next: ProgramVersionSnapshot }) =>
      reviseProgram(ports, from, next),
    onSuccess: (program) => {
      queryClient.setQueryData(programKeys.current(subject), program)
      base.current = program.currentVersion
    },
  })

  const attempt = async (next: ProgramVersionSnapshot) => {
    try {
      await mutation.mutateAsync({ from: base.current, next })
      return true
    } catch {
      return false
    }
  }

  const collided = mutation.error instanceof ProgramConflictError ? mutation.error.current : null

  return {
    save: attempt,
    keepMine: async (next) => {
      if (collided === null) return false
      /*
        The base moves; the CACHE does not, and that asymmetry is deliberate.

        The six artefact workspaces adopt the server's envelope here, because their precondition
        lives in the cache. A programme's does not — it lives on this ref — and the builder
        hydrates from `currentVersion.id` (`ProgramBuilder`, keyed on it). Writing the other
        author's programme into the cache would therefore re-hydrate the editor from THEIR blocks
        and destroy the very work this button exists to keep.
      */
      base.current = collided.currentVersion
      return attempt(next)
    },
    takeTheirs: () => {
      if (collided === null) return
      // Here adopting IS the point: the builder re-keys on the new `currentVersion.id` and the
      // author sees the version they chose, rather than going on editing the one they discarded.
      queryClient.setQueryData(programKeys.current(subject), collided)
      base.current = collided.currentVersion
      // Cleared explicitly: adopting changes the cache, which the mutation's error knows nothing
      // about, so the panel would otherwise stay open over a programme that is no longer contested.
      mutation.reset()
    },
    reset: mutation.reset,
    isSaving: mutation.isPending,
    // A conflict is reported through `conflict`, so it must not also arrive as an error — a
    // component rendering both would show "something went wrong" beside the resolution UI.
    error: mutation.error instanceof ProgramConflictError ? null : mutation.error,
    conflict: collided,
  }
}
