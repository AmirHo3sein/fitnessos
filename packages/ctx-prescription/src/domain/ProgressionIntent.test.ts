import { isErr, isOk } from '@fitnessos/kernel'
import { describe, expect, it } from 'vitest'
import { MAX_RATE_PERCENT, progressionIntent } from './ProgressionIntent'

describe('progressionIntent', () => {
  it('accepts a fixed block with no rate', () => {
    expect(isOk(progressionIntent('fixed', null))).toBe(true)
  })

  it('accepts a linear block with a rate', () => {
    expect(isOk(progressionIntent('linear', 2.5))).toBe(true)
  })

  it('requires a rate for linear', () => {
    const result = progressionIntent('linear', null)
    expect(isErr(result) && result.error.kind).toBe('rate-required')
  })

  it('rejects a rate on a fixed block', () => {
    // Not harmless: it reads as meaningful to whoever opens the programme next, and would be
    // silently ignored at resolution.
    const result = progressionIntent('fixed', 5)
    expect(isErr(result) && result.error.kind).toBe('rate-not-applicable')
  })

  it('rejects a rate on an autoregulated block', () => {
    expect(isErr(progressionIntent('autoregulated', 5))).toBe(true)
  })

  it('rejects a zero or negative rate', () => {
    expect(isErr(progressionIntent('linear', 0))).toBe(true)
    expect(isErr(progressionIntent('linear', -2))).toBe(true)
  })

  it('rejects a kilogram figure typed into a percent field', () => {
    // `50` meaning "50kg" would compound into a prescription no athlete can follow.
    const result = progressionIntent('linear', 50)
    expect(isErr(result) && result.error.kind).toBe('rate-out-of-range')
  })

  it('accepts exactly the maximum rate', () => {
    expect(isOk(progressionIntent('linear', MAX_RATE_PERCENT))).toBe(true)
  })

  it('exposes no resolve() — progression is a domain service (ADR-0013)', () => {
    // A method here would have to reach for published indicators, pulling Measurement into
    // this context or forcing the block to hold a stale copy. The intent is inert.
    const intent = progressionIntent('linear', 2.5)
    expect(isOk(intent) && Object.keys(intent.value)).toEqual(['kind', 'ratePercent'])
  })
})
