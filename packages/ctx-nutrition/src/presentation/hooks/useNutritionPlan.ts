'use client'

import { useSubject } from '@fitnessos/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  currentNutritionPlanQuery,
  NutritionConflictError,
  nutritionKeys,
  type Loaded,
} from '../../application/index'
import type { NutritionSnapshot } from '../../editor/schema'
import { useNutritionPorts } from '../di'

export interface UseNutritionPlan {
  readonly plan: NutritionSnapshot | null
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
   * FALSE on a conflict as well, because a conflict did not save. Why it failed is in `conflict`
   * rather than in the boolean: the caller's question here is only whether to commit.
   */
  readonly save: (plan: NutritionSnapshot) => Promise<boolean>
  readonly isSaving: boolean
  readonly error: Error | null
  /**
   * The plan as the server holds it, when a save collided with another author.
   *
   * Separate from `error` because nothing broke — someone else got there first, and both documents
   * exist. Reported through both would be a screen showing "we could not store your change" beside
   * the resolution it contradicts.
   *
   * The ENVELOPE, unlike `plan`: resolving a conflict eventually means saving over what is stored,
   * and that save must quote the revision this collision revealed. A bare snapshot would leave the
   * only base revision in reach the stale one that caused the collision.
   */
  readonly conflict: Loaded<NutritionSnapshot> | null
  /**
   * KEEP MINE — send the author's plan again, onto the revision the collision revealed.
   *
   * The plan is passed in rather than read from anywhere here, because the hook never holds the
   * document being edited: it lives in the editor store, and only the caller that handed it to
   * `save` still has it.
   *
   * Why this cannot be "press Save again": `save` quotes the revision the CACHE holds, which is
   * still the stale one that collided — every retry would answer 409 for the same reason, and the
   * author would be stuck with work they cannot store. Quoting `conflict.revision` is the whole
   * difference between resolving the collision and repeating it.
   *
   * Deliberately an overwrite. The other author's version is not lost — it is a revision on the
   * server — and the author choosing this has been told what they are doing (ADR-0033).
   */
  readonly keepMine: (plan: NutritionSnapshot) => Promise<boolean>
  /**
   * TAKE THEIRS — adopt the server's plan, discarding the local one.
   *
   * Nothing is sent: the server already holds this document at this revision, so a save would be a
   * round trip that changes nothing except the revision every other reader is quoting.
   */
  readonly takeTheirs: () => void
  /**
   * Clear `error` and `conflict`.
   *
   * Needed because a conflict is mutation state, and mutation state only changes when another
   * mutation runs. Without this the dialog could be left only by saving — so an author who wanted
   * to keep editing and decide later would have to choose between two resolutions to get rid of
   * the question, which is the one thing a conflict dialog must never force.
   */
  readonly reset: () => void
}

/**
 * A save and the precondition it asserts, travelling together.
 *
 * The revision is a mutation VARIABLE rather than read inside `mutationFn`, because the two saves
 * that exist quote different ones: an ordinary save quotes what was read, and a resolution quotes
 * what the collision revealed. Reading it from the cache inside the mutation would make the second
 * one unexpressible.
 */
interface SaveAttempt {
  readonly plan: NutritionSnapshot
  readonly baseRevision: number | null
}

export const useNutritionPlan = (): UseNutritionPlan => {
  const ports = useNutritionPorts()
  const subject = useSubject()
  const queryClient = useQueryClient()
  const query = useQuery(currentNutritionPlanQuery(ports, subject))

  const mutation = useMutation({
    mutationFn: ({ plan, baseRevision }: SaveAttempt) => ports.nutrition.save(plan, baseRevision),
    // Set, not invalidate: the response IS the new state — the ENVELOPE, so the next save carries
    // the revision this one produced instead of the stale one it replaced.
    onSuccess: (saved) => {
      queryClient.setQueryData(nutritionKeys.current(subject), saved)
    },
  })

  // A conflict is reported through `conflict`, so it must not also arrive as an error — a component
  // rendering both would show "something went wrong" beside what the author collided with, and only
  // one of those two is true.
  const conflict = mutation.error instanceof NutritionConflictError ? mutation.error.current : null

  const attempt = async (vars: SaveAttempt): Promise<boolean> => {
    try {
      await mutation.mutateAsync(vars)
      return true
    } catch {
      return false
    }
  }

  return {
    plan: query.data?.artefact ?? null,
    isLoading: query.isPending,
    loadFailed: query.isError,
    retry: () => {
      void query.refetch()
    },
    /*
      The base revision comes from the envelope this render was drawn from — the plan the author
      actually edited — and never from the editor, which is not told a revision exists (ADR-0035).
      `null` only where nothing was read, which is the first save and the one case with nothing to
      collide with; sent against a plan that exists it answers 409 rather than overwriting it.
    */
    save: (plan) => attempt({ plan, baseRevision: query.data?.revision ?? null }),
    isSaving: mutation.isPending,
    error: mutation.error instanceof NutritionConflictError ? null : mutation.error,
    conflict,
    // Nothing to keep mine OVER without a collision to answer, and inventing a precondition here
    // would turn a stray press into the blind overwrite the revision exists to prevent.
    keepMine: (plan) =>
      conflict === null
        ? Promise.resolve(false)
        : attempt({ plan, baseRevision: conflict.revision }),
    takeTheirs: () => {
      if (conflict === null) return
      // The envelope, so the next save quotes the revision this document actually has. Seeding the
      // cache with the bare artefact would leave the author editing the other version against the
      // precondition of the one they discarded — a second collision manufactured by the resolution.
      queryClient.setQueryData(nutritionKeys.current(subject), conflict)
      mutation.reset()
    },
    reset: mutation.reset,
  }
}
