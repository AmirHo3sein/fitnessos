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

export interface LoggedSetInput {
  readonly id: string
  readonly prescribedItemId: string
  readonly setNumber: number
  readonly reps: number
  readonly loadKg: number | null
  readonly rpe: number | null
}

export interface LogSessionInput {
  readonly id: string
  readonly prescribedSessionId: string
  readonly performedOn: PlainDate
  readonly sets: readonly LoggedSetInput[]
  readonly note: string | null
}

export interface ExecutionWritePort {
  /**
   * Record a performed session.
   *
   * Resolves when the log is DURABLE, not when it reaches the server, and the boolean says which:
   * `true` means it is queued for replay, `false` means it went straight through. The UI needs
   * that distinction — "saved" and "saved, will sync" are different promises, and telling an
   * athlete in a basement gym that their session is safely on the server would be a lie.
   *
   * Never rejects for a network reason. A gym with no signal is the NORMAL case here, not a
   * failure, and an error state would train athletes to distrust the log.
   */
  readonly logSession: (input: LogSessionInput) => Promise<boolean>

  /** Logs still waiting to reach the server. Drives the "n pending" indicator. */
  readonly pendingLogCount: () => Promise<number>
}

export interface ExecutionPorts {
  readonly execution: ExecutionReadPort & ExecutionWritePort
}
