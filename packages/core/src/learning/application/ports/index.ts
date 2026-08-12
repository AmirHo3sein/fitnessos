import type { DecisionOutcomeId, PlainDate, ProposalId } from '@fitnessos/kernel'
import type { ProposalTarget } from '../../domain/Proposal'
import type { Verdict } from '../../domain/DecisionOutcome'

/**
 * Learning — ports.
 *
 * Read models (D-06), tolerant reader. ADR-0019 is the constraint that shapes every shape here:
 * **Learning may neither write to nor read another context's model.** So a proposal describes
 * its target with a coarse kind and an opaque id, and never carries a `ProgramVersion`.
 *
 * Never call `Date.now()` in a use case. Due-ness is derived (ADR-0006), so the date is an
 * argument.
 */

export interface HypothesisSnapshot {
  readonly indicatorKind: string
  readonly claim: string
  readonly horizon: PlainDate
}

export interface ProposalSnapshot {
  readonly id: ProposalId
  readonly targetKind: ProposalTarget
  readonly targetId: string
  readonly summary: string
  readonly rationale: string
  readonly hypothesis: HypothesisSnapshot
  /**
   * Who suggested it.
   *
   * CLOSED, unlike an observation's kind (ADR-0020's exception): the variants differ in required
   * structure, so an unrecognised one cannot be handled as data. A human proposer names WHICH human —
   * a bare `human` would answer "a person suggested this" to the question "who suggested this".
   *
   * One `Proposal` rather than a second aggregate for coach suggestions (ADR-0022): the two have
   * identical invariants and identical transition authority, and differ only in who spoke.
   */
  readonly proposedBy:
    | { readonly kind: 'assistant' }
    | { readonly kind: 'human'; readonly personId: string }
  readonly proposedOn: PlainDate
  /**
   * Whether the human acted on it, and when — the moment of change, which is recorded in the
   * CHANGING context (ADR-0010) and reported back here only so this screen can stop offering a
   * decision that has already been made.
   *
   * Null while undecided. Deliberately not an aggregate field: Learning does not own this fact,
   * it is told it.
   */
  readonly decidedOn: PlainDate | null
  readonly accepted: boolean | null
}

export interface DecisionOutcomeSnapshot {
  readonly id: DecisionOutcomeId
  readonly proposalId: ProposalId
  readonly verdict: Verdict
  readonly rationale: string
  readonly decidedBy: string
  readonly decidedOn: PlainDate
  readonly supersedes: DecisionOutcomeId | null
}

export interface RenderVerdictInput {
  readonly id: DecisionOutcomeId
  readonly proposalId: ProposalId
  readonly verdict: Verdict
  readonly rationale: string
  /** Set when correcting a previous verdict. The original is preserved (ADR-0007). */
  readonly supersedes: DecisionOutcomeId | null
}

export interface LearningReadPort {
  readonly proposals: (signal?: AbortSignal) => Promise<readonly ProposalSnapshot[]>
  /**
   * Every verdict, including superseded ones.
   *
   * Including them is the point: a corrected verdict that vanished would make the correction
   * invisible, which is the opposite of what ADR-0007's supersede rule is for. Which of them a
   * reader sees is a presentation decision.
   */
  readonly outcomes: (signal?: AbortSignal) => Promise<readonly DecisionOutcomeSnapshot[]>
}

export interface LearningWritePort {
  /**
   * Record whether a hypothesis held.
   *
   * NOT "accept a proposal". Accepting is the moment of change and belongs to Prescription,
   * where it is recorded on the new `ProgramVersion`'s `authoringDecision` (ADR-0010).
   */
  readonly renderVerdict: (
    input: RenderVerdictInput,
    signal?: AbortSignal,
  ) => Promise<DecisionOutcomeSnapshot>
}

export interface LearningPorts {
  readonly learning: LearningReadPort & LearningWritePort
}
