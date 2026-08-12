import { subjectScope, type SubjectId } from '@fitnessos/kernel'
import type { DecisionOutcomeSnapshot, LearningPorts, ProposalSnapshot } from '../ports/index'

export const learningKeys = {
  all: (subject: SubjectId) => [...subjectScope(subject), 'learning'] as const,
  proposals: (subject: SubjectId) => [...learningKeys.all(subject), 'proposals'] as const,
  outcomes: (subject: SubjectId) => [...learningKeys.all(subject), 'outcomes'] as const,
} as const

export interface QueryDefinition<T> {
  readonly queryKey: readonly unknown[]
  readonly queryFn: (ctx: { signal: AbortSignal }) => Promise<T>
  readonly staleTime?: number
}

export const proposalsQuery = (
  ports: LearningPorts,
  subject: SubjectId,
): QueryDefinition<readonly ProposalSnapshot[]> => ({
  queryKey: learningKeys.proposals(subject),
  queryFn: ({ signal }) => ports.learning.proposals(signal),
  staleTime: 60_000,
})

export const outcomesQuery = (
  ports: LearningPorts,
  subject: SubjectId,
): QueryDefinition<readonly DecisionOutcomeSnapshot[]> => ({
  queryKey: learningKeys.outcomes(subject),
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
  onVerdictRendered: (qc: Invalidator, subject: SubjectId) => qc.invalidateQueries({ queryKey: learningKeys.all(subject) }),
  onProgramRevised: (qc: Invalidator, subject: SubjectId) =>
    qc.invalidateQueries({ queryKey: learningKeys.proposals(subject) }),
} as const
