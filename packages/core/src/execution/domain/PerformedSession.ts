import {
  err,
  ok,
  type PerformedSessionId,
  type PlainDate,
  type PrescribedSessionId,
  type Result,
} from '@fitnessos/kernel'

/**
 * What the athlete actually did.
 *
 * The counterpart to `PrescribedSession`, and the reason that one is immutable: this record is
 * only meaningful against a structure that cannot change afterwards. If the prescription could be
 * edited later you could no longer tell whether the athlete under-performed or the target moved.
 *
 * ## What this deliberately does NOT constrain
 *
 * The instinct is to validate this against the prescription — same number of sets, same
 * movements, same day. Every one of those would be wrong, and each corresponds to something
 * athletes do constantly:
 *
 * - **Fewer sets than prescribed.** The most informative log in the product. An athlete who
 *   stopped at three of five sets is telling you something, and a system that refuses the record
 *   has thrown away the signal to protect a symmetry nobody asked for.
 * - **More sets than prescribed.** Also normal, and also information.
 * - **A different day.** Monday's session performed on Tuesday is a completed session, not an
 *   error. `performedOn` is independent of the prescription's `scheduledFor`.
 *
 * So the invariants here are about internal coherence — a set has positive reps, set numbers do
 * not collide — and nothing else. The comparison between prescribed and performed is an
 * *analysis*, and analyses belong in Measurement, not in a constructor that can refuse to record
 * what happened.
 */

const brand = Symbol('PerformedSession')

export interface PerformedSet {
  readonly id: string
  /** Which prescribed item this was an attempt at. */
  readonly prescribedItemId: string
  /** 1-based, as an athlete counts. Must be unique within an item, and may skip. */
  readonly setNumber: number
  readonly reps: number
  /** Null for bodyweight. Never zero — see the note in PrescribedSession. */
  readonly loadKg: number | null
  /** Rate of perceived exertion, 1–10 in halves. Null when not asked for. */
  readonly rpe: number | null
}

export interface PerformedSession {
  readonly [brand]: true
  /**
   * CLIENT-generated UUIDv7 (D-10). This is the idempotency key: a queued log replayed after a
   * lost response arrives with the same id, and the server's 409 is what makes at-least-once
   * delivery safe.
   */
  readonly id: PerformedSessionId
  readonly prescribedSessionId: PrescribedSessionId
  /** Independent of the prescription's scheduledFor. Monday's session can happen on Tuesday. */
  readonly performedOn: PlainDate
  readonly sets: readonly PerformedSet[]
  /** The athlete's own words about the session. Never generated, never required. */
  readonly note: string | null
}

export type PerformedSessionError =
  | { readonly kind: 'no-sets' }
  | { readonly kind: 'reps-not-positive'; readonly setId: string; readonly given: number }
  | { readonly kind: 'load-not-positive'; readonly setId: string; readonly given: number }
  | { readonly kind: 'rpe-out-of-range'; readonly setId: string; readonly given: number }
  | { readonly kind: 'duplicate-set'; readonly itemId: string; readonly setNumber: number }

/** RPE is a 1–10 scale recorded in halves. 7.25 is not a value anyone means. */
const isValidRpe = (rpe: number) => rpe >= 1 && rpe <= 10 && Number.isInteger(rpe * 2)

export interface PerformedSessionInput {
  readonly id: PerformedSessionId
  readonly prescribedSessionId: PrescribedSessionId
  readonly performedOn: PlainDate
  readonly sets: readonly PerformedSet[]
  readonly note: string | null
}

export const performedSession = (
  input: PerformedSessionInput,
): Result<PerformedSession, PerformedSessionError> => {
  if (input.sets.length === 0) {
    // A session with no sets is not a session that went badly — it is a form that was opened and
    // closed. "I did none of it" is recorded by not logging, or by a future skip reason.
    return err({ kind: 'no-sets' })
  }

  const seen = new Set<string>()
  for (const set of input.sets) {
    if (!Number.isInteger(set.reps) || set.reps < 1) {
      return err({ kind: 'reps-not-positive', setId: set.id, given: set.reps })
    }
    if (set.loadKg !== null && set.loadKg <= 0) {
      return err({ kind: 'load-not-positive', setId: set.id, given: set.loadKg })
    }
    if (set.rpe !== null && !isValidRpe(set.rpe)) {
      return err({ kind: 'rpe-out-of-range', setId: set.id, given: set.rpe })
    }

    const key = `${set.prescribedItemId}#${String(set.setNumber)}`
    if (seen.has(key)) {
      // Two sets numbered 3 for the same movement is a double-submit, not a real record. Set
      // numbers may SKIP — an athlete who does sets 1, 2 and 5 has done three sets — but they
      // cannot collide.
      return err({ kind: 'duplicate-set', itemId: set.prescribedItemId, setNumber: set.setNumber })
    }
    seen.add(key)
  }

  const note = input.note === null || input.note.trim() === '' ? null : input.note.trim()

  return ok({
    [brand]: true,
    id: input.id,
    prescribedSessionId: input.prescribedSessionId,
    performedOn: input.performedOn,
    sets: Object.freeze(
      [...input.sets].sort((a, b) =>
        a.prescribedItemId === b.prescribedItemId
          ? a.setNumber - b.setNumber
          : a.prescribedItemId < b.prescribedItemId
            ? -1
            : 1,
      ),
    ),
    note,
  })
}

/** Total load actually moved. Derived, never stored. */
export const performedVolumeKg = (session: PerformedSession): number =>
  session.sets.reduce((sum, set) => sum + (set.loadKg === null ? 0 : set.loadKg * set.reps), 0)

/** Completed sets for a given prescribed item. */
export const setsForItem = (session: PerformedSession, itemId: string): readonly PerformedSet[] =>
  session.sets.filter((set) => set.prescribedItemId === itemId)
