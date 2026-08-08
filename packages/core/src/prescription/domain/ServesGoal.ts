import type { GoalId } from '@fitnessos/kernel'

/**
 * The goal a programme version is currently *for*.
 *
 * ADR-0008 is explicit and worth quoting: `ServesGoal` "states current purpose and is
 * **never an input to outcome evaluation**".
 *
 * That second half is the whole reason this is its own type rather than a bare `GoalId`
 * field. The tempting mistake is to judge a programme by whether its stated goal was
 * achieved — which sounds obviously right and is wrong. A programme may serve a goal it was
 * never designed to achieve alone; a goal may be reached despite the programme; and a
 * programme's purpose can be restated at any time, which would retroactively rewrite what
 * it is being judged against.
 *
 * Evaluation belongs to the `Hypothesis` recorded on the authoring record at the moment of
 * authoring (ADR-0007), and to `DecisionOutcome` in Learning. Neither reads this.
 *
 * So there is deliberately **no** function here that takes a `ServesGoal` and returns
 * anything about success, achievement or progress. If one appears, ADR-0008 has been
 * broken, and the fix is to delete it rather than to extend it.
 *
 * Note the direction: a ProgramVersion may point at a Goal. A Goal may never point back
 * (ADR-0018).
 */
export interface ServesGoal {
  readonly goalId: GoalId
  /**
   * Why this programme serves that goal, in the author's words. Optional, because a coach
   * restating purpose should not be blocked on writing an essay.
   */
  readonly rationale: string | null
}

export const servesGoal = (goalId: GoalId, rationale: string | null = null): ServesGoal => ({
  goalId,
  rationale: rationale === null || rationale.trim() === '' ? null : rationale.trim(),
})
