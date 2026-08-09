import {
  plainDateKey,
  type DecisionOutcomeId,
  type PlainDate,
  type ProposalId,
} from '@fitnessos/kernel'
import type { DecisionOutcomeSnapshot, ProposalSnapshot } from '../ports/index'

/**
 * `UnjudgedHypothesisView` — an accepted proposal whose claim is due and unanswered (D-06).
 *
 * This is the read model that makes ADR-0003 more than a slogan. "AI proposes, humans decide,
 * the system records why" is satisfiable by a product that accepts every suggestion and never
 * looks back; the obligation ADR-0007 creates is what stops that, and this is where the debt
 * becomes visible.
 *
 * ## Everything here is derived
 *
 * ADR-0006. Whether a hypothesis is unjudged is a function of three things — was it accepted,
 * has its horizon passed, does a verdict exist — none of which is stored as a status anywhere.
 * A `status: 'awaiting-verdict'` on the wire would be wrong the day after it was serialised.
 *
 * ## Why only ACCEPTED proposals appear
 *
 * A rejected proposal made no change, so there is nothing to have worked or not worked. Asking
 * a coach to judge the outcome of something that never happened is a question with no answer,
 * and a list full of them is a list nobody opens.
 */

export interface UnjudgedHypothesisView {
  readonly proposalId: ProposalId
  readonly summary: string
  readonly claim: string
  readonly indicatorKind: string
  readonly horizon: PlainDate
  /** How far past due. Zero on the day it becomes answerable. */
  readonly overdueByDays: number
}

/**
 * The most recent verdict per proposal, following the supersede chain.
 *
 * A corrected verdict is a NEW outcome pointing at the old one, and both are returned by the
 * port. So "is this judged" cannot be answered by counting outcomes — it is answered by whether
 * any outcome survives un-superseded. Counting would also mean a proposal judged once and
 * corrected once looked doubly judged.
 */
const judgedProposalIds = (outcomes: readonly DecisionOutcomeSnapshot[]): ReadonlySet<string> => {
  // Typed as the branded id, not `string`: a predicate narrowing to `string` is not assignable
  // to a branded parameter, and widening the Set would let a raw string be looked up in it.
  const superseded = new Set<DecisionOutcomeId>(
    outcomes
      .map((outcome) => outcome.supersedes)
      .filter((id): id is DecisionOutcomeId => id !== null),
  )
  const judged = new Set<string>()
  for (const outcome of outcomes) {
    if (!superseded.has(outcome.id)) judged.add(outcome.proposalId)
  }
  return judged
}

const daysBetweenKeys = (from: PlainDate, to: PlainDate): number =>
  Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) /
      86_400_000,
  )

export const unjudgedHypotheses = (
  proposals: readonly ProposalSnapshot[],
  outcomes: readonly DecisionOutcomeSnapshot[],
  asOf: PlainDate,
): readonly UnjudgedHypothesisView[] => {
  const judged = judgedProposalIds(outcomes)

  return proposals
    .filter((p) => p.accepted === true)
    .filter((p) => !judged.has(p.id))
    // Due means the horizon has arrived, compared as calendar keys. `new Date("2026-10-10")` is
    // UTC midnight, so west of Greenwich a horizon would come due a day early.
    .filter((p) => plainDateKey(asOf) >= plainDateKey(p.hypothesis.horizon))
    .map((p) => ({
      proposalId: p.id,
      summary: p.summary,
      claim: p.hypothesis.claim,
      indicatorKind: p.hypothesis.indicatorKind,
      horizon: p.hypothesis.horizon,
      overdueByDays: daysBetweenKeys(p.hypothesis.horizon, asOf),
    }))
    // Longest overdue first. The oldest unanswered question is the one most likely to be
    // forgotten, and the one whose answer is least recoverable from memory.
    .sort((a, b) => b.overdueByDays - a.overdueByDays)
}

/**
 * Proposals still awaiting a human decision.
 *
 * Separate from the above because they are different obligations at different moments: one asks
 * "should we do this", the other asks "did it work". A single list mixing them would ask a coach
 * two unrelated questions in one column.
 */
export const pendingProposals = (
  proposals: readonly ProposalSnapshot[],
): readonly ProposalSnapshot[] =>
  [...proposals]
    .filter((p) => p.accepted === null)
    // Oldest first: a proposal that has sat undecided longest is the one holding up the athlete.
    .sort((a, b) => (plainDateKey(a.proposedOn) < plainDateKey(b.proposedOn) ? -1 : 1))
