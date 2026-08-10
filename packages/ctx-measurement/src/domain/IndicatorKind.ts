/**
 * What was measured — an OPEN vocabulary (ADR-0020).
 *
 * Open because the list is genuinely contested and every variant has identical structure: a
 * magnitude with a unit at an instant. Bodyweight, waist girth, sleep duration and a dozen
 * things a practitioner will want next differ only in what they are called and which dimension
 * they carry, which is exactly ADR-0022's "collapse when concepts differ only in which fields
 * are populated".
 *
 * The consequence is that a kind arriving from the backend that this build has never heard of is
 * DATA, not an error. Tolerant reader: the client renders it with whatever label the catalogue
 * supplies and does not pretend to know its meaning.
 *
 * `Acquisition` sits beside this and is closed, because its variants genuinely differ in
 * required structure. Two vocabularies, two answers, one rule.
 */
export type IndicatorKind = string

/**
 * The kinds this build understands well enough to reason about, as opposed to merely display.
 *
 * Named constants rather than a union type, so nothing narrows to them. Their only privilege is
 * that code may reference them by name; an unknown kind still flows through every read path.
 */
export const KNOWN_INDICATORS = {
  bodyweight: 'bodyweight',
  /** Estimated one-rep max for a movement. DERIVED, never recorded — see `oneRepMax.ts`. */
  estimatedOneRepMax: 'estimated-1rm',
} as const

/**
 * Which physical dimension a kind is measured in, when this build knows.
 *
 * `null` for an unrecognised kind, which is not a failure: it means "render the number and its
 * unit as given, and do not attempt arithmetic on it". A client that guessed a dimension here
 * would eventually add a duration to a mass and get a plausible-looking number.
 */
export const dimensionOf = (kind: IndicatorKind): 'mass' | 'length' | 'duration' | null => {
  if (kind === KNOWN_INDICATORS.bodyweight) return 'mass'
  if (kind === KNOWN_INDICATORS.estimatedOneRepMax) return 'mass'
  return null
}
