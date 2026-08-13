'use client'

import { useSubject } from '@fitnessos/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  currentPlanQuery,
  PlanConflictError,
  timelineKeys,
  type Loaded,
} from '../../application/index'
import type { PlanSnapshot } from '../../editor/schema'
import { useTimelinePorts } from '../di'

/**
 * One write, and what it claims to be replacing.
 *
 * A collision is resolved by writing AGAIN, onto the revision the server just named — so the base
 * cannot always be read from the cache. `resolve` carries it; a plain `save` still reads the cache
 * at mutate time, for the reason given on `mutationFn`.
 */
type Attempt =
  | { readonly kind: 'save'; readonly plan: PlanSnapshot }
  | { readonly kind: 'resolve'; readonly plan: PlanSnapshot; readonly onto: number | null }

export interface UsePlan {
  readonly plan: PlanSnapshot | null
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
   * FALSE also covers a collision, because a refused save did not save. The caller reads `conflict`
   * to learn which of the two it was.
   */
  readonly save: (plan: PlanSnapshot) => Promise<boolean>
  readonly isSaving: boolean
  readonly error: Error | null
  /**
   * The plan as the server holds it, when a save collided with another author (§2.1a).
   *
   * Surfaced separately from `error` because it is not a failure the reader should see as one —
   * nothing broke, someone else got there first, and both versions still exist.
   *
   * The envelope, not the snapshot: resolving a collision ends in a save, and that save must assert
   * the revision it is replacing. Without it the author could see what they collided with and still
   * not keep their own work.
   */
  readonly conflict: Loaded<PlanSnapshot> | null
  /**
   * Resolve the collision by keeping the author's document — written onto the revision it collided
   * with, which is the only base the server will now accept.
   *
   * Retrying `save` cannot do this. `save` reads its base from the cache, and the cache still holds
   * the revision that just lost, so every retry would answer 409 for the same reason and the author
   * would be stuck looking at work they cannot store.
   *
   * FALSE if the second write collided in turn — someone saved again in the seconds it took to
   * decide — which leaves a fresh `conflict` and the same choice, rather than a dead end.
   */
  readonly keepMine: () => Promise<boolean>
  /**
   * Resolve it the other way: adopt the plan the server holds and let the local document go.
   *
   * This is the ONE place the colliding plan is written to the cache. Everywhere else that would be
   * data loss — see the note on `conflict` — but here it is what the author asked for.
   */
  readonly takeTheirs: () => void
  /**
   * Dismiss the collision without resolving it, leaving the local document untouched.
   *
   * Needed because `conflict` is DERIVED from the mutation's error: nothing but a new write or this
   * would ever clear it, so without a reset the dialog would sit there permanently after the author
   * had read it. It clears `error` too — both come from the same failed write.
   */
  readonly reset: () => void
}

export const usePlan = (): UsePlan => {
  const ports = useTimelinePorts()
  const subject = useSubject()
  const queryClient = useQueryClient()
  const query = useQuery(currentPlanQuery(ports, subject))

  const mutation = useMutation({
    /*
      The revision comes from the CACHE at mutate time, not from `query.data` closed over by this
      render. Two saves in a row would otherwise both assert the revision read before the first,
      and the second would 409 against a plan this client itself had just written.

      The editor never sees it: `save` still takes a snapshot, and the precondition is supplied
      here, beside the document rather than inside it (ADR-0035).
    */
    mutationFn: (attempt: Attempt) =>
      ports.timeline.save(
        attempt.plan,
        attempt.kind === 'resolve'
          ? attempt.onto
          : (queryClient.getQueryData<Loaded<PlanSnapshot> | null>(timelineKeys.current(subject))
              ?.revision ?? null),
      ),
    // Set, not invalidate: the response IS the new state — including the revision the next save
    // must assert, which is why the envelope is stored rather than the plan alone.
    onSuccess: (saved) => {
      queryClient.setQueryData(timelineKeys.current(subject), saved)
    },
  })

  const collision = mutation.error instanceof PlanConflictError ? mutation.error.current : null

  return {
    plan: query.data?.artefact ?? null,
    isLoading: query.isPending,
    loadFailed: query.isError,
    retry: () => {
      void query.refetch()
    },
    save: async (plan) => {
      try {
        await mutation.mutateAsync({ kind: 'save', plan })
        return true
      } catch {
        return false
      }
    },
    isSaving: mutation.isPending,
    // A collision is reported through `conflict`, so it must not also arrive as an error — a
    // workspace rendering both would show "we could not store your change" beside the resolution UI.
    error: mutation.error instanceof PlanConflictError ? null : mutation.error,
    /*
      Deliberately NOT written into the cache. The cache is what the builder hydrates from, so
      storing the server's plan here would swap the document out from under an author mid-edit —
      losing exactly the work this exists to protect. It stays beside the editor until the author
      decides, and the revision it carries is what makes deciding "keep mine" possible.
    */
    conflict: collision,
    keepMine: async () => {
      /*
        The document comes from the mutation's own variables — it IS the write that collided, kept
        by react-query after the failure. The alternative was for the workspace to hold a second
        copy of whatever the editor last handed over, which is the same fact stored twice and one
        of them able to go stale.
      */
      const mine = mutation.variables?.plan
      if (collision === null || mine === undefined) return false
      try {
        await mutation.mutateAsync({ kind: 'resolve', plan: mine, onto: collision.revision })
        return true
      } catch {
        return false
      }
    },
    takeTheirs: () => {
      if (collision === null) return
      // The envelope, not the plan alone: the revision it carries is what the author's next save
      // must assert, and dropping it here would make the very next write collide again.
      queryClient.setQueryData(timelineKeys.current(subject), collision)
      mutation.reset()
    },
    reset: mutation.reset,
  }
}
