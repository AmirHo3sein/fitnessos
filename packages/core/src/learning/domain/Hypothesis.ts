import { addDays, err, ok, plainDateKey, type PlainDate, type Result } from '@fitnessos/kernel'

/**
 * `Hypothesis` — the obligation to find out whether a change worked (ADR-0007).
 *
 * A value object on the authoring record, not an aggregate of its own, and enforced within a
 * single aggregate: a `Proposal` cannot be constructed without one.
 *
 * ## Why a proposal must carry a falsifiable claim
 *
 * ADR-0003 is "AI proposes, humans decide, the system records why". Without this the third
 * clause degrades into recording *that* a human decided, which is an audit trail of clicks. A
 * hypothesis makes the proposal answerable: it states what is expected, in what, by when — so
 * that later there is a question with an answer rather than an impression.
 *
 * The obligation it creates is the point. Once the horizon passes, someone owes a verdict, and
 * `UnjudgedHypothesisView` exists to make that debt visible. A system that could accept
 * assistant proposals indefinitely without ever checking whether they worked would be
 * automation wearing the costume of evidence.
 */

const brand = Symbol('Hypothesis')

export interface Hypothesis {
  readonly [brand]: true
  /**
   * What is expected to move, as an indicator kind Measurement publishes.
   *
   * A string rather than a union, because indicator kinds are an OPEN vocabulary (ADR-0020) and
   * this context must not become the place that has to ship before a new one can be predicted.
   */
  readonly indicatorKind: string
  /** The expectation, in the athlete's own words or the assistant's. Never generated later. */
  readonly claim: string
  /** When the claim becomes answerable. Before this, silence is not a missing verdict. */
  readonly horizon: PlainDate
}

export type HypothesisError =
  | { readonly kind: 'claim-empty' }
  | { readonly kind: 'indicator-kind-empty' }
  | { readonly kind: 'horizon-not-future'; readonly horizon: string; readonly proposedOn: string }
  | { readonly kind: 'horizon-too-far'; readonly days: number; readonly max: number }

/**
 * A year. Beyond that the claim is not being tested, it is being filed.
 *
 * The same reasoning as Goal's `MAX_CADENCE_DAYS`: an obligation nobody will live to see
 * discharged is an obligation in name only, and it clutters the view that exists to show real
 * ones.
 */
export const MAX_HORIZON_DAYS = 365

export const hypothesis = (input: {
  readonly indicatorKind: string
  readonly claim: string
  readonly horizon: PlainDate
  readonly proposedOn: PlainDate
}): Result<Hypothesis, HypothesisError> => {
  if (input.claim.trim() === '') return err({ kind: 'claim-empty' })
  if (input.indicatorKind.trim() === '') return err({ kind: 'indicator-kind-empty' })

  const horizon = plainDateKey(input.horizon)
  const proposedOn = plainDateKey(input.proposedOn)
  if (horizon <= proposedOn) {
    /*
     * A horizon in the past or today is already due at the moment of proposing, so it would
     * arrive in the unjudged view immediately — before the change it predicts has had any chance
     * to have an effect. Compared as ISO keys rather than through `Date`, which parses a plain
     * date as UTC midnight and shifts it a day west of Greenwich.
     */
    return err({ kind: 'horizon-not-future', horizon, proposedOn })
  }

  const days = daysUntil(input.proposedOn, input.horizon)
  if (days > MAX_HORIZON_DAYS) {
    return err({ kind: 'horizon-too-far', days, max: MAX_HORIZON_DAYS })
  }

  return ok({
    [brand]: true,
    indicatorKind: input.indicatorKind.trim(),
    claim: input.claim.trim(),
    horizon: input.horizon,
  })
}

const daysUntil = (from: PlainDate, to: PlainDate): number => {
  let days = 0
  let cursor = from
  // Bounded walk rather than arithmetic on epoch values, so a leap day cannot shift the count.
  // Stops one past the cap, which is all the caller needs to know.
  while (plainDateKey(cursor) < plainDateKey(to) && days <= MAX_HORIZON_DAYS) {
    cursor = addDays(cursor, 1)
    days += 1
  }
  return days
}

/**
 * Whether the claim is answerable yet. A QUERY, per ADR-0006 — hence `asOf`.
 *
 * There is no `isDue` field anywhere, and there is a test asserting it stays absent: a stored
 * flag is wrong the instant a day passes, and something would then have to write it.
 */
export const isDue = (subject: Hypothesis, asOf: PlainDate): boolean =>
  plainDateKey(asOf) >= plainDateKey(subject.horizon)
