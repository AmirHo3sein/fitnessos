import {
  daysBetween,
  err,
  ok,
  type AthleteId,
  type GoalId,
  type PlainDate,
  type Result,
} from '@fitnessos/kernel'
import { nextEvaluationDue, type EvaluationPolicy } from './EvaluationPolicy'
import type { GoalIntent } from './GoalIntent'

/**
 * Goal — the aggregate root of the Goal context, and the psychological centre of the
 * domain (ADR-0004).
 *
 * Two constraints define its shape, and both are worth stating because both are
 * tempting to break:
 *
 * **ADR-0018: a Goal may never reference a Program, PerformedSession, Observation or
 * Proposal.** Nothing here points at any of them, and nothing should. A goal is a
 * declaration of intent; the moment it holds a programme id it becomes a coordination
 * record, and every context that touches programmes has to know about goals. The link
 * runs the other way — `ProgramVersion` carries `ServesGoal` (ADR-0008), which states
 * current purpose and is explicitly never an input to outcome evaluation.
 *
 * **ADR-0006: staleness, horizon expiry and closure are derived, not stored.** There is
 * no `status`, no `isExpired`, no `isOverdue`. Those are questions, answered below by
 * functions that take the current date. A stored flag is wrong the moment time passes,
 * which means something must write it — a job, or a state machine spanning this context
 * and Learning. Both are rejected. A derived answer is correct at every instant because
 * it is computed when asked.
 *
 * The absence of a `status` field is the single most likely thing to be "fixed" by
 * someone who has not read ADR-0006. There is a test asserting it stays absent.
 */

const brand = Symbol('Goal')

export interface Goal {
  readonly [brand]: true
  readonly id: GoalId
  /** Ownership. The Athlete is the tenant (ADR-0001). */
  readonly athleteId: AthleteId
  readonly intent: GoalIntent
  readonly declaredOn: PlainDate
  /** When the athlete wants it by. Null means open-ended, which is a valid answer. */
  readonly horizon: PlainDate | null
  readonly evaluationPolicy: EvaluationPolicy
}

export type GoalError =
  | { readonly kind: 'horizon-in-past'; readonly horizon: PlainDate; readonly today: PlainDate }
  | { readonly kind: 'horizon-too-near'; readonly days: number; readonly minDays: number }

/**
 * A horizon inside a week cannot be evaluated even once before it arrives, given the
 * minimum cadence. Accepting one would create an obligation to judge (ADR-0007) that is
 * impossible to discharge.
 */
export const MIN_HORIZON_DAYS = 7

export interface GoalInput {
  readonly id: GoalId
  readonly athleteId: AthleteId
  readonly intent: GoalIntent
  readonly horizon: PlainDate | null
  readonly evaluationPolicy: EvaluationPolicy
}

/**
 * The aggregate factory. Named after its type, matching every other constructor in the
 * codebase — `availability()`, `trainingIdentity()`, `goalIntent()`, `evaluationPolicy()`.
 *
 * `declareGoal` is deliberately NOT this function's name: that is the application-layer
 * USE CASE, which parses input, resolves a date from a Clock, and calls a port. Having
 * both share a name collided on the package barrel, and the collision was the useful
 * kind — two things at different layers with one name is confusing whether or not the
 * module system objects.
 *
 * `today` is a parameter, not read from a clock inside here.
 *
 * The domain never calls `Date.now()` (handbook D-05 and the ports note): a use case
 * takes a `Clock` and passes the resolved date in. That is what makes every rule below
 * testable at an arbitrary date instead of only on the day the test happens to run —
 * and horizon rules are exactly the kind that pass in March and fail in December.
 */
export const goal = (input: GoalInput, today: PlainDate): Result<Goal, GoalError> => {
  if (input.horizon !== null) {
    const days = daysBetween(today, input.horizon)
    if (days < 0) {
      return err({ kind: 'horizon-in-past', horizon: input.horizon, today })
    }
    if (days < MIN_HORIZON_DAYS) {
      return err({ kind: 'horizon-too-near', days, minDays: MIN_HORIZON_DAYS })
    }
  }

  return ok({
    [brand]: true,
    id: input.id,
    athleteId: input.athleteId,
    intent: input.intent,
    declaredOn: today,
    horizon: input.horizon,
    evaluationPolicy: input.evaluationPolicy,
  })
}

// --- derived state (ADR-0006) ------------------------------------------------
// None of the following is stored. Each takes the facts it needs, including any that
// belong to another context, and answers a question about *now*.

/** Past its horizon. An open-ended goal never is. */
export const isPastHorizon = (goal: Goal, today: PlainDate): boolean =>
  goal.horizon !== null && daysBetween(today, goal.horizon) < 0

/**
 * Due for evaluation.
 *
 * `lastEvaluatedOn` comes from the Learning context's `DecisionOutcome` records, which
 * this context may not read (ADR-0019). It is therefore a parameter, supplied by
 * whatever composed the two — a read model, not the aggregate.
 */
export const isDueForEvaluation = (
  goal: Goal,
  lastEvaluatedOn: PlainDate | null,
  today: PlainDate,
): boolean => {
  const due = nextEvaluationDue(goal.evaluationPolicy, goal.declaredOn, lastEvaluatedOn)
  return daysBetween(today, due) <= 0
}

/**
 * How many days late the evaluation is, or 0 when not yet due.
 *
 * Separate from `isDueForEvaluation` because "due" and "three weeks overdue" warrant
 * different treatment in a UI, and computing the difference at the call site would put
 * the cadence arithmetic in presentation.
 */
export const daysOverdueForEvaluation = (
  goal: Goal,
  lastEvaluatedOn: PlainDate | null,
  today: PlainDate,
): number => {
  const due = nextEvaluationDue(goal.evaluationPolicy, goal.declaredOn, lastEvaluatedOn)
  const diff = daysBetween(due, today)
  return diff > 0 ? diff : 0
}
