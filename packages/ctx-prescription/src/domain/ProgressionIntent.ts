import { err, ok, type Result } from '@fitnessos/kernel'

/**
 * How a block is meant to get harder over time. A DECLARATION of intent, not a computed
 * dose.
 *
 * ADR-0013 is the constraint: progression is a **domain service**, not aggregate behaviour,
 * because resolving it depends on data outside this aggregate — published derived
 * indicators from Measurement. So a `Block` holds an *intent*, and the resolved dose is
 * stamped on the immutable `PrescribedSession` at the moment it is generated.
 *
 * That split is why there is no `resolve()` method here. A method would have to reach for
 * indicators, which would either pull Measurement into this context or require the block to
 * hold a stale copy of them. The intent is inert on purpose.
 */

const brand = Symbol('ProgressionIntent')

/**
 * Deliberately a small closed set rather than an expression language.
 *
 * ADR-0020 permits open vocabularies where the domain vocabulary is contested, but adds:
 * "does not apply where variants differ in required structure". These do — a percentage
 * ramp needs a rate, a fixed block needs nothing, and an autoregulated block needs a
 * target range. So the variants are closed and each carries its own fields.
 */
export type ProgressionKind = 'fixed' | 'linear' | 'autoregulated'

export interface ProgressionIntent {
  readonly [brand]: true
  readonly kind: ProgressionKind
  /**
   * Percent increase per cycle, for `linear` only. Null for the others.
   *
   * Percent rather than absolute, because the same absolute increment is trivial for one
   * athlete and impossible for another, and the block does not know which athlete it is
   * for — that is resolved later against indicators.
   */
  readonly ratePercent: number | null
}

export type ProgressionIntentError =
  | { readonly kind: 'rate-required'; readonly progression: ProgressionKind }
  | { readonly kind: 'rate-not-applicable'; readonly progression: ProgressionKind }
  | { readonly kind: 'rate-out-of-range'; readonly given: number; readonly max: number }

/**
 * Twenty percent per cycle. Not a limit on ambition — a limit on a typo.
 *
 * `50` meaning "50kg" typed into a percent field would compound into a prescription no
 * athlete can follow, and the athlete would experience that as the product not
 * understanding training. The bound turns it into a question at the point of authoring.
 */
export const MAX_RATE_PERCENT = 20

export const progressionIntent = (
  kind: ProgressionKind,
  ratePercent: number | null,
): Result<ProgressionIntent, ProgressionIntentError> => {
  if (kind === 'linear') {
    if (ratePercent === null) return err({ kind: 'rate-required', progression: kind })
    if (ratePercent <= 0 || ratePercent > MAX_RATE_PERCENT) {
      return err({ kind: 'rate-out-of-range', given: ratePercent, max: MAX_RATE_PERCENT })
    }
    return ok({ [brand]: true, kind, ratePercent })
  }

  // A rate on a fixed or autoregulated block is not harmless — it reads as meaningful to
  // whoever opens the programme next, and would be silently ignored at resolution.
  if (ratePercent !== null) return err({ kind: 'rate-not-applicable', progression: kind })

  return ok({ [brand]: true, kind, ratePercent: null })
}
