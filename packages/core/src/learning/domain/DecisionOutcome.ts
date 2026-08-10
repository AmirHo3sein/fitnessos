import {
  err,
  ok,
  type DecisionOutcomeId,
  type PlainDate,
  type ProposalId,
  type Result,
} from '@fitnessos/kernel'

/**
 * `DecisionOutcome` — the AFTER (ADR-0010), holding the rendered verdict only (ADR-0007).
 *
 * Whether the hypothesis a proposal carried turned out to hold. Not whether the proposal was
 * accepted — that is the moment of change and belongs to the changing context, recorded on the
 * `ProgramVersion`'s `authoringDecision`.
 *
 * ## Immutable from creation; corrections supersede
 *
 * ADR-0007, and the reason is that a verdict is evidence. Editing one in place would rewrite
 * what was concluded at the time, which is the only thing that makes a later disagreement
 * legible. So `correct()` returns a NEW outcome pointing at the one it replaces, and both
 * survive.
 *
 * The superseded one is not deleted and not hidden by this file. Whether a reader sees the
 * history is a presentation decision; whether it exists is not.
 */

const brand = Symbol('DecisionOutcome')

/**
 * Closed, and only two members.
 *
 * A third meaning "not yet" was considered and rejected: an outcome that says the question is
 * still open is not an outcome, it is the absence of one — which is already represented, by
 * there being no `DecisionOutcome` at all. Adding it would give the same state two spellings and
 * make `UnjudgedHypothesisView` ask which one it meant.
 */
export type Verdict = 'held' | 'did-not-hold'

export interface DecisionOutcome {
  readonly [brand]: true
  readonly id: DecisionOutcomeId
  readonly proposalId: ProposalId
  readonly verdict: Verdict
  /** Why, in the decider's words. Never generated, never defaulted (ADR-0003). */
  readonly rationale: string
  /** The human who rendered it. An assistant may propose; it may not conclude. */
  readonly decidedBy: string
  readonly decidedOn: PlainDate
  /** The outcome this replaces, when it is a correction. Null for a first verdict. */
  readonly supersedes: DecisionOutcomeId | null
}

export type DecisionOutcomeError =
  | { readonly kind: 'rationale-empty' }
  | { readonly kind: 'decided-by-empty' }
  | { readonly kind: 'supersedes-itself'; readonly id: string }

export interface DecisionOutcomeInput {
  readonly id: DecisionOutcomeId
  readonly proposalId: ProposalId
  readonly verdict: Verdict
  readonly rationale: string
  readonly decidedBy: string
  readonly decidedOn: PlainDate
  readonly supersedes?: DecisionOutcomeId | null
}

export const decisionOutcome = (
  input: DecisionOutcomeInput,
): Result<DecisionOutcome, DecisionOutcomeError> => {
  if (input.rationale.trim() === '') {
    // "It worked" with no reason is a rating, not a verdict, and ADR-0003 asks for the why
    // precisely so that a later reader can disagree with the reasoning rather than the score.
    return err({ kind: 'rationale-empty' })
  }
  if (input.decidedBy.trim() === '') return err({ kind: 'decided-by-empty' })

  const supersedes = input.supersedes ?? null
  if (supersedes !== null && supersedes === input.id) {
    return err({ kind: 'supersedes-itself', id: input.id })
  }

  return ok({
    [brand]: true,
    id: input.id,
    proposalId: input.proposalId,
    verdict: input.verdict,
    rationale: input.rationale.trim(),
    decidedBy: input.decidedBy.trim(),
    decidedOn: input.decidedOn,
    supersedes,
  })
}

/**
 * Correct a verdict by superseding it. The original is NOT modified, and a test asserts it.
 *
 * `decidedBy` is required rather than carried over, for the same reason `revise()` requires it
 * in Prescription: a correction is a new judgement by a person, and inheriting the previous
 * decider would attribute this conclusion to whoever reached the last one.
 */
export const correct = (
  original: DecisionOutcome,
  changes: {
    readonly id: DecisionOutcomeId
    readonly verdict: Verdict
    readonly rationale: string
    readonly decidedBy: string
    readonly decidedOn: PlainDate
  },
): Result<DecisionOutcome, DecisionOutcomeError> =>
  decisionOutcome({
    id: changes.id,
    proposalId: original.proposalId,
    verdict: changes.verdict,
    rationale: changes.rationale,
    decidedBy: changes.decidedBy,
    decidedOn: changes.decidedOn,
    supersedes: original.id,
  })
