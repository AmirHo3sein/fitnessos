import { isErr, localDate, newGoalId, type AthleteId, type Clock, type PlainDate } from '@fitnessos/kernel'
import { evaluationPolicy, type EvaluationPolicyError } from '../domain/EvaluationPolicy'
import { goalIntent, type GoalIntentError } from '../domain/GoalIntent'
import { goal as makeGoal, type GoalError } from '../domain/Goal'
import type { GoalPorts, GoalSnapshot } from './ports/index'

/**
 * Declare a goal.
 *
 * Takes a `Clock` and a `TimeZone` rather than reading the current date itself. The
 * handbook is explicit: never call `Date.now()` in a use case. Two reasons, and the
 * second is the one that bites — a horizon rule tested against the real clock passes in
 * March and fails in December, and "today" in Tehran is not "today" in UTC for several
 * hours a day, which is exactly when someone declaring a goal late at night would get a
 * horizon rejected for being one day too near.
 */

export type DeclareGoalError =
  | { readonly field: 'intent'; readonly reason: GoalIntentError }
  | { readonly field: 'cadence'; readonly reason: EvaluationPolicyError }
  | { readonly field: 'horizon'; readonly reason: GoalError }

export class DeclareGoalValidationError extends Error {
  override readonly name = 'DeclareGoalValidationError'
  constructor(readonly problem: DeclareGoalError) {
    super(`${problem.field}: ${problem.reason.kind}`)
  }
}

export interface GoalDraft {
  readonly intent: string
  readonly horizon: PlainDate | null
  readonly cadenceDays: number
}

export const declareGoal = async (
  ports: GoalPorts,
  athleteId: AthleteId,
  draft: GoalDraft,
  clock: Clock,
  zone: string,
  signal?: AbortSignal,
): Promise<GoalSnapshot> => {
  const intent = goalIntent(draft.intent)
  if (isErr(intent)) throw new DeclareGoalValidationError({ field: 'intent', reason: intent.error })

  const policy = evaluationPolicy(draft.cadenceDays)
  if (isErr(policy)) throw new DeclareGoalValidationError({ field: 'cadence', reason: policy.error })

  const today = localDate({ epochMs: clock.now(), zone })

  // The aggregate is constructed even though the server assigns the real id and will
  // re-validate. Constructing it here is what applies the horizon rules before a request
  // is spent, and it is the only place they are expressed — a client that skipped this
  // would duplicate them in the form or discover them as a 400.
  const created = makeGoal(
    {
      id: newGoalId(),
      athleteId,
      intent: intent.value,
      horizon: draft.horizon,
      evaluationPolicy: policy.value,
    },
    today,
  )
  if (isErr(created)) {
    throw new DeclareGoalValidationError({ field: 'horizon', reason: created.error })
  }

  // The NORMALISED intent is sent, not the raw draft — whitespace collapsed, trimmed,
  // ZWNJ intact. Sending the draft would store two different strings for the same
  // sentence typed with a stray double space.
  return ports.goal.declare(
    {
      intent: created.value.intent.text,
      horizon: created.value.horizon,
      cadenceDays: created.value.evaluationPolicy.cadenceDays,
    },
    signal,
  )
}
