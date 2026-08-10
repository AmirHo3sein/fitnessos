import { err, ok, type PlainDate, type ProposalId, type Result } from '@fitnessos/kernel'
import type { Hypothesis } from './Hypothesis'

/**
 * `Proposal` — the BEFORE (ADR-0010).
 *
 * What the assistant suggested, why, and what it expects to follow. Immutable from creation: a
 * proposal that could be edited after the fact would make the record of what was actually
 * suggested unreliable, which is the one thing ADR-0003 needs it to be.
 *
 * ## What a proposal deliberately does NOT contain
 *
 * ADR-0019: Learning may neither write to nor read another context's model. So there is no
 * `ProgramVersion` here, no `Block`, and no typed description of the change. `targetKind` and
 * `targetId` say *what is being proposed about* in the coarsest terms that identify it, and
 * `summary` is prose. Anything richer would put Prescription's model inside Learning, and the
 * first schema change over there would break this context for no reason of its own.
 *
 * ## Where accepting lives, which is not here
 *
 * ADR-0010 again: the moment of change belongs to the CHANGING context. Accepting a proposal
 * produces a new `ProgramVersion` whose `authoringDecision` records `proposedBy: 'assistant'`
 * and `decidedBy: <the human>` — that is Prescription's record, made by Prescription's use case.
 *
 * So this file has no `accept()`. A `Proposal` is a thing that was said, and `DecisionOutcome`
 * is the verdict on whether it turned out to be right. What happened in between is written down
 * where it happened.
 */

const brand = Symbol('Proposal')

/**
 * What the proposal is about, as a coarse published vocabulary (ADR-0023).
 *
 * Deliberately not "which aggregate" — that would be Prescription's model leaking in. This is
 * enough to route a proposal to a screen and no more.
 */
export type ProposalTarget = 'program' | 'goal' | 'session'

export interface Proposal {
  readonly [brand]: true
  readonly id: ProposalId
  readonly targetKind: ProposalTarget
  /** An opaque identifier. Learning never dereferences it; the screen that shows it does. */
  readonly targetId: string
  /** What is suggested, in prose. The assistant's words, recorded verbatim. */
  readonly summary: string
  /** Why. ADR-0003's third clause, and required rather than optional for that reason. */
  readonly rationale: string
  readonly hypothesis: Hypothesis
  readonly proposedOn: PlainDate
}

export type ProposalError =
  | { readonly kind: 'summary-empty' }
  | { readonly kind: 'rationale-empty' }
  | { readonly kind: 'target-id-empty' }

export interface ProposalInput {
  readonly id: ProposalId
  readonly targetKind: ProposalTarget
  readonly targetId: string
  readonly summary: string
  readonly rationale: string
  readonly hypothesis: Hypothesis
  readonly proposedOn: PlainDate
}

export const proposal = (input: ProposalInput): Result<Proposal, ProposalError> => {
  if (input.summary.trim() === '') return err({ kind: 'summary-empty' })
  if (input.rationale.trim() === '') {
    // A proposal with no stated reason is the exact failure ADR-0003 exists to prevent: it
    // arrives carrying the authority of a suggestion while being unreviewable.
    return err({ kind: 'rationale-empty' })
  }
  if (input.targetId.trim() === '') return err({ kind: 'target-id-empty' })

  return ok({
    [brand]: true,
    id: input.id,
    targetKind: input.targetKind,
    targetId: input.targetId.trim(),
    summary: input.summary.trim(),
    rationale: input.rationale.trim(),
    hypothesis: input.hypothesis,
    proposedOn: input.proposedOn,
  })
}
