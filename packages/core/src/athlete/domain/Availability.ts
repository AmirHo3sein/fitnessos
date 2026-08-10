import {
  err,
  isOk,
  ok,
  seconds,
  toBase,
  type Quantity,
  type Result,
} from '@fitnessos/kernel'

/**
 * What an athlete can actually commit to. A value object with invariants, unlike
 * `AvailabilitySnapshot`, which is a read model and has none.
 *
 * That split is deliberate and is the same principle as the non-strict response
 * schemas: **tolerant reader, strict writer.** Reading an athlete produces a snapshot
 * that accepts whatever the backend holds, including data written before a rule
 * existed. Writing one goes through this constructor, which refuses anything the rules
 * forbid. A single type doing both jobs would force a choice between rejecting
 * historical data on read and accepting nonsense on write.
 *
 * These rules are not validation for a form's benefit. Availability is the primary
 * input to prescription — a programme is built against the days and the ceiling the
 * athlete stated — so a nonsense value here produces a nonsense programme, and the
 * athlete experiences that as the product not understanding them.
 */

/**
 * A real symbol, not `declare const brand: unique symbol`.
 *
 * The declared form is right for branding a primitive (`string & { [brand]: … }`),
 * because the brand is purely a type-level fiction and the value is just a string. It
 * does NOT work for an object: the constructor cannot assign a property that only
 * exists in the type system, so building one requires `as unknown as Availability` —
 * a double cast that suppresses exactly the check the brand was added to provide.
 *
 * A real symbol can be assigned, and because it is not exported, no code outside this
 * module can produce a value that satisfies the type. Unforgeable, with no cast.
 * It also never reaches the wire: `JSON.stringify` skips symbol keys, and
 * `availabilityToInput` maps fields explicitly regardless.
 */
const brand = Symbol('Availability')

export interface Availability {
  readonly [brand]: true
  readonly daysPerWeek: number
  /** Null when the athlete stated no ceiling. Never zero — see the error kinds. */
  readonly sessionCeiling: Quantity<'duration'> | null
  readonly equipmentAccess: readonly string[]
}

export type AvailabilityError =
  | { readonly kind: 'days-out-of-range'; readonly given: number }
  | { readonly kind: 'days-not-whole'; readonly given: number }
  | { readonly kind: 'ceiling-too-short'; readonly givenSeconds: number; readonly minSeconds: number }
  | { readonly kind: 'ceiling-not-positive'; readonly givenSeconds: number }

/**
 * Ten minutes. Below this a session cannot contain a warm-up and a working set, so a
 * programme built against it would be unfollowable — and the athlete would conclude
 * the product does not know what training is.
 *
 * Matches the spec's `minimum: 600` on `sessionCeilingSeconds`, so the domain rule and
 * the contract agree rather than the domain being stricter for no stated reason.
 */
export const MIN_SESSION_CEILING_SECONDS = 600

export interface AvailabilityInput {
  readonly daysPerWeek: number
  readonly sessionCeilingSeconds: number | null
  readonly equipmentAccess: readonly string[]
}

export const availability = (
  input: AvailabilityInput,
): Result<Availability, AvailabilityError> => {
  const { daysPerWeek, sessionCeilingSeconds } = input

  if (!Number.isInteger(daysPerWeek)) {
    // 3.5 days a week is a reasonable thing for a person to mean and an impossible
    // thing for a scheduler to act on. Rejecting it here forces the ambiguity to be
    // resolved by the athlete rather than by a rounding rule nobody chose.
    return err({ kind: 'days-not-whole', given: daysPerWeek })
  }
  if (daysPerWeek < 1 || daysPerWeek > 7) {
    return err({ kind: 'days-out-of-range', given: daysPerWeek })
  }

  let ceiling: Quantity<'duration'> | null = null
  if (sessionCeilingSeconds !== null) {
    if (sessionCeilingSeconds <= 0) {
      // Zero is the value a half-finished form submits, and it means "cannot train at
      // all" — which is a different statement from "no ceiling" and must not be
      // silently treated as one.
      return err({ kind: 'ceiling-not-positive', givenSeconds: sessionCeilingSeconds })
    }
    if (sessionCeilingSeconds < MIN_SESSION_CEILING_SECONDS) {
      return err({
        kind: 'ceiling-too-short',
        givenSeconds: sessionCeilingSeconds,
        minSeconds: MIN_SESSION_CEILING_SECONDS,
      })
    }
    const q = seconds(sessionCeilingSeconds)
    if (!isOk(q)) return err({ kind: 'ceiling-not-positive', givenSeconds: sessionCeilingSeconds })
    ceiling = q.value
  }

  return ok({
    [brand]: true,
    daysPerWeek,
    sessionCeiling: ceiling,
    // Deduplicated and ordered, so two athletes who selected the same equipment in a
    // different order produce the same value. Without this, equality and any future
    // caching keyed on availability would depend on click order.
    equipmentAccess: [...new Set(input.equipmentAccess)].sort(),
  })
}

/** Back to the wire representation. The inverse of what the read mapper produces. */
export const availabilityToInput = (value: Availability): AvailabilityInput => ({
  daysPerWeek: value.daysPerWeek,
  sessionCeilingSeconds: value.sessionCeiling === null ? null : toBase(value.sessionCeiling),
  equipmentAccess: value.equipmentAccess,
})
