import type { PrescriptionPorts, ProgramSnapshot } from '../ports/index'

export const programKeys = {
  all: ['program'] as const,
  current: () => [...programKeys.all, 'current'] as const,
} as const

export interface QueryDefinition<T> {
  readonly queryKey: readonly unknown[]
  readonly queryFn: (ctx: { signal: AbortSignal }) => Promise<T>
  readonly staleTime?: number
}

export const currentProgramQuery = (
  ports: PrescriptionPorts,
): QueryDefinition<ProgramSnapshot | null> => ({
  queryKey: programKeys.current(),
  queryFn: ({ signal }) => ports.prescription.currentProgram(signal),
  staleTime: 5 * 60_000,
})

export interface Invalidator {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => Promise<void> | void
}

/**
 * Named by domain event. `onProgramRevised` covers both a coach editing and an accepted AI
 * proposal, because both produce the same event — which is the point of naming rules after
 * events rather than after the mutation that triggered them.
 */
export const programInvalidations = {
  onProgramRevised: (qc: Invalidator) => qc.invalidateQueries({ queryKey: programKeys.all }),
  onProgramAssigned: (qc: Invalidator) => qc.invalidateQueries({ queryKey: programKeys.all }),
} as const
