import {
  err,
  ok,
  plainDateKey,
  type AthleteId,
  type ObservationId,
  type PlainDate,
  type Result,
} from '@fitnessos/kernel'
import type { Acquisition } from './Acquisition'
import type { IndicatorKind } from './IndicatorKind'

/**
 * `Observation` — a measured fact about an athlete at a moment (ADR-0016).
 *
 * **One aggregate for every kind of measurement**, not `BodyweightObservation` beside
 * `SleepObservation`. ADR-0022 is explicit: collapse when concepts differ only in which fields
 * are populated, split when they differ in invariants or transition authority. A bodyweight and
 * a waist girth have the same invariants and the same authority; splitting them would produce a
 * dozen aggregates that are one aggregate wearing different names.
 *
 * ## What is NOT here, and why
 *
 * There is no estimated 1RM, no trend, no rolling average, and no "is this stale" flag.
 * ADR-0006: derivations are queries, not state. An `Observation` records something someone
 * actually measured; anything computed from a set of them is computed at the moment it is
 * asked, by `oneRepMax.ts` and the read models. A stored derivation is wrong the instant a new
 * observation arrives, and something then has to write it.
 *
 * There is also no `athleteWeight` convenience field, no denormalised movement name, and no
 * link to the session that prompted it. ADR-0018's shape of rule applies generally here: a
 * measurement is a fact about a body, not about a programme.
 */

const brand = Symbol('Observation')

export interface Observation {
  readonly [brand]: true
  readonly id: ObservationId
  readonly athleteId: AthleteId
  readonly kind: IndicatorKind
  /**
   * The magnitude, with its unit, always.
   *
   * Invariant N11 — a measurement is never stored without its unit. Held as a plain value and
   * unit rather than the kernel's `Quantity<D>` because the KIND is an open vocabulary
   * (ADR-0020): this build cannot know the dimension of a kind it has never seen, and a type
   * that demanded one would make an unknown measurement unrepresentable rather than merely
   * uninterpretable.
   */
  readonly value: number
  readonly unit: string
  /**
   * The calendar day it describes.
   *
   * A day rather than an instant, deliberately. A bodyweight is a fact about a morning, not
   * about 07:14:32, and storing the precision we do not have invites comparisons between two
   * readings that differ only by when the athlete got out of bed.
   */
  readonly observedOn: PlainDate
  readonly acquisition: Acquisition
}

export type ObservationError =
  | { readonly kind: 'value-not-finite'; readonly given: number }
  | { readonly kind: 'value-negative'; readonly given: number }
  | { readonly kind: 'unit-missing' }
  | { readonly kind: 'indicator-kind-empty' }
  | { readonly kind: 'observed-in-the-future'; readonly observedOn: string; readonly today: string }

export interface ObservationInput {
  readonly id: ObservationId
  readonly athleteId: AthleteId
  readonly kind: IndicatorKind
  readonly value: number
  readonly unit: string
  readonly observedOn: PlainDate
  readonly acquisition: Acquisition
  /** Today, passed in. Never `Date.now()` in a use case — see the ports header. */
  readonly today: PlainDate
}

export const observation = (input: ObservationInput): Result<Observation, ObservationError> => {
  if (!Number.isFinite(input.value)) return err({ kind: 'value-not-finite', given: input.value })

  if (input.value < 0) {
    // No physical quantity this product measures is negative. A minus sign here is a typo or a
    // unit conversion that went wrong, and it would drag every average through zero.
    return err({ kind: 'value-negative', given: input.value })
  }

  if (input.unit.trim() === '') return err({ kind: 'unit-missing' })
  if (input.kind.trim() === '') return err({ kind: 'indicator-kind-empty' })

  const observedOn = plainDateKey(input.observedOn)
  const today = plainDateKey(input.today)
  if (observedOn > today) {
    /*
     * A measurement of the future is a data-entry mistake, and an expensive one: it sorts to the
     * end of every series forever, so it becomes "the latest value" for as long as it exists and
     * every trend is computed against it.
     *
     * Compared as ISO keys rather than by converting to `Date`. `new Date("2026-08-10")` parses
     * as UTC midnight, so in a negative-offset zone today's date compares as yesterday and an
     * athlete on the west coast cannot record this morning's weight.
     */
    return err({ kind: 'observed-in-the-future', observedOn, today })
  }

  return ok({
    [brand]: true,
    id: input.id,
    athleteId: input.athleteId,
    kind: input.kind.trim(),
    value: input.value,
    unit: input.unit.trim(),
    observedOn: input.observedOn,
    acquisition: input.acquisition,
  })
}
