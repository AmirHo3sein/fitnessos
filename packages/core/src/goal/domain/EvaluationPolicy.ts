import { addDays, err, ok, type PlainDate, type Result } from '@fitnessos/kernel'

/**
 * How often a goal's progress should be judged. Declares a CADENCE and nothing else.
 *
 * ADR-0006 is the constraint that shapes this file: **staleness, horizon expiry and
 * closure are derived, not stored.** There is no `isOverdue` field, no `status`, and no
 * `lastEvaluatedAt` — the policy states a rule, and every question about whether the
 * rule is currently satisfied is answered by a function.
 *
 * That is not stylistic. A stored `isOverdue` flag is wrong the instant time passes,
 * which means something has to write it — a scheduled job, or a state machine spanning
 * this context and Learning. ADR-0006 rejects both, and the derived form has no such
 * requirement: it is correct at every instant because it is computed at the instant it
 * is asked.
 */

const brand = Symbol('EvaluationPolicy')

export interface EvaluationPolicy {
  readonly [brand]: true
  readonly cadenceDays: number
}

export type EvaluationPolicyError =
  | { readonly kind: 'cadence-too-short'; readonly given: number; readonly min: number }
  | { readonly kind: 'cadence-too-long'; readonly given: number; readonly max: number }
  | { readonly kind: 'cadence-not-whole'; readonly given: number }

/**
 * Weekly at most.
 *
 * Physiological adaptation does not resolve faster than this, so a shorter cadence
 * produces judgements about noise — and a product that asks "are you making progress?"
 * every day teaches the athlete to stop answering.
 */
export const MIN_CADENCE_DAYS = 7

/**
 * Yearly at least. Beyond a year the goal is not being evaluated in any meaningful
 * sense, and the obligation to judge it (ADR-0007) becomes decorative.
 */
export const MAX_CADENCE_DAYS = 365

export const evaluationPolicy = (
  cadenceDays: number,
): Result<EvaluationPolicy, EvaluationPolicyError> => {
  if (!Number.isInteger(cadenceDays)) {
    return err({ kind: 'cadence-not-whole', given: cadenceDays })
  }
  if (cadenceDays < MIN_CADENCE_DAYS) {
    return err({ kind: 'cadence-too-short', given: cadenceDays, min: MIN_CADENCE_DAYS })
  }
  if (cadenceDays > MAX_CADENCE_DAYS) {
    return err({ kind: 'cadence-too-long', given: cadenceDays, max: MAX_CADENCE_DAYS })
  }
  return ok({ [brand]: true, cadenceDays })
}

/** Four weeks. Long enough for a training block to produce a signal worth judging. */
export const DEFAULT_CADENCE_DAYS = 28

/**
 * When the next evaluation is due.
 *
 * `lastEvaluatedAt` is a PARAMETER, not a field on the policy or the goal, and that is
 * the whole point of the design. The record of having evaluated something is a
 * `DecisionOutcome` and it lives in the Learning context, which may neither read nor
 * write another context's model (ADR-0019). So Goal cannot know it, must not store a
 * copy of it, and instead accepts it from whoever composed the two — a read model at
 * the query layer.
 *
 * `null` means never evaluated, in which case the clock starts at declaration.
 */
export const nextEvaluationDue = (
  policy: EvaluationPolicy,
  declaredOn: PlainDate,
  lastEvaluatedOn: PlainDate | null,
): PlainDate => addDays(lastEvaluatedOn ?? declaredOn, policy.cadenceDays)
