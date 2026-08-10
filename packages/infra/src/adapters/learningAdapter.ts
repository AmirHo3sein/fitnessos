import type {
  LearningReadPort,
  LearningWritePort,
  RenderVerdictInput,
} from '@fitnessos/core/learning'
import type { AuthContext, HttpClient } from '../http/client'
import {
  decisionOutcomeFrom,
  decisionOutcomesFrom,
  proposalsFrom,
  renderVerdictBodyFrom,
} from '../mappers/learning'

/**
 * HTTP implementation of the Learning ports.
 *
 * There is no `accept` here, and its absence is the architecture rather than an omission.
 * Accepting a proposal is the moment of change, which ADR-0010 places in the CHANGING context —
 * it goes through Prescription's `reviseProgram`, and lands on the new version's
 * `authoringDecision` as `proposedBy: 'assistant'` with the human who decided.
 *
 * A convenience method here that "accepted a proposal" would have to reach into Prescription to
 * do it, which is exactly what ADR-0019 forbids.
 */
export const createLearningAdapter = (
  http: HttpClient,
  auth: AuthContext,
): LearningReadPort & LearningWritePort => ({
  proposals: async (signal?: AbortSignal) =>
    proposalsFrom(await http.request('/proposals', { auth, ...(signal ? { signal } : {}) })),

  outcomes: async (signal?: AbortSignal) =>
    decisionOutcomesFrom(await http.request('/outcomes', { auth, ...(signal ? { signal } : {}) })),

  renderVerdict: async (input: RenderVerdictInput, signal?: AbortSignal) => {
    const body = renderVerdictBodyFrom(input)
    // 200 and 201 are both success — 200 is the same client id replayed after a lost response.
    return decisionOutcomeFrom(
      await http.request(`/proposals/${input.proposalId}/outcome`, {
        method: 'POST',
        body,
        auth,
        ...(signal ? { signal } : {}),
      }),
    )
  },
})
