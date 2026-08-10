import type {
  DecisionOutcomeSnapshot,
  ProposalSnapshot,
  RenderVerdictInput,
} from '@fitnessos/core/learning'
import {
  DecisionOutcomeSchema,
  ProposalSchema,
  RenderVerdictBodySchema,
  type components,
} from '@fitnessos/contracts'
import { idFrom, type PlainDate } from '@fitnessos/kernel'
import type { z } from 'zod'
import { parseContract, type FieldsAgree } from './parse'

/**
 * Learning mappers.
 *
 * Two absent-versus-null decisions worth noting, because they mean different things:
 *
 *   `decidedOn` / `accepted`  absent means UNDECIDED, which the application models as `null`.
 *                             Both must move together — a proposal with a decision date and no
 *                             verdict would be a state the domain says cannot exist.
 *   `supersedes`              absent means this is a first verdict, not a correction.
 */

type ContractProposal = components['schemas']['Proposal']
type ValidatedProposal = z.infer<typeof ProposalSchema>
type ContractOutcome = components['schemas']['DecisionOutcome']
type ValidatedOutcome = z.infer<typeof DecisionOutcomeSchema>
type ContractVerdictBody = components['schemas']['RenderVerdictBody']
type ValidatedVerdictBody = z.infer<typeof RenderVerdictBodySchema>

/** ISO → PlainDate without `Date`, which parses a plain date as UTC midnight and shifts it. */
const plainDateFrom = (iso: string): PlainDate => {
  const [year, month, day] = iso.split('-').map(Number)
  return { year: year ?? 0, month: month ?? 1, day: day ?? 1 }
}

export const proposalFrom = (raw: unknown): ProposalSnapshot => {
  const c = parseContract(ProposalSchema, raw, 'Proposal')
  return {
    id: idFrom<'ProposalId'>(c.id),
    targetKind: c.targetKind,
    targetId: c.targetId,
    summary: c.summary,
    rationale: c.rationale,
    hypothesis: {
      indicatorKind: c.hypothesis.indicatorKind,
      claim: c.hypothesis.claim,
      horizon: plainDateFrom(c.hypothesis.horizon),
    },
    proposedOn: plainDateFrom(c.proposedOn),
    decidedOn: c.decidedOn === undefined ? null : plainDateFrom(c.decidedOn),
    accepted: c.accepted ?? null,
  }
}

export const proposalsFrom = (raw: unknown): readonly ProposalSnapshot[] =>
  (Array.isArray(raw) ? raw : []).map(proposalFrom)

export const decisionOutcomeFrom = (raw: unknown): DecisionOutcomeSnapshot => {
  const c = parseContract(DecisionOutcomeSchema, raw, 'DecisionOutcome')
  return {
    id: idFrom<'DecisionOutcomeId'>(c.id),
    proposalId: idFrom<'ProposalId'>(c.proposalId),
    verdict: c.verdict,
    rationale: c.rationale,
    decidedBy: c.decidedBy,
    decidedOn: plainDateFrom(c.decidedOn),
    supersedes: c.supersedes === undefined ? null : idFrom<'DecisionOutcomeId'>(c.supersedes),
  }
}

export const decisionOutcomesFrom = (raw: unknown): readonly DecisionOutcomeSnapshot[] =>
  (Array.isArray(raw) ? raw : []).map(decisionOutcomeFrom)

export const renderVerdictBodyFrom = (input: RenderVerdictInput): ValidatedVerdictBody => {
  const body = {
    id: input.id,
    verdict: input.verdict,
    rationale: input.rationale,
    // Dropped rather than sent as null: the contract constrains it to a uuid, so `null` would be
    // refused for a field that simply means "this is a first verdict".
    ...(input.supersedes === null ? {} : { supersedes: input.supersedes }),
  }
  return parseContract(RenderVerdictBodySchema, body, 'RenderVerdictBody (request)')
}

export const PROPOSAL_COVERAGE: Record<keyof ContractProposal, true> = {
  id: true,
  targetKind: true,
  targetId: true,
  summary: true,
  rationale: true,
  hypothesis: true,
  proposedOn: true,
  decidedOn: true,
  accepted: true,
}

export const OUTCOME_COVERAGE: Record<keyof ContractOutcome, true> = {
  id: true,
  proposalId: true,
  verdict: true,
  rationale: true,
  decidedBy: true,
  decidedOn: true,
  supersedes: true,
}

export const VERDICT_BODY_COVERAGE: Record<keyof ContractVerdictBody, true> = {
  id: true,
  verdict: true,
  rationale: true,
  supersedes: true,
}

const _proposalAgrees: FieldsAgree<ContractProposal, ValidatedProposal> = true
const _outcomeAgrees: FieldsAgree<ContractOutcome, ValidatedOutcome> = true
const _verdictAgrees: FieldsAgree<ContractVerdictBody, ValidatedVerdictBody> = true
void _proposalAgrees
void _outcomeAgrees
void _verdictAgrees
