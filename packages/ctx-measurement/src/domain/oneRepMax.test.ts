import { describe, expect, it } from 'vitest'
import { MAX_RELIABLE_REPS, bestEstimate, estimateOneRepMax } from './oneRepMax'

const set = (reps: number, loadKg: number | null) => ({ reps, loadKg })

describe('the estimate', () => {
  it('returns the load itself for a single', () => {
    // A single IS the max. Epley's `1 + reps/30` would inflate it by 3%, which over a training
    // block compounds into a target the athlete cannot hit and did not choose.
    expect(estimateOneRepMax(set(1, 100))).toEqual({ ok: true, kg: 100 })
  })

  it('applies Epley above one rep', () => {
    // 100 × (1 + 5/30) = 116.67
    const result = estimateOneRepMax(set(5, 100))
    expect(result.ok).toBe(true)
    expect(result.ok && result.kg).toBeCloseTo(116.67, 2)
  })

  it('is monotonic in both reps and load', () => {
    // Stated because it is the property every consumer assumes: more work is never a lower
    // estimate. A formula change that broke it would make a PR look like a regression.
    const more = estimateOneRepMax(set(6, 100))
    const fewer = estimateOneRepMax(set(5, 100))
    const heavier = estimateOneRepMax(set(5, 105))

    expect(more.ok && fewer.ok && more.kg > fewer.kg).toBe(true)
    expect(heavier.ok && fewer.ok && heavier.kg > fewer.kg).toBe(true)
  })
})

describe('what it refuses, and why refusing is the point', () => {
  it('refuses beyond the reliable rep range', () => {
    /**
     * The cap is the whole reason this returns a Result rather than a number. Epley degrades as
     * reps rise — a set of twenty measures endurance, not maximal strength — and a progression
     * decision made from one is worse than no decision, because it arrives carrying the
     * authority of a calculation.
     */
    expect(estimateOneRepMax(set(MAX_RELIABLE_REPS + 1, 100))).toEqual({
      ok: false,
      reason: { kind: 'reps-beyond-reliable-range', given: 13, max: 12 },
    })
  })

  it('accepts exactly the boundary', () => {
    expect(estimateOneRepMax(set(MAX_RELIABLE_REPS, 100)).ok).toBe(true)
  })

  it('refuses bodyweight work rather than calling it zero', () => {
    // Bodyweight work has a real load this function does not know — that needs the athlete's
    // mass and a per-movement leverage factor. Reporting the bar weight would be a confident lie.
    expect(estimateOneRepMax(set(8, null))).toEqual({
      ok: false,
      reason: { kind: 'no-external-load' },
    })
    expect(estimateOneRepMax(set(8, 0))).toEqual({
      ok: false,
      reason: { kind: 'no-external-load' },
    })
  })

  it('refuses fractional or zero reps', () => {
    expect(estimateOneRepMax(set(0, 100)).ok).toBe(false)
    expect(estimateOneRepMax(set(2.5, 100)).ok).toBe(false)
  })
})

describe('the best estimate across a session', () => {
  it('takes the maximum, not the average or the last', () => {
    // Sessions contain warm-ups. Averaging reports a number the athlete beat an hour ago; taking
    // the last reports whatever they finished on, which is usually the lightest.
    expect(bestEstimate([set(10, 60), set(5, 100), set(8, 70)])).toBeCloseTo(116.67, 2)
  })

  it('skips sets it cannot estimate rather than counting them as zero', () => {
    expect(bestEstimate([set(20, 60), set(3, 100), set(10, null)])).toBeCloseTo(110, 2)
  })

  it('is null when nothing supports an estimate', () => {
    // A bodyweight-only session is not a session with a one-rep max of zero, and the two must
    // not render the same — one says "no data", the other says "you can lift nothing".
    expect(bestEstimate([set(10, null), set(15, null)])).toBeNull()
    expect(bestEstimate([])).toBeNull()
  })
})
