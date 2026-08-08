import { type Result, err, ok } from '../result/index'

/**
 * Quantity — magnitude plus unit, dimension-checked at compile time.
 *
 * Invariant N11: a measurement is never stored without its unit. This type makes
 * a unitless magnitude unrepresentable, and makes adding a mass to a length a
 * compile error rather than a silently wrong number.
 *
 * Formatting is deliberately absent. Presentation formats; the kernel converts
 * (snapshot rule S2 — presentation is projected, never embedded).
 */

export const UNITS = {
  mass: { kg: 1, g: 0.001, lb: 0.45359237 },
  length: { cm: 1, mm: 0.1, m: 100, in: 2.54 },
  duration: { s: 1, ms: 0.001, min: 60, h: 3600 },
  distance: { m: 1, km: 1000, mi: 1609.344 },
} as const

export type Dimension = keyof typeof UNITS
export type UnitOf<D extends Dimension> = keyof (typeof UNITS)[D]

export interface Quantity<D extends Dimension> {
  readonly dimension: D
  readonly value: number
  readonly unit: UnitOf<D>
}

export type QuantityError =
  | { kind: 'not-finite'; value: number }
  | { kind: 'negative-not-allowed'; value: number }

const factor = <D extends Dimension>(dimension: D, unit: UnitOf<D>): number =>
  (UNITS[dimension] as Record<string, number>)[unit as string] as number

export const quantity = <D extends Dimension>(
  dimension: D,
  value: number,
  unit: UnitOf<D>,
): Result<Quantity<D>, QuantityError> => {
  if (!Number.isFinite(value)) return err({ kind: 'not-finite', value })
  return ok({ dimension, value, unit })
}

/** For values that are physically non-negative — loads, distances, durations. */
export const nonNegativeQuantity = <D extends Dimension>(
  dimension: D,
  value: number,
  unit: UnitOf<D>,
): Result<Quantity<D>, QuantityError> => {
  if (value < 0) return err({ kind: 'negative-not-allowed', value })
  return quantity(dimension, value, unit)
}

export const convert = <D extends Dimension>(
  q: Quantity<D>,
  to: UnitOf<D>,
): Quantity<D> => ({
  dimension: q.dimension,
  value: (q.value * factor(q.dimension, q.unit)) / factor(q.dimension, to),
  unit: to,
})

/** Magnitude in the dimension's canonical base unit — kg, cm, s, m. */
export const toBase = <D extends Dimension>(q: Quantity<D>): number =>
  q.value * factor(q.dimension, q.unit)

export const add = <D extends Dimension>(a: Quantity<D>, b: Quantity<D>): Quantity<D> => ({
  dimension: a.dimension,
  value: a.value + convert(b, a.unit).value,
  unit: a.unit,
})

export const subtract = <D extends Dimension>(
  a: Quantity<D>,
  b: Quantity<D>,
): Quantity<D> => ({
  dimension: a.dimension,
  value: a.value - convert(b, a.unit).value,
  unit: a.unit,
})

export const scale = <D extends Dimension>(q: Quantity<D>, by: number): Quantity<D> => ({
  ...q,
  value: q.value * by,
})

/** Negative if a < b, zero if equal, positive if a > b. Unit-independent. */
export const compare = <D extends Dimension>(a: Quantity<D>, b: Quantity<D>): number =>
  toBase(a) - toBase(b)

/** Equality by physical magnitude, not by representation. 1 kg equals 1000 g. */
export const equals = <D extends Dimension>(
  a: Quantity<D>,
  b: Quantity<D>,
  epsilon = 1e-9,
): boolean => Math.abs(compare(a, b)) < epsilon

// Convenience constructors for the dimensions the domain uses most.
export const kg = (v: number) => nonNegativeQuantity('mass', v, 'kg')
export const cm = (v: number) => nonNegativeQuantity('length', v, 'cm')
export const seconds = (v: number) => nonNegativeQuantity('duration', v, 's')
export const metres = (v: number) => nonNegativeQuantity('distance', v, 'm')
