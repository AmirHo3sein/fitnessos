import { err, ok, type Result } from '@fitnessos/kernel'

/**
 * How a measurement came to be known (ADR-0016).
 *
 * ## Why this is CLOSED while `IndicatorKind` next door is open
 *
 * ADR-0020 permits open vocabularies where the domain vocabulary is contested, and adds that it
 * "does not apply where variants differ in required structure". These variants do: a
 * self-report has no source to name, a device reading is meaningless without knowing which
 * device, and a practitioner reading is meaningless without knowing who. Each carries different
 * required fields, so each is a distinct shape rather than a label on one shape.
 *
 * What is measured is the opposite case — bodyweight, waist, sleep duration all have identical
 * structure and the list is genuinely contested — so that one is open. The two decisions sit
 * beside each other on purpose.
 *
 * ## Why provenance is modelled at all
 *
 * Because it changes what a number means. An athlete's stated bodyweight and a clinic scale's
 * reading are not interchangeable inputs to a progression decision, and a system that stored
 * only the number would make them so. ADR-0023: cross-context quality signals are published as
 * coarse stable vocabularies — this is that vocabulary for Measurement, and it is deliberately
 * three words rather than a confidence score.
 */

const brand = Symbol('Acquisition')

export interface SelfReported {
  readonly [brand]: true
  readonly kind: 'self-reported'
}

export interface DeviceReading {
  readonly [brand]: true
  readonly kind: 'device'
  /**
   * What produced it — "withings-scale", "apple-health". An opaque identifier, not a display
   * name: names are catalogue data and change, and ADR-0012 makes display-name snapshots
   * time-boxed debt.
   */
  readonly source: string
}

export interface PractitionerReading {
  readonly [brand]: true
  readonly kind: 'practitioner'
  /** Who recorded it. The audit trail ADR-0003 requires wherever a human decided something. */
  readonly recordedBy: string
}

export type Acquisition = SelfReported | DeviceReading | PractitionerReading

export type AcquisitionError =
  | { readonly kind: 'source-empty' }
  | { readonly kind: 'recorded-by-empty' }

export const selfReported = (): Acquisition => ({ [brand]: true, kind: 'self-reported' })

export const deviceReading = (source: string): Result<Acquisition, AcquisitionError> => {
  // An empty source is worse than no source: it claims a device reading while naming nothing,
  // so the value looks more trustworthy than a self-report and is less traceable.
  if (source.trim() === '') return err({ kind: 'source-empty' })
  return ok({ [brand]: true, kind: 'device', source: source.trim() })
}

export const practitionerReading = (
  recordedBy: string,
): Result<Acquisition, AcquisitionError> => {
  if (recordedBy.trim() === '') return err({ kind: 'recorded-by-empty' })
  return ok({ [brand]: true, kind: 'practitioner', recordedBy: recordedBy.trim() })
}

/**
 * Whether a value was produced by an instrument rather than a person's estimate.
 *
 * Not a confidence score, and deliberately not called one. It is a fact about provenance that
 * another context may act on however it chooses; a number would invite arithmetic on it, and
 * ADR-0023 keeps internal scores internal.
 */
export const isInstrumented = (acquisition: Acquisition): boolean =>
  acquisition.kind !== 'self-reported'
