import {
  err,
  ok,
  type PlainDate,
  type PrescribedSessionId,
  type ProgramVersionId,
  type Result,
} from '@fitnessos/kernel'
import type { ScreeningVerdict } from './ScreeningVerdict'

/**
 * `PrescribedSession` — one session, with its dose already resolved. Immutable.
 *
 * Two ADRs meet here.
 *
 * **ADR-0013** — progression is a domain service. A `Block` holds an *intent*; resolution
 * consumes published derived indicators and stamps the resolved dose here. So this carries
 * concrete numbers, not a rule: by the time a session exists, the question "how much?" has
 * been answered and recorded. That is what makes a `PerformedSession` comparable to it later.
 *
 * **ADR-0021** — a `PrescribedSession` cannot be constructed without a `ScreeningVerdict`
 * covering its final resolved dose. Not "should have one": cannot be constructed. The verdict
 * is a required constructor argument and a `blocked` verdict is refused outright.
 *
 * The ordering in that second rule is the whole point, and it is easy to get backwards.
 * Screening the *intent* is worthless — an intent has no numbers to screen. Only the resolved
 * dose can be checked against a restriction, so screening has to happen after resolution and
 * before the session exists. A session that existed first and was screened afterwards would
 * have a window in which it was prescribable and unscreened, and that window is exactly where
 * someone gets hurt.
 */

const brand = Symbol('PrescribedSession')

export interface PrescribedItem {
  readonly id: string
  readonly movementName: string
  readonly order: number
  /** Resolved, not intended (ADR-0013). Concrete numbers. */
  readonly sets: number
  readonly reps: number
  /** Null for bodyweight or time-based work — not zero, which would mean "no load". */
  readonly loadKg: number | null
}

export interface PrescribedSession {
  readonly [brand]: true
  readonly id: PrescribedSessionId
  /** The immutable structure this came from (ADR-0008). */
  readonly programVersionId: ProgramVersionId
  readonly scheduledFor: PlainDate
  readonly items: readonly PrescribedItem[]
  /** Required by ADR-0021. Covers the resolved dose above, not the intent it came from. */
  readonly screening: ScreeningVerdict
}

export type PrescribedSessionError =
  | { readonly kind: 'no-items' }
  | { readonly kind: 'blocked-by-screening'; readonly basisWithheld: boolean }
  | { readonly kind: 'item-order-not-contiguous'; readonly orders: readonly number[] }
  | { readonly kind: 'sets-not-positive'; readonly itemId: string; readonly given: number }
  | { readonly kind: 'reps-not-positive'; readonly itemId: string; readonly given: number }
  | { readonly kind: 'load-not-positive'; readonly itemId: string; readonly given: number }

export interface PrescribedSessionInput {
  readonly id: PrescribedSessionId
  readonly programVersionId: ProgramVersionId
  readonly scheduledFor: PlainDate
  readonly items: readonly PrescribedItem[]
  readonly screening: ScreeningVerdict
}

export const prescribedSession = (
  input: PrescribedSessionInput,
): Result<PrescribedSession, PrescribedSessionError> => {
  /*
   * The ADR-0021 check runs FIRST, before any structural validation.
   *
   * Not for efficiency — for the message. A blocked session with malformed items should report
   * the block, because that is the fact that matters to whoever is looking. Reporting
   * "sets must be positive" for a session the athlete must not attempt at all would bury the
   * only thing worth acting on.
   */
  if (input.screening.level === 'blocked') {
    return err({
      kind: 'blocked-by-screening',
      // Carried through so the UI can distinguish "blocked, and here is why" from "blocked,
      // and you are not entitled to the reason" (ADR-0002/0014).
      basisWithheld: input.screening.basisWithheld,
    })
  }

  if (input.items.length === 0) {
    return err({ kind: 'no-items' })
  }

  for (const item of input.items) {
    if (!Number.isInteger(item.sets) || item.sets < 1) {
      return err({ kind: 'sets-not-positive', itemId: item.id, given: item.sets })
    }
    if (!Number.isInteger(item.reps) || item.reps < 1) {
      return err({ kind: 'reps-not-positive', itemId: item.id, given: item.reps })
    }
    if (item.loadKg !== null && item.loadKg <= 0) {
      // Zero is what an unresolved progression writes, and it is not the same as "bodyweight".
      // A session prescribing 0 kg would read as a mistake to the athlete and as a valid
      // number to anything computing volume.
      return err({ kind: 'load-not-positive', itemId: item.id, given: item.loadKg })
    }
  }

  const orders = input.items.map((i) => i.order)
  const distinct = new Set(orders)
  const expected = new Set(input.items.map((_, index) => index))
  if (distinct.size !== input.items.length || !orders.every((o) => expected.has(o))) {
    return err({ kind: 'item-order-not-contiguous', orders })
  }

  return ok({
    [brand]: true,
    id: input.id,
    programVersionId: input.programVersionId,
    scheduledFor: input.scheduledFor,
    items: Object.freeze([...input.items].sort((a, b) => a.order - b.order)),
    screening: input.screening,
  })
}

/** Total prescribed load. Derived, never stored (ADR-0006 generalises). */
export const totalVolumeKg = (session: PrescribedSession): number =>
  session.items.reduce(
    (sum, item) => sum + (item.loadKg === null ? 0 : item.loadKg * item.sets * item.reps),
    0,
  )
