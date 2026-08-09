'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { newDecisionOutcomeId, type PlainDate } from '@fitnessos/kernel'
import {
  learningKeys,
  outcomesQuery,
  proposalsQuery,
  unjudgedHypotheses,
  type UnjudgedHypothesisView,
} from '../../application/index'
import type { Verdict } from '../../domain/DecisionOutcome'
import { useLearningPorts } from '../di'

export interface UseUnjudged {
  readonly items: readonly UnjudgedHypothesisView[]
  readonly render: (input: {
    proposalId: string
    verdict: Verdict
    rationale: string
  }) => void
  readonly isRendering: boolean
  readonly error: Error | null
}

/**
 * Accepted proposals whose claim has come due and gone unanswered, plus the way to answer.
 *
 * `asOf` is a parameter, not a clock read here: due-ness is derived (ADR-0006), and a clock
 * inside the hook would make it untestable and would differ between the server render and
 * hydration.
 *
 * Two queries rather than one endpoint returning the join, because the join is a DERIVATION and
 * belongs on this side. A backend field saying "unjudged" would be wrong the day after it was
 * serialised, and it would bake this product's definition of overdue into the wire.
 */
export const useUnjudged = (asOf: PlainDate): UseUnjudged => {
  const ports = useLearningPorts()
  const queryClient = useQueryClient()

  const proposals = useQuery(proposalsQuery(ports))
  const outcomes = useQuery(outcomesQuery(ports))

  const mutation = useMutation({
    mutationFn: (input: { proposalId: string; verdict: Verdict; rationale: string }) =>
      ports.learning.renderVerdict({
        // Client-generated (ADR-0010), so a retry after a lost response is safe.
        id: newDecisionOutcomeId(),
        proposalId: input.proposalId as never,
        verdict: input.verdict,
        rationale: input.rationale,
        // A first verdict. Correcting one supersedes, and is a separate deliberate act rather
        // than something this list offers by accident.
        supersedes: null,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: learningKeys.all }),
  })

  return {
    items: unjudgedHypotheses(proposals.data ?? [], outcomes.data ?? [], asOf),
    render: mutation.mutate,
    isRendering: mutation.isPending,
    error: mutation.error,
  }
}
