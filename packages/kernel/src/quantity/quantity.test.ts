import { describe, expect, it } from 'vitest'
import { isErr, isOk } from '../result/index'
import { add, compare, convert, equals, kg, nonNegativeQuantity, quantity, subtract, toBase } from './index'

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`)
  return r.value
}

describe('quantity construction', () => {
  it('rejects non-finite magnitudes', () => {
    expect(isErr(quantity('mass', Number.NaN, 'kg'))).toBe(true)
    expect(isErr(quantity('mass', Number.POSITIVE_INFINITY, 'kg'))).toBe(true)
  })

  it('rejects negatives where the dimension forbids them', () => {
    expect(isErr(nonNegativeQuantity('mass', -1, 'kg'))).toBe(true)
    expect(isOk(nonNegativeQuantity('mass', 0, 'kg'))).toBe(true)
  })
})

describe('conversion', () => {
  it('round-trips within a dimension', () => {
    const original = unwrap(kg(82.5))
    const roundTripped = convert(convert(original, 'lb'), 'kg')
    expect(equals(original, roundTripped)).toBe(true)
  })

  it('converts mass correctly', () => {
    expect(convert(unwrap(kg(1)), 'g').value).toBeCloseTo(1000, 9)
    expect(convert(unwrap(kg(1)), 'lb').value).toBeCloseTo(2.2046226, 6)
  })

  it('reports base magnitude independent of representation', () => {
    const asKg = unwrap(quantity('mass', 1, 'kg'))
    const asGrams = unwrap(quantity('mass', 1000, 'g'))
    expect(toBase(asKg)).toBeCloseTo(toBase(asGrams), 9)
  })
})

describe('arithmetic preserves the left operand unit', () => {
  it('adds across units', () => {
    const sum = add(unwrap(quantity('mass', 1, 'kg')), unwrap(quantity('mass', 500, 'g')))
    expect(sum.unit).toBe('kg')
    expect(sum.value).toBeCloseTo(1.5, 9)
  })

  it('subtracts across units', () => {
    const diff = subtract(unwrap(quantity('mass', 1, 'kg')), unwrap(quantity('mass', 250, 'g')))
    expect(diff.value).toBeCloseTo(0.75, 9)
  })
})

describe('comparison is representation-independent', () => {
  it('treats 1 kg and 1000 g as equal', () => {
    expect(equals(unwrap(quantity('mass', 1, 'kg')), unwrap(quantity('mass', 1000, 'g')))).toBe(true)
    expect(compare(unwrap(quantity('mass', 1, 'kg')), unwrap(quantity('mass', 1000, 'g')))).toBeCloseTo(0, 9)
  })

  it('orders correctly across units', () => {
    expect(compare(unwrap(quantity('mass', 1, 'kg')), unwrap(quantity('mass', 1, 'lb')))).toBeGreaterThan(0)
  })
})
