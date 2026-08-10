/**
 * Measurement — what is true about the athlete's body and performance.
 *
 * Un-graduated: a folder in `packages/core` because it has no editor (handbook §2.1).
 *
 * Three ADRs shape everything here:
 *
 *   ADR-0016  ONE `Observation` aggregate with a closed sum-type `Acquisition`. Not one
 *             aggregate per measurement kind — they differ only in which fields are populated,
 *             which ADR-0022 says is a reason to collapse.
 *   ADR-0006  derivations are QUERIES. No stored trend, no stored staleness, no `status`. The
 *             estimated 1RM and every series statistic are computed at the moment they are
 *             asked, and there are tests asserting the fields stay absent.
 *   ADR-0013  progression consumes published derived indicators from here. That is why
 *             `IndicatorSeriesSnapshot` is a published language and not an internal shape.
 *
 * The interesting pair is `Acquisition` (closed) beside `IndicatorKind` (open). ADR-0020 permits
 * open vocabularies where the domain vocabulary is contested but not where variants differ in
 * required structure — and these two land on opposite sides of exactly that line.
 */
export * from './domain/Acquisition'
export * from './domain/IndicatorKind'
export * from './domain/Observation'
export * from './domain/oneRepMax'
export * from './domain/CheckInForm'
export * from './application/index'

/**
 * The editor. Measurement graduated to its own package for this (handbook §2.1): a context
 * graduates when it acquires one.
 */
export * from './editor/schema'
