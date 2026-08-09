/**
 * Estimated one-rep max, derived from a set that was actually performed.
 *
 * ## Why this is a function and not a field
 *
 * ADR-0006: derivations are queries, not state. There is no `estimatedOneRepMax` on any
 * aggregate, and there is no job that recomputes one. The estimate is produced at the moment it
 * is asked, from the sets the athlete logged, and is therefore correct at every instant —
 * including the instant a set is corrected, when a stored value would silently be wrong until
 * something noticed.
 *
 * ## Why it is a domain SERVICE and not behaviour on `Observation`
 *
 * Same reasoning as ADR-0013 for progression: it depends on data outside the aggregate. A
 * one-rep max is computed from performed sets, which belong to Execution. Putting the method on
 * `Observation` would require the aggregate to reach for another context's records or hold a
 * stale copy of them.
 *
 * ## The formula, and its limits, stated rather than hidden
 *
 * Epley: `1RM = weight × (1 + reps / 30)`. It is an approximation of a physiological
 * relationship that varies by person, movement and training state, and it degrades as reps rise
 * — a set of twenty tells you about endurance, not maximal strength.
 *
 * So `estimateOneRepMax` REFUSES above `MAX_RELIABLE_REPS` rather than returning a confident
 * number nobody should act on. That is the whole point of the cap: a progression decision made
 * from a twenty-rep set is worse than no decision, because it carries the authority of a
 * calculation.
 */

export const MAX_RELIABLE_REPS = 12

export interface PerformedSet {
  readonly reps: number
  /** Null for bodyweight work, which yields no external-load estimate. */
  readonly loadKg: number | null
}

export type OneRepMaxError =
  | { readonly kind: 'no-external-load' }
  | { readonly kind: 'reps-not-positive'; readonly given: number }
  | { readonly kind: 'reps-beyond-reliable-range'; readonly given: number; readonly max: number }

export type OneRepMaxEstimate =
  | { readonly ok: true; readonly kg: number }
  | { readonly ok: false; readonly reason: OneRepMaxError }

export const estimateOneRepMax = (set: PerformedSet): OneRepMaxEstimate => {
  if (set.loadKg === null || set.loadKg <= 0) {
    // Bodyweight work has a real load, and this function does not know it — that would need the
    // athlete's mass and a per-movement leverage factor. Returning the bar weight of zero would
    // be a confident lie.
    return { ok: false, reason: { kind: 'no-external-load' } }
  }
  if (!Number.isInteger(set.reps) || set.reps < 1) {
    return { ok: false, reason: { kind: 'reps-not-positive', given: set.reps } }
  }
  if (set.reps > MAX_RELIABLE_REPS) {
    return {
      ok: false,
      reason: { kind: 'reps-beyond-reliable-range', given: set.reps, max: MAX_RELIABLE_REPS },
    }
  }

  // A single rep IS the max, and Epley agrees: 1 + 1/30 would inflate it by 3%.
  if (set.reps === 1) return { ok: true, kg: set.loadKg }

  return { ok: true, kg: set.loadKg * (1 + set.reps / 30) }
}

/**
 * The best estimate across a session's sets.
 *
 * The MAXIMUM, not the average or the last. A session usually contains warm-up sets, and
 * averaging them in would report a number the athlete beat an hour ago. Sets that cannot be
 * estimated are skipped rather than counted as zero.
 *
 * `null` when nothing in the session supports an estimate — a bodyweight-only session is not a
 * session with a one-rep max of zero, and the two must not render the same.
 */
export const bestEstimate = (sets: readonly PerformedSet[]): number | null => {
  let best: number | null = null
  for (const set of sets) {
    const estimate = estimateOneRepMax(set)
    if (!estimate.ok) continue
    if (best === null || estimate.kg > best) best = estimate.kg
  }
  return best
}
