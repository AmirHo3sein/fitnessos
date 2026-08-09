import type { DecisionOutcomeSnapshot, LearningPorts, ProposalSnapshot } from '../ports/index'

export const learningKeys = {
  all: ['learning'] as const,
  proposals: () => [...learningKeys.all, 'proposals'] as const,
  outcomes: () => [...learningKeys.all, 'outcomes'] as const,
} as const

export interface QueryDefinition<T> {
  readonly queryKey: readonly unknown[]
  readonly queryFn: (ctx: { signal: AbortSignal }) => Promise<T>
  readonly staleTime?: number
}

export const proposalsQuery = (
  ports: LearningPorts,
): QueryDefinition<readonly ProposalSnapshot[]> => ({
  queryKey: learningKeys.proposals(),
  queryFn: ({ signal }) => ports.learning.proposals(signal),
  staleTime: 60_000,
})

export const outcomesQuery = (
  ports: LearningPorts,
): QueryDefinition<readonly DecisionOutcomeSnapshot[]> => ({
  queryKey: learningKeys.outcomes(),
  queryFn: ({ signal }) => ports.learning.outcomes(signal),
  staleTime: 5 * 60_000,
})

export interface Invalidator {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => Promise<void> | void
}

/**
 * Named by domain event, not by mutation.
 *
 * `onProgramRevised` is here as well as in Prescription, and that is ADR-0010 showing through:
 * accepting a proposal produces a new `ProgramVersion` — the moment of change belongs to the
 * changing context — and Learning learns that a proposal was decided only as a consequence. A
 * client that invalidated Learning only when Learning was written would leave a decided
 * proposal sitting in the pending list.
 */
export const learningInvalidations = {
  onVerdictRendered: (qc: Invalidator) => qc.invalidateQueries({ queryKey: learningKeys.all }),
  onProgramRevised: (qc: Invalidator) =>
    qc.invalidateQueries({ queryKey: learningKeys.proposals() }),
} as const
