import type { PlainDate, PrescribedSessionId, ProgramVersionId } from '@fitnessos/kernel'
import type { VerdictLevel } from '../../domain/ScreeningVerdict'

/** Read models (D-06): no invariants. The aggregates enforce rules when sessions are created. */

export interface PrescribedItemSnapshot {
  readonly id: string
  readonly movementName: string
  readonly order: number
  readonly sets: number
  readonly reps: number
  /** Null for bodyweight work. Never zero (ADR-0013 note in the aggregate). */
  readonly loadKg: number | null
}

export interface PrescribedSessionSnapshot {
  readonly id: PrescribedSessionId
  readonly programVersionId: ProgramVersionId
  readonly scheduledFor: PlainDate
  readonly items: readonly PrescribedItemSnapshot[]
  readonly screening: {
    readonly level: VerdictLevel
    readonly basis: string | null
    /** True when a basis exists but the viewer may not see it (ADR-0002/0014). */
    readonly basisWithheld: boolean
  }
}

export interface ExecutionReadPort {
  readonly upcomingSessions: (
    signal?: AbortSignal,
  ) => Promise<readonly PrescribedSessionSnapshot[]>
}

export interface ExecutionPorts {
  readonly execution: ExecutionReadPort
}
